// .scratch/text-to-speech/issues/01-narration-with-gemini.md: the Narrate tab (ADR 0019). Generate fixes
// the start at the playhead, the backend (a fake API and event stream here) reads the script, and its
// item lands through the action that lands a Take: one Music Clip marked Speech, not Ducked, on a free
// lane, Picked, as one undo step; Undo keeps the item. The tab is in the desktop's asset tabs and the
// phone's toolbar. No jsdom: the markup is checked with renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { MediaItem, MusicClip, NarrationRequest, VoicesList } from "../../../api";
import { landTake } from "./actions";
import { AssetPanel } from "./AssetPanel";
import { ASSET_TABS, AssetTabs, PHONE_ASSET_TABS } from "./Chrome";
import { trackLanes, type AdvancedEdits } from "./edits";
import type { MediaLibrary } from "./MediaLibrary";
import { engineLabel, NARRATION_IN_LIBRARY, NarrateFlow, PAUSE_STOPS } from "./narrate";
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
  };
  const sent: NarrationRequest[] = [];
  const told: string[] = [];
  let outcome: { done: (item: MediaItem) => void; failed: (message: string) => void } | null = null;
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
    settle,
    refuse: (message: string) => (refuse = message),
    done: () => outcome?.done(ITEM),
    failed: (message: string) => outcome?.failed(message),
  };
}

const BODY: NarrationRequest = { text: "Halo semua. Apa kabar?", engine: "gemini", voice: "Kore", pauses: 0.3 };

describe("Generate", () => {
  test("lands a Music Clip marked Speech at the playhead on a free lane, Picked, as one undo step; Undo keeps the item", async () => {
    const { world, flow, sent, settle, done } = setUp();
    // The playhead at 3 s when Generate is pressed.
    await flow.generate(BODY, 3);
    expect(sent).toEqual([BODY]);
    expect(flow.state).toEqual({ phase: "making", start: 3 });
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
    await flow.generate(BODY, 3);
    done();
    await settle();
    expect(world.steps.value.music).toEqual([song]);
    expect(world.items).toEqual([ITEM]);
    expect(told).toEqual([NARRATION_IN_LIBRARY]);
  });

  test("tells a refusal or a failure, which leaves nothing laid", async () => {
    const { world, flow, refuse } = setUp();
    refuse("Another Narration is being made: wait for it to finish");
    await flow.generate(BODY, 3);
    expect(flow.state).toEqual({ phase: "failed", message: "Another Narration is being made: wait for it to finish" });

    const second = setUp();
    await second.flow.generate(BODY, 3);
    second.failed("Gemini TTS refused GEMINI_API_KEY");
    expect(second.flow.state).toEqual({ phase: "failed", message: "Gemini TTS refused GEMINI_API_KEY" });
    expect([world.steps.value.music, second.world.steps.value.music]).toEqual([[song], [song]]);
  });
});

describe("the Narrate tab", () => {
  const fields = (voices: VoicesList = VOICES) => renderToStaticMarkup(<NarrateFields voices={voices} state={{ phase: "idle" }} onGenerate={() => {}} />);

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
        narrate={<NarrateFields voices={VOICES} state={{ phase: "idle" }} onGenerate={() => {}} />}
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
});
