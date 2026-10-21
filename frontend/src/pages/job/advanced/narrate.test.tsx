// .scratch/text-to-speech/issues/01-narration-with-gemini.md: the Narrate tab (ADR 0019). Generate fixes
// the start at the playhead, the backend (a fake API and event stream here) reads the script, and its
// item lands through the action that lands a Take: one Music Clip marked Speech, not Ducked, on a free
// lane, Picked, as one undo step; Undo keeps the item. The tab is in the desktop's asset tabs and the
// phone's toolbar. No jsdom: the markup is checked with renderToStaticMarkup.
// And 02-progress-cancel-and-failures.md: progress and Cancel in Generate's place, the draft kept
// through a failure, a busy refusal or a cancel, and Generate off at the Clip's end.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { MediaItem, MusicClip, NarrationRequest, VoicesList } from "../../../api";
import { landTake } from "./actions";
import { AssetPanel } from "./AssetPanel";
import { ASSET_TABS, AssetTabs, PHONE_ASSET_TABS } from "./Chrome";
import { trackLanes, type AdvancedEdits } from "./edits";
import type { MediaLibrary } from "./MediaLibrary";
import {
  DEFAULT_PAUSE,
  engineLabel,
  NARRATE_AT_END_HINT,
  NARRATION_IN_LIBRARY,
  NARRATION_MADE_BEFORE_CANCEL,
  NarrateFlow,
  PAUSE_STOPS,
  type NarrateDraft,
  type NarrateState,
  type NarrationListener,
} from "./narrate";
import { NarrateFields } from "./NarratePanel";
import { picked, type Pick } from "./pick";
import { stepped, undone, type Steps } from "./useEditHistory";

const ITEM: MediaItem = {
  id: "narration-item",
  kind: "audio",
  name: "Narration Kore 2026-10-21 14.03.05",
  size_bytes: 0,
  duration: 3.6,
  width: null,
  height: null,
  has_audio: true,
  created: "",
};

const VOICES: VoicesList = {
  engines: [
    {
      id: "gemini",
      label: "Gemini",
      service: "Gemini",
      local: false,
      ready: true,
      takes_style: true,
      voices: [
        { id: "Kore", name: "Kore", detail: "Firm · female", language: null },
        { id: "Puck", name: "Puck", detail: "Upbeat · male", language: null },
      ],
    },
  ],
  default: "gemini",
};

const song: MusicClip = { id: "song", media: "song-item", start: 0, secs: 10, offset: 0, volume: 1, fade_in: 0, fade_out: 0, keys: {}, duck: -12 };

// The editor on fakes: its undo history, Pick and Media Library list; the backend's start and event
// stream, answered by the test. A refused landing stands for a locked Music Track.
function setUp() {
  const world = {
    steps: { past: [], value: { music: [song] } as unknown as AdvancedEdits, future: [] } as Steps<AdvancedEdits>,
    pick: null as Pick,
    items: [] as MediaItem[],
    musicLocked: false,
    playhead: 3,
  };
  const sent: NarrationRequest[] = [];
  const told: string[] = [];
  const cancelled: string[] = [];
  let outcome: NarrationListener | null = null;
  let refuse: string | null = null;
  const flow = new NarrateFlow({
    start: async (body) => {
      sent.push(body);
      if (refuse) throw new Error(refuse);
      return "n1";
    },
    listen: (_id, on) => {
      outcome = on;
      return () => (outcome = null);
    },
    cancel: async (id) => void cancelled.push(id),
    playhead: () => world.playhead,
    land: (landed) => {
      if (world.musicLocked) return null;
      const landedOutcome = landTake({ edits: world.steps.value }, landed, () => "landed");
      world.steps = stepped(world.steps, landedOutcome.edits, false);
      world.pick = landedOutcome.pick;
      return landed.start;
    },
    added: (item) => void world.items.push(item),
    tell: (text) => void told.push(text),
  });
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    world,
    flow,
    sent,
    told,
    cancelled,
    settle,
    refuse: (message: string) => (refuse = message),
    progress: (stage: string, done: number, of: number) => outcome?.progress({ stage, done, of }),
    done: () => outcome?.done(ITEM),
    failed: (message: string) => outcome?.failed(message),
    listening: () => outcome !== null,
  };
}

const BODY: NarrationRequest = { text: "Halo semua. Apa kabar?", engine: "gemini", voice: "Kore", pauses: 0.3 };

describe("Generate", () => {
  test("lands a Music Clip marked Speech at the playhead on a free lane, Picked, as one undo step; Undo keeps the item", async () => {
    const { world, flow, sent, settle, done } = setUp();
    // The playhead at 3 s when Generate is pressed.
    await flow.generate(BODY);
    expect(sent).toEqual([BODY]);
    expect(flow.state).toEqual({ phase: "making", start: 3, progress: null });
    done();
    await settle();

    const landed = world.steps.value.music.find((clip) => clip.id === "landed")!;
    expect(landed).toMatchObject({ media: ITEM.id, start: 3, secs: 3.6, speech: true, duck: null, volume: 1, offset: 0 });
    // The song under the whole Clip keeps its lane; the Narration is on the next, free one.
    expect(trackLanes(world.steps.value.music).map((lane) => lane.map((clip) => clip.id))).toEqual([["song"], ["landed"]]);
    expect(world.pick).toEqual(picked({ kind: "music", id: "landed" }));
    expect(world.steps.past).toHaveLength(1);
    expect(world.items).toEqual([ITEM]);
    expect(flow.state).toEqual({ phase: "idle" });

    world.steps = undone(world.steps)!;
    expect(world.steps.value.music).toEqual([song]);
    expect(world.items).toEqual([ITEM]);
  });

  test("on a locked Music Track keeps the item in the Media tab and says so", async () => {
    const { world, flow, told, settle, done } = setUp();
    world.musicLocked = true;
    await flow.generate(BODY);
    done();
    await settle();
    expect(world.steps.value.music).toEqual([song]);
    expect(world.steps.past).toHaveLength(0);
    expect(world.pick).toBeNull();
    expect(world.items).toEqual([ITEM]);
    expect(told).toEqual([NARRATION_IN_LIBRARY]);
    expect(flow.state).toEqual({ phase: "idle" });
  });

  test("fixes the start when pressed: the playhead moving meanwhile doesn't move the landing", async () => {
    const { world, flow, settle, done } = setUp();
    world.playhead = 2.5;
    await flow.generate(BODY);
    world.playhead = 8;
    done();
    await settle();
    expect(world.steps.value.music.find((clip) => clip.id === "landed")?.start).toBe(2.5);
  });

  test("tells the progress, stage by stage and sentence by sentence", async () => {
    const { flow, progress } = setUp();
    await flow.generate(BODY);
    progress("Loading the voice", 0, 2);
    expect(flow.state).toEqual({ phase: "making", start: 3, progress: { stage: "Loading the voice", done: 0, of: 2 } });
    progress("Reading", 1, 2);
    expect(flow.state).toEqual({ phase: "making", start: 3, progress: { stage: "Reading", done: 1, of: 2 } });
  });

  test("Cancel asks the backend to discard it, lands nothing and keeps the draft", async () => {
    const { world, flow, cancelled, told, settle, progress, done, listening } = setUp();
    flow.edit({ script: "Halo semua. Apa kabar?", voice: "Puck", pause: 2 });
    await flow.generate(BODY);
    progress("Reading", 1, 2);
    flow.cancel();
    expect(cancelled).toEqual(["n1"]);
    expect(flow.state).toEqual({ phase: "idle" });
    expect(flow.draft).toEqual({ script: "Halo semua. Apa kabar?", voice: "Puck", pause: 2 });
    // Progress after the cancel isn't told; a cancel that came too late keeps the item, unlaid.
    progress("Reading", 2, 2);
    expect(flow.state).toEqual({ phase: "idle" });
    done();
    await settle();
    expect(world.steps.value.music).toEqual([song]);
    expect(world.items).toEqual([ITEM]);
    expect(told).toEqual([NARRATION_MADE_BEFORE_CANCEL]);
    expect(listening()).toBe(false);
  });

  test("Cancel before the backend answers cancels it once it does", async () => {
    const { flow, cancelled } = setUp();
    const generating = flow.generate(BODY);
    flow.cancel();
    expect(flow.state).toEqual({ phase: "idle" });
    await generating;
    expect(cancelled).toEqual(["n1"]);
    expect(flow.state).toEqual({ phase: "idle" });
  });

  test("a failure or a busy refusal keeps the draft for Generate again", async () => {
    const { flow, refuse, failed } = setUp();
    const draft: NarrateDraft = { script: "Halo semua.", voice: "Puck", pause: 0 };
    flow.edit(draft);
    await flow.generate(BODY);
    failed("Gemini TTS failed (500): boom");
    expect(flow.state).toEqual({ phase: "failed", message: "Gemini TTS failed (500): boom" });
    expect(flow.draft).toEqual(draft);
    refuse("Another Narration is being made: wait for it to finish");
    await flow.generate(BODY);
    expect(flow.state).toEqual({ phase: "failed", message: "Another Narration is being made: wait for it to finish" });
    expect(flow.draft).toEqual(draft);
  });

  test("tells a refusal or a failure, which leaves nothing laid", async () => {
    const { world, flow, refuse } = setUp();
    refuse("Another Narration is being made: wait for it to finish");
    await flow.generate(BODY);
    expect(flow.state).toEqual({ phase: "failed", message: "Another Narration is being made: wait for it to finish" });

    const second = setUp();
    await second.flow.generate(BODY);
    second.failed("Gemini TTS refused GEMINI_API_KEY");
    expect(second.flow.state).toEqual({ phase: "failed", message: "Gemini TTS refused GEMINI_API_KEY" });
    expect([world.steps.value.music, second.world.steps.value.music]).toEqual([[song], [song]]);
  });
});

const DRAFT: NarrateDraft = { script: "", voice: null, pause: DEFAULT_PAUSE };

function Fields({ voices = VOICES, state = { phase: "idle" }, draft = DRAFT, atEnd = false }: { voices?: VoicesList; state?: NarrateState; draft?: NarrateDraft; atEnd?: boolean }) {
  return <NarrateFields voices={voices} state={state} draft={draft} atEnd={atEnd} onDraft={() => {}} onGenerate={() => {}} onCancel={() => {}} />;
}

describe("the Narrate tab", () => {
  const fields = (voices: VoicesList = VOICES) => renderToStaticMarkup(<Fields voices={voices} />);
  const generate = /<button type="button"[^>]*>(?:(?!<\/button>).)*Generate<\/button>/;

  test("lists the engine's Voices with their detail line, the pause and the script, Generate off without one", () => {
    const html = fields();
    expect(html).toContain("Gemini · cloud");
    expect(html).toMatch(/aria-checked="true"[^>]*>.*?Kore<\/span><span[^>]*>Firm · female</);
    expect(html).toMatch(/aria-checked="false"[^>]*>.*?Puck<\/span><span[^>]*>Upbeat · male</);
    expect(html).toContain(`>${PAUSE_STOPS[1].label}</output>`);
    expect(html).toContain("Script");
    expect(html).toMatch(/<button type="button"[^>]*disabled=""[^>]*>.*?Generate<\/button>/);
    expect(PAUSE_STOPS.map((stop) => stop.label)).toEqual(["None", "Natural", "Long", "Longer"]);
    expect(PAUSE_STOPS[1].secs).toBe(0.3);
  });

  test("names what to set up when no engine is", () => {
    const html = fields({ engines: [], default: null });
    expect(html).toContain("GEMINI_API_KEY");
    expect(html).not.toContain("Generate");
  });

  test("labels a cloud engine with its service and a local one as on this Mac", () => {
    expect(engineLabel(VOICES.engines[0])).toBe("Gemini · cloud");
    expect(engineLabel({ ...VOICES.engines[0], local: true, service: null })).toBe("On this Mac");
  });

  test("is an asset tab on a desktop, and in the phone's toolbar for its bottom sheet", () => {
    expect(ASSET_TABS.find((tab) => tab.value === "narrate")?.label).toBe("Narrate");
    expect(renderToStaticMarkup(<AssetTabs value="narrate" onChange={() => {}} />)).toMatch(/aria-selected="true"[^>]*title="Narrate"/);

    // The phone's toolbar shows a button per phone asset tab (with nothing picked), opening its sheet.
    expect(PHONE_ASSET_TABS.map((tab) => tab.value)).toContain("narrate");

    // The sheet's content is the asset panel's, as on a desktop.
    const library = { items: [], error: null, uploads: [] } as unknown as MediaLibrary;
    const panel = renderToStaticMarkup(
      <AssetPanel
        tab="narrate"
        fonts={null}
        library={library}
        transcript={null}
        near={{ id: "s1", start: 0, end: 10 }}
        transitions={null}
        filters={null}
        effects={null}
        narrate={<Fields />}
        onAddText={() => {}}
        onAddShape={() => {}}
        onAddMusic={() => {}}
        onAddSource={() => {}}
        onAddVideo={() => {}}
        onAddOverlay={() => {}}
      />,
    );
    expect(panel).toContain("Firm · female");
  });

  test("shows the progress and Cancel in Generate's place while it is made", () => {
    const making = { phase: "making", start: 3, progress: { stage: "Reading", done: 2, of: 5 } } as const;
    const html = renderToStaticMarkup(<Fields state={making} draft={{ ...DRAFT, script: "Satu. Dua." }} />);
    expect(html).not.toMatch(generate);
    expect(html).toContain("Reading…");
    expect(html).toContain("2 of 5 sentences");
    expect(html).toMatch(/role="progressbar"[^>]*aria-valuenow="40"/);
    expect(html).toMatch(/<button type="button"[^>]*>(?:(?!<\/button>).)*Cancel<\/button>/);
    // Before the first progress, it is starting and the bar sweeps.
    const starting = renderToStaticMarkup(<Fields state={{ phase: "making", start: 3, progress: null }} />);
    expect(starting).toContain("Starting…");
    expect(starting).not.toContain("aria-valuenow");
  });

  test("keeps the script, Voice and pause after a failure, with its message", () => {
    const draft = { script: "Halo semua.", voice: "Puck", pause: 3 };
    const html = renderToStaticMarkup(<Fields state={{ phase: "failed", message: "Gemini TTS failed (500): boom" }} draft={draft} />);
    expect(html).toContain(">Halo semua.</textarea>");
    expect(html).toMatch(/aria-checked="true"[^>]*>.*?Puck</);
    expect(html).toContain(`>${PAUSE_STOPS[3].label}</output>`);
    expect(html).toContain("Gemini TTS failed (500): boom");
    expect(html).toMatch(generate);
    expect(html.match(generate)![0]).not.toContain('disabled=""');
  });

  test("Generate is off at the Clip's end, with the hint, and with an empty script", () => {
    const atEnd = renderToStaticMarkup(<Fields draft={{ ...DRAFT, script: "Halo semua." }} atEnd />);
    expect(atEnd.match(generate)![0]).toContain('disabled=""');
    expect(atEnd).toContain(`title="${NARRATE_AT_END_HINT}"`);
    expect(renderToStaticMarkup(<Fields draft={{ ...DRAFT, script: "   " }} />).match(generate)![0]).toContain('disabled=""');
    expect(renderToStaticMarkup(<Fields draft={{ ...DRAFT, script: "Halo semua." }} />).match(generate)![0]).not.toContain('disabled=""');
  });
});
