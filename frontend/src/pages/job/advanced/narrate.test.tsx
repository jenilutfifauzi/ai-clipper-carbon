// .scratch/text-to-speech/issues/01-narration-with-gemini.md: the Narrate tab (ADR 0019). Generate fixes
// the start at the playhead, the backend (a fake API and event stream here) reads the script, and its
// item lands through the action that lands a Take: one Music Clip marked Speech, not Ducked, on a free
// lane, Picked, as one undo step; Undo keeps the item. The tab is in the desktop's asset tabs and the
// phone's toolbar. No jsdom: the markup is checked with renderToStaticMarkup.
// And 02-progress-cancel-and-failures.md: progress and Cancel in Generate's place, the draft kept
// through a failure, a busy refusal or a cancel, and Generate off at the Clip's end.
// And 03-openai-engine-and-engine-picker.md: the engine picker, its labels, the default engine from the
// Job's language, the browser's remembered engine and Voice, and the hint with no ready engine.
// And 04-speed-style-and-estimate.md: Speed, the Style line for an engine that takes one, the request
// carrying them, and the estimate of the read's length with the 5,000-character limit.
// And 05-narrate-a-picked-title.md: a picked Text Layer or the hook fills the script and fixes the start
// at its start, the earliest of several winning; an edited script is sent, from the item's start.
// And 06-voice-samples.md: Play sample on each Voice plays the sound the backend returns, once at a
// time, and tells busy when the backend refuses it.
// And 07-download-and-remove-kokoro.md: Kokoro beside the engine picker, Download (its size), its
// progress with Cancel, a failure's message, and Remove once it is here; the tab polls the Voices while it
// downloads, and the hint with no ready engine offers it.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, test, vi } from "vitest";
import { ApiError, type KokoroInfo, type MediaItem, type MusicClip, type NarrationRequest, type TextLayer, type VoicesList } from "../../../api";
import { landTake } from "./actions";
import { AssetPanel } from "./AssetPanel";
import { ASSET_TABS, AssetTabs, PHONE_ASSET_TABS } from "./Chrome";
import { trackLanes, type AdvancedEdits } from "./edits";
import type { MediaLibrary } from "./MediaLibrary";
import {
  chosenVoice,
  CHARS_PER_SECOND,
  EMPTY_DRAFT,
  engineLabel,
  engineOption,
  KOKORO_POLL_MS,
  KOKORO_REMOVE_BUSY,
  kokoroSize,
  NARRATE_AT_END_HINT,
  NARRATE_TITLE_AT_END_HINT,
  NARRATION_IN_LIBRARY,
  NARRATION_MADE_BEFORE_CANCEL,
  NarrateFlow,
  narrationBody,
  narratedTitle,
  narrationEstimate,
  PAUSE_STOPS,
  rememberChoice,
  rememberedVoice,
  SAMPLE_BUSY,
  VoiceSamples,
  VoicesSource,
  type KokoroAction,
  type NarrateDraft,
  type SampleState,
  type NarratedTitle,
  type NarrateState,
  type NarrationListener,
  type RememberedVoice,
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
    flow.edit({ script: "Halo semua. Apa kabar?", engine: "gemini", voice: "Puck", pause: 2 });
    await flow.generate(BODY);
    progress("Reading", 1, 2);
    flow.cancel();
    expect(cancelled).toEqual(["n1"]);
    expect(flow.state).toEqual({ phase: "idle" });
    expect(flow.draft).toEqual({ ...EMPTY_DRAFT, script: "Halo semua. Apa kabar?", engine: "gemini", voice: "Puck", pause: 2 });
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
    const draft: NarrateDraft = { script: "Halo semua.", engine: "gemini", voice: "Puck", speed: 1.5, pause: 0, style: "calm" };
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

const DRAFT: NarrateDraft = EMPTY_DRAFT;

function Fields({
  voices = VOICES,
  language = "id",
  state = { phase: "idle" },
  draft = DRAFT,
  remembered = null,
  atEnd = false,
  title = null,
  sample = null,
  kokoroMessage = null,
}: {
  sample?: SampleState;
  kokoroMessage?: string | null;
  voices?: VoicesList;
  language?: string;
  state?: NarrateState;
  draft?: NarrateDraft;
  remembered?: RememberedVoice | null;
  atEnd?: boolean;
  title?: NarratedTitle | null;
}) {
  return (
    <NarrateFields
      voices={voices}
      language={language}
      state={state}
      draft={draft}
      remembered={remembered}
      atEnd={atEnd}
      title={title}
      onDraft={() => {}}
      onGenerate={() => {}}
      onCancel={() => {}}
      sample={sample}
      kokoroMessage={kokoroMessage}
    />
  );
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

  test("names the .env settings, with Generate off, when no engine is ready", () => {
    for (const voices of [{ engines: [], default: null }, { engines: [{ ...VOICES.engines[0], ready: false }], default: null }]) {
      const html = fields(voices);
      for (const key of ["GEMINI_API_KEY", "TTS_BASE_URL", "TTS_API_KEY", "TTS_MODEL"]) expect(html).toContain(`<code>${key}</code>`);
      expect(html.match(generate)![0]).toContain('disabled=""');
      expect(html).not.toContain('role="radiogroup"');
    }
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
    const draft = { ...DRAFT, script: "Halo semua.", voice: "Puck", pause: 3 };
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

// Two cloud engines set up, Gemini and OpenAI, as GET /api/voices lists them; `default` is the backend's
// for the Job's language.
const OPENAI: VoicesList["engines"][number] = {
  id: "openai",
  label: "OpenAI",
  service: "OpenAI",
  local: false,
  ready: true,
  takes_style: false,
  voices: [
    { id: "coral", name: "Coral", detail: "Bright, friendly", language: null },
    { id: "onyx", name: "Onyx", detail: "Deep, steady", language: null },
  ],
};
const TWO: VoicesList = { engines: [VOICES.engines[0], OPENAI], default: "gemini" };

// A fake localStorage over a map; `blocked` makes every access throw, as blocked site data does.
function stubStorage(blocked = false) {
  const map = new Map<string, string>();
  const fail = () => {
    throw new DOMException("The operation is insecure.", "SecurityError");
  };
  vi.stubGlobal("window", { addEventListener: () => {}, removeEventListener: () => {} });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => (blocked ? fail() : (map.get(key) ?? null)),
    setItem: (key: string, value: string) => (blocked ? fail() : void map.set(key, value)),
    removeItem: (key: string) => void map.delete(key),
  });
}

describe("the engine picker", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });
  const chosen = (voices: VoicesList, remembered: RememberedVoice | null = null, draft = DRAFT) => {
    const choice = chosenVoice(voices, draft, remembered);
    return choice && [choice.engine.id, choice.voice?.id];
  };
  const selected = (html: string) => html.match(/<option value="([^"]*)" selected="">/)?.[1];

  test("labels each engine with where its words go", () => {
    const html = renderToStaticMarkup(<Fields voices={TWO} />);
    expect(html).toContain(">Engine</label>");
    expect(html).toContain('<option value="gemini" selected="">Gemini · cloud</option>');
    expect(html).toContain('<option value="openai">OpenAI · cloud</option>');
    expect(engineOption({ ...OPENAI, id: "kokoro", label: "Kokoro", service: null, local: true })).toBe("Kokoro · On this Mac");
    // An engine that isn't ready isn't offered.
    expect(renderToStaticMarkup(<Fields voices={{ ...TWO, engines: [TWO.engines[0], { ...OPENAI, ready: false }] }} />)).not.toContain("OpenAI · cloud");
  });

  test("starts on the default engine for the Job's language, its first Voice", () => {
    // The backend's default: Indonesian the first ready cloud engine, English a local one else the first cloud one.
    expect(chosen(TWO)).toEqual(["gemini", "Kore"]);
    expect(chosen({ ...TWO, default: "openai" })).toEqual(["openai", "coral"]);
    expect(selected(renderToStaticMarkup(<Fields voices={{ ...TWO, default: "openai" }} />))).toBe("openai");
    // A default that isn't ready (or none) falls to the first ready engine.
    expect(chosen({ ...TWO, default: null })).toEqual(["gemini", "Kore"]);
    expect(chosen({ engines: [], default: null })).toBeNull();
  });

  test("a remembered engine and Voice win over the default; the draft's choice over both", () => {
    expect(chosen(TWO, { engine: "openai", voice: "onyx" })).toEqual(["openai", "onyx"]);
    const html = renderToStaticMarkup(<Fields voices={TWO} remembered={{ engine: "openai", voice: "onyx" }} />);
    expect(selected(html)).toBe("openai");
    expect(html).toMatch(/aria-checked="true"[^>]*>.*?Onyx</);
    // A remembered engine no longer ready, or a Voice it no longer has, gives way.
    expect(chosen(TWO, { engine: "kokoro", voice: "af_bella" })).toEqual(["gemini", "Kore"]);
    expect(chosen(TWO, { engine: "openai", voice: "gone" })).toEqual(["openai", "coral"]);
    expect(chosen(TWO, { engine: "openai", voice: "onyx" }, { ...DRAFT, engine: "gemini", voice: "Puck" })).toEqual(["gemini", "Puck"]);
  });

  test("the browser remembers the engine and Voice chosen", () => {
    stubStorage();
    expect(rememberedVoice.read()).toBeNull();
    rememberChoice({ script: "Halo." });
    expect(rememberedVoice.read()).toBeNull();
    rememberChoice({ engine: "openai", voice: "onyx" });
    expect(rememberedVoice.read()).toEqual({ engine: "openai", voice: "onyx" });
    expect(chosen(TWO, rememberedVoice.read())).toEqual(["openai", "onyx"]);
    rememberChoice({ engine: "gemini", voice: null });
    expect(chosen(TWO, rememberedVoice.read())).toEqual(["gemini", "Kore"]);
  });

  test("storage that throws falls back to the default", () => {
    stubStorage(true);
    expect(chosen(TWO, rememberedVoice.read())).toEqual(["gemini", "Kore"]);
    // Choosing still works, for the page's life.
    expect(() => rememberChoice({ engine: "openai", voice: "onyx" })).not.toThrow();
  });

  test("switching engine swaps the Voices", () => {
    const gemini = renderToStaticMarkup(<Fields voices={TWO} />);
    expect(gemini).toContain("Firm · female");
    expect(gemini).not.toContain("Coral");
    const openai = renderToStaticMarkup(<Fields voices={TWO} draft={{ ...DRAFT, engine: "openai", voice: null }} />);
    expect(selected(openai)).toBe("openai");
    expect(openai).toMatch(/aria-checked="true"[^>]*>.*?Coral<\/span><span[^>]*>Bright, friendly</);
    expect(openai).toMatch(/aria-checked="false"[^>]*>.*?Onyx</);
    expect(openai).not.toContain("Kore");
  });
});

describe("Speed, Style and the estimate", () => {
  const generate = /<button type="button"[^>]*>(?:(?!<\/button>).)*Generate<\/button>/;
  const styleLine = /<label[^>]*>Style<\/label><input[^>]*type="text"/;

  test("Speed is a slider from 0.5× to 2×, at 1× by default", () => {
    const html = renderToStaticMarkup(<Fields />);
    expect(html).toMatch(/Speed<\/label><output[^>]*>1×<\/output>/);
    expect(html).toMatch(/type="range" min="0.5" max="2" step="0.05"[^>]*value="1"/);
    expect(renderToStaticMarkup(<Fields draft={{ ...DRAFT, speed: 1.5 }} />)).toMatch(/Speed<\/label><output[^>]*>1.5×<\/output>/);
  });

  test("the Style line shows only for an engine that takes one", () => {
    const gemini = renderToStaticMarkup(<Fields voices={TWO} draft={{ ...DRAFT, style: "warm, unhurried" }} />);
    expect(gemini).toMatch(styleLine);
    expect(gemini).toContain('value="warm, unhurried"');
    const openai = renderToStaticMarkup(<Fields voices={TWO} draft={{ ...DRAFT, engine: "openai", style: "warm, unhurried" }} />);
    expect(openai).not.toMatch(styleLine);
    // An OpenAI-compatible engine whose model takes instructions (TTS_STYLE) shows it.
    const instructed = { ...TWO, engines: [VOICES.engines[0], { ...OPENAI, takes_style: true }] };
    expect(renderToStaticMarkup(<Fields voices={instructed} draft={{ ...DRAFT, engine: "openai" }} />)).toMatch(styleLine);
  });

  test("Generate sends the Speed, the pause's seconds and the Style only to an engine that takes one", () => {
    const draft: NarrateDraft = { ...DRAFT, script: "  Halo semua.  ", speed: 1.5, pause: 2, style: "  warm, unhurried " };
    expect(narrationBody(VOICES.engines[0], "Kore", draft)).toEqual({
      text: "Halo semua.",
      engine: "gemini",
      voice: "Kore",
      speed: 1.5,
      pauses: PAUSE_STOPS[2].secs,
      style: "warm, unhurried",
    });
    expect(narrationBody(OPENAI, "coral", draft)).not.toHaveProperty("style");
    expect(narrationBody(VOICES.engines[0], "Kore", { ...draft, style: "   " })).not.toHaveProperty("style");
  });

  test("the estimate follows the script, the language's pace and the Speed", () => {
    const script = "a".repeat(420);
    expect(narrationEstimate(script, "id", 1)).toBe(`About 0:30 · 420 characters`);
    expect(420 / CHARS_PER_SECOND.id).toBe(30);
    expect(narrationEstimate(script, "en", 1)).toBe("About 0:28 · 420 characters");
    expect(narrationEstimate(script, "id", 2)).toBe("About 0:15 · 420 characters");
    expect(narrationEstimate(script, "id", 0.5)).toBe("About 1:00 · 420 characters");
    // Trimmed, and a language without a pace of its own reads at the default.
    expect(narrationEstimate(`  ${"b".repeat(1400)}\n`, "ja", 1)).toBe("About 1:40 · 1,400 characters");
    expect(narrationEstimate("   ", "id", 1)).toBeNull();
    expect(narrationEstimate("Hi", "id", 1)).toBe("About 0:00 · 2 characters");

    const html = renderToStaticMarkup(<Fields language="en" draft={{ ...DRAFT, script, speed: 2 }} />);
    expect(html).toContain("About 0:14 · 420 characters");
    expect(renderToStaticMarkup(<Fields />)).not.toContain("About ");
  });

  test("past 5,000 characters the count turns into the limit message and Generate is off", () => {
    const at = renderToStaticMarkup(<Fields draft={{ ...DRAFT, script: "a".repeat(5000) }} />);
    expect(at).toContain("5,000 characters");
    expect(at).not.toContain("at most");
    expect(at.match(generate)![0]).not.toContain('disabled=""');
    const past = renderToStaticMarkup(<Fields draft={{ ...DRAFT, script: "a".repeat(5001) }} />);
    expect(past).toContain("A script can be 5,000 characters at most: this one has 5,001");
    expect(past).not.toContain("About ");
    expect(past.match(generate)![0]).toContain('disabled=""');
  });
});

// The Candidate's titles: two Text Layers (one of two lines) and the hook, each from its start in
// Timeline time; the picked ones, the earliest first, give the script and the start.
const layerAt = (id: string, text: string, start: number) => ({ id, text, start, secs: 2 }) as TextLayer;
const TITLES = {
  text_layers: [layerAt("late", "Kedua", 6), layerAt("early", "Halo\n  semua ", 4), layerAt("blank", " \n ", 1)],
  hook_text: "Jangan lewatkan\nini",
  hook_start: 0.5,
};

describe("a picked title", () => {
  test("a picked Text Layer gives its words, its lines joined by spaces, and its start", () => {
    expect(narratedTitle(TITLES, picked({ kind: "text", id: "early" }))).toEqual({ key: "text:early", script: "Halo semua", start: 4, name: "the Text Layer" });
  });

  test("the picked hook does the same", () => {
    expect(narratedTitle(TITLES, { kind: "hook" })).toEqual({ key: "hook", script: "Jangan lewatkan ini", start: 0.5, name: "the hook" });
    // A hook without words is nothing to read.
    expect(narratedTitle({ ...TITLES, hook_text: "  " }, { kind: "hook" })).toBeNull();
  });

  test("with several Text Layers picked, among other items, the earliest on the Timeline wins (the hook is picked alone)", () => {
    const several = picked({ kind: "text", id: "late" }, { kind: "music", id: "song" }, { kind: "text", id: "early" }, { kind: "text", id: "blank" });
    expect(narratedTitle(TITLES, several)).toMatchObject({ key: "text:early", start: 4 });
    // Two from the same start: the first picked.
    const tied = { ...TITLES, text_layers: [layerAt("a", "Satu", 4), layerAt("b", "Dua", 4)] };
    expect(narratedTitle(tied, picked({ kind: "text", id: "b" }, { kind: "text", id: "a" }))?.key).toBe("text:b");
  });

  test("with none of these picked, there is no title: the start is the playhead", async () => {
    for (const pick of [null, picked({ kind: "music", id: "song" }), { kind: "captions" } as Pick, picked({ kind: "text", id: "blank" })]) {
      expect(narratedTitle(TITLES, pick)).toBeNull();
    }
    const { flow, world, settle, done } = setUp();
    world.playhead = 7;
    flow.prefill(null);
    expect(flow.draft.script).toBe("");
    await flow.generate(BODY, narratedTitle(TITLES, null)?.start);
    done();
    await settle();
    expect(world.steps.value.music.find((clip) => clip.id === "landed")?.start).toBe(7);
  });

  test("opening the tab with it picked fills an empty script, and the Narration lands at its start", async () => {
    const { flow, world, sent, settle, done } = setUp();
    const title = narratedTitle(TITLES, picked({ kind: "text", id: "early" }))!;
    flow.prefill(title.script);
    expect(flow.draft.script).toBe("Halo semua");
    // The playhead elsewhere: the item's start wins.
    world.playhead = 9;
    await flow.generate(narrationBody(VOICES.engines[0], "Kore", flow.draft), title.start);
    expect(sent[0].text).toBe("Halo semua");
    done();
    await settle();
    expect(world.steps.value.music.find((clip) => clip.id === "landed")).toMatchObject({ start: 4, speech: true });
  });

  test("an edited script is what is sent, and the start stays the item's", async () => {
    const { flow, world, sent, settle, done } = setUp();
    const title = narratedTitle(TITLES, { kind: "hook" })!;
    flow.prefill(title.script);
    flow.edit({ script: "Jangan lewatkan yang satu ini!" });
    // The tab shown again with the hook still picked leaves the owner's words as they are.
    flow.prefill(title.script);
    expect(flow.draft.script).toBe("Jangan lewatkan yang satu ini!");
    await flow.generate(narrationBody(VOICES.engines[0], "Kore", flow.draft), title.start);
    expect(sent[0].text).toBe("Jangan lewatkan yang satu ini!");
    done();
    await settle();
    expect(world.steps.value.music.find((clip) => clip.id === "landed")?.start).toBe(0.5);
  });

  test("another title picked replaces words it filled, never a script the owner typed", () => {
    const { flow } = setUp();
    flow.prefill(narratedTitle(TITLES, picked({ kind: "text", id: "early" }))?.script ?? null);
    flow.prefill(narratedTitle(TITLES, picked({ kind: "text", id: "late" }))?.script ?? null);
    expect(flow.draft.script).toBe("Kedua");
    flow.edit({ script: "Kata saya sendiri." });
    flow.prefill(narratedTitle(TITLES, { kind: "hook" })?.script ?? null);
    expect(flow.draft.script).toBe("Kata saya sendiri.");
    // Cleared by the owner, it takes the next title's words.
    flow.edit({ script: "" });
    flow.prefill(narratedTitle(TITLES, { kind: "hook" })?.script ?? null);
    expect(flow.draft.script).toBe("Jangan lewatkan ini");
  });

  test("a script typed before any title was picked is kept", () => {
    const { flow } = setUp();
    flow.edit({ script: "Selamat datang." });
    flow.prefill(narratedTitle(TITLES, { kind: "hook" })?.script ?? null);
    expect(flow.draft.script).toBe("Selamat datang.");
  });

  test("the tab says where it lands: the picked title's start, else the playhead", () => {
    const title = narratedTitle(TITLES, { kind: "hook" });
    expect(renderToStaticMarkup(<Fields title={title} />)).toContain("lands at the start of the hook");
    expect(renderToStaticMarkup(<Fields title={narratedTitle(TITLES, picked({ kind: "text", id: "early" }))} />)).toContain("lands at the start of the Text Layer");
    expect(renderToStaticMarkup(<Fields />)).toContain("lands at the playhead");
  });

  test("Generate is off when the picked title starts at the Clip's end, saying so", () => {
    const html = renderToStaticMarkup(<Fields draft={{ ...DRAFT, script: "Halo" }} atEnd title={narratedTitle(TITLES, { kind: "hook" })} />);
    expect(html).toContain(`title="${NARRATE_TITLE_AT_END_HINT}"`);
    expect(html).toMatch(/<button type="button"[^>]*disabled=""[^>]*>.*?Generate<\/button>/);
  });
});

describe("Play sample", () => {
  const SOUND = new Blob(["RIFF"], { type: "audio/wav" });

  function setUp(refuse: Error | null = null) {
    const asked: [string, string, string][] = [];
    const played: Blob[] = [];
    const stopped: Blob[] = [];
    let end: (() => void) | null = null;
    const samples = new VoiceSamples({
      fetch: async (engine, voice, language) => {
        asked.push([engine, voice, language]);
        if (refuse) throw refuse;
        return SOUND;
      },
      play: (sound, ended) => {
        played.push(sound);
        end = ended;
        return () => void stopped.push(sound);
      },
    });
    return { samples, asked, played, stopped, end: () => end?.() };
  }

  test("plays the sound returned for the Voice in the Job's language, then is idle again", async () => {
    const { samples, asked, played, end } = setUp();
    const loading = samples.play("gemini", "Kore", "id");
    expect(samples.state).toEqual({ engine: "gemini", voice: "Kore", phase: "loading" });
    await loading;
    expect(asked).toEqual([["gemini", "Kore", "id"]]);
    expect(played).toEqual([SOUND]);
    expect(samples.state).toEqual({ engine: "gemini", voice: "Kore", phase: "playing" });
    end();
    expect(samples.state).toBeNull();
  });

  test("one plays at a time: another Voice stops the first, and the same one pressed again stops it", async () => {
    const { samples, stopped } = setUp();
    await samples.play("gemini", "Kore", "id");
    await samples.play("gemini", "Puck", "id");
    expect(stopped).toHaveLength(1);
    expect(samples.state).toMatchObject({ voice: "Puck", phase: "playing" });
    await samples.play("gemini", "Puck", "id");
    expect(stopped).toHaveLength(2);
    expect(samples.state).toBeNull();
  });

  test("a busy refusal shows busy on the Voice's row, and plays nothing", async () => {
    const { samples, played } = setUp(new ApiError(409, "A Narration is being made: play the sample once it is done"));
    await samples.play("gemini", "Kore", "id");
    expect(played).toEqual([]);
    expect(samples.state).toEqual({ engine: "gemini", voice: "Kore", phase: "busy", message: SAMPLE_BUSY });
    const html = renderToStaticMarkup(<Fields sample={samples.state} />);
    expect(html).toMatch(/Kore<\/span>.*?aria-label="Play sample of Kore".*?<p role="status"[^>]*>Busy: a Narration is being made/);
  });

  test("another failure tells its message", async () => {
    const { samples } = setUp(new ApiError(502, "Gemini TTS failed (500): boom"));
    await samples.play("gemini", "Kore", "id");
    expect(samples.state).toMatchObject({ phase: "failed", message: "Couldn't play the sample: Gemini TTS failed (500): boom" });
  });

  test("each Voice has Play sample, on for a ready engine and off while a Narration is made", () => {
    const button = (html: string, voice: string) => html.match(new RegExp(`<button[^>]*aria-label="Play sample of ${voice}"[^>]*>`))![0];
    const html = renderToStaticMarkup(<Fields />);
    expect(button(html, "Kore")).not.toContain('disabled=""');
    expect(button(html, "Puck")).not.toContain('disabled=""');
    const making = renderToStaticMarkup(<Fields state={{ phase: "making", start: 0, progress: null }} />);
    expect(button(making, "Kore")).toContain('disabled=""');
    // An engine that isn't ready isn't offered, its samples with it (ticket 08 lists Kokoro before its download).
    const asleep: VoicesList = { ...VOICES, engines: [{ ...VOICES.engines[0], ready: false }] };
    expect(renderToStaticMarkup(<Fields voices={asleep} />)).not.toContain("Play sample");
  });

  test("while its sample loads or plays, the button says so", () => {
    expect(renderToStaticMarkup(<Fields sample={{ engine: "gemini", voice: "Kore", phase: "loading" }} />)).toContain('aria-label="Making the sample of Kore"');
    expect(renderToStaticMarkup(<Fields sample={{ engine: "gemini", voice: "Kore", phase: "playing" }} />)).toContain('aria-label="Stop the sample of Kore"');
  });
});

describe("Kokoro's download", () => {
  const TOTAL = 132_303_094;
  const kokoro = (state: KokoroInfo["state"], more: Partial<KokoroInfo> = {}): KokoroInfo => ({ state, done: 0, total: TOTAL, message: null, ...more });
  const KOKORO = { id: "kokoro", label: "Kokoro", service: null, local: true, ready: false, takes_style: false, voices: [] };
  const withKokoro = (info: KokoroInfo, engines = VOICES.engines): VoicesList => ({ engines: [...engines, KOKORO], default: "gemini", kokoro: info });
  const button = (html: string, label: string) => html.match(new RegExp(`<button[^>]*>(?:(?!</button>).)*${label}</button>`))?.[0];

  test("is offered for download with its size while its model isn't here", () => {
    expect(kokoroSize(kokoro("absent"))).toBe("132 MB");
    const html = renderToStaticMarkup(<Fields voices={withKokoro(kokoro("absent"))} />);
    expect(html).toContain("Kokoro · On this Mac");
    expect(button(html, "Download Kokoro \\(132 MB\\)")).not.toContain('disabled=""');
    expect(html).not.toContain("Remove Kokoro");
    // An engine that can't read isn't in the picker: Gemini is still the one chosen.
    expect(html).not.toContain('<option value="kokoro"');
    expect(html).toContain('<option value="gemini" selected="">');
  });

  test("shows its progress in megabytes with Cancel while it downloads", () => {
    const html = renderToStaticMarkup(<Fields voices={withKokoro(kokoro("downloading", { done: 45_000_000 }))} />);
    expect(html).toContain("Downloading Kokoro…");
    expect(html).toContain("45 of 132 MB");
    expect(html).toMatch(/role="progressbar" aria-label="Downloading Kokoro"[^>]*aria-valuenow="34(\.\d+)?"/);
    expect(button(html, "Cancel the download")).toBeDefined();
    expect(html).not.toContain("Download Kokoro (132 MB)");
  });

  test("tells a failed download's message, with Download again", () => {
    const message = "Kokoro's download didn't match its checksum, so it was deleted: Download it again";
    const html = renderToStaticMarkup(<Fields voices={withKokoro(kokoro("failed", { message }))} />);
    expect(html).toContain("Kokoro&#x27;s download didn&#x27;t match its checksum");
    expect(button(html, "Download Kokoro \\(132 MB\\)")).toBeDefined();
  });

  test("once here, offers Remove with the space it gives back, off while a Narration is made", () => {
    const html = renderToStaticMarkup(<Fields voices={withKokoro(kokoro("ready", { done: TOTAL }))} />);
    expect(html).toContain("Kokoro is on this Mac");
    expect(button(html, "Remove Kokoro \\(132 MB\\)")).not.toContain('disabled=""');
    expect(html).not.toContain("Download Kokoro");
    const making = renderToStaticMarkup(<Fields voices={withKokoro(kokoro("ready"))} state={{ phase: "making", start: 0, progress: null }} />);
    expect(button(making, "Remove Kokoro \\(132 MB\\)")).toContain('disabled=""');
    // A refused remove tells why.
    expect(renderToStaticMarkup(<Fields voices={withKokoro(kokoro("ready"))} kokoroMessage={KOKORO_REMOVE_BUSY} />)).toContain("Remove Kokoro once it is done");
  });

  test("with no engine ready, the hint offers the Kokoro download beside the .env settings", () => {
    const html = renderToStaticMarkup(<Fields voices={withKokoro(kokoro("absent"), [])} />);
    expect(html).toContain("<code>GEMINI_API_KEY</code>");
    expect(html).toContain("download Kokoro");
    expect(button(html, "Download Kokoro \\(132 MB\\)")).toBeDefined();
    expect(html.match(/<button type="button"[^>]*>(?:(?!<\/button>).)*Generate<\/button>/)![0]).toContain('disabled=""');
    // Without Kokoro offered, none of it shows.
    expect(renderToStaticMarkup(<Fields voices={{ engines: [], default: null }} />)).not.toContain("Kokoro");
  });

  // The Voices on a fake backend whose Kokoro is `info`, and a clock the test runs.
  function setUp(info: KokoroInfo) {
    const world = { info, listed: 0, asked: [] as KokoroAction[], refuse: null as ApiError | null };
    const timers: (() => void)[] = [];
    const source = new VoicesSource({
      list: async () => {
        world.listed += 1;
        return withKokoro(world.info);
      },
      download: async () => {
        world.asked.push("download");
        world.info = kokoro("downloading");
        return world.info;
      },
      cancel: async () => {
        world.asked.push("cancel");
        world.info = kokoro("absent");
      },
      remove: async () => {
        world.asked.push("remove");
        if (world.refuse) throw world.refuse;
        world.info = kokoro("absent");
      },
      after: (ms, run) => {
        expect(ms).toBe(KOKORO_POLL_MS);
        timers.push(run);
        return () => void timers.splice(timers.indexOf(run), 1);
      },
    });
    const tick = async () => {
      const due = timers.splice(0);
      for (const run of due) run();
      await new Promise((resolve) => setTimeout(resolve, 0));
    };
    return { world, source, timers, tick };
  }

  test("the tab polls the Voices while Kokoro downloads, and stops once it is here", async () => {
    const { world, source, timers, tick } = setUp(kokoro("absent"));
    await source.load("en");
    expect(source.state.voices?.kokoro?.state).toBe("absent");
    expect(timers).toHaveLength(0);
    await source.kokoro("download");
    expect(world.asked).toEqual(["download"]);
    expect(source.state.voices?.kokoro?.state).toBe("downloading");
    expect(timers).toHaveLength(1);
    world.info = kokoro("downloading", { done: 66_000_000 });
    await tick();
    expect(source.state.voices?.kokoro).toEqual(kokoro("downloading", { done: 66_000_000 }));
    expect(timers).toHaveLength(1);
    world.info = kokoro("ready", { done: TOTAL });
    await tick();
    expect(source.state.voices?.kokoro?.state).toBe("ready");
    expect(timers).toHaveLength(0);
  });

  test("Cancel stops the download and the polling; the tab closed stops the polling", async () => {
    const { world, source, timers } = setUp(kokoro("downloading"));
    await source.load("en");
    expect(timers).toHaveLength(1);
    await source.kokoro("cancel");
    expect(world.asked).toEqual(["cancel"]);
    expect(source.state.voices?.kokoro?.state).toBe("absent");
    expect(timers).toHaveLength(0);

    const other = setUp(kokoro("downloading"));
    await other.source.load("en");
    other.source.dispose();
    expect(other.timers).toHaveLength(0);
  });

  test("Remove deletes it; refused while a Narration is made, it says so", async () => {
    const { world, source } = setUp(kokoro("ready"));
    await source.load("en");
    world.refuse = new ApiError(409, "A Narration is being made: remove Kokoro once it is done");
    await source.kokoro("remove");
    expect(source.state.message).toBe(KOKORO_REMOVE_BUSY);
    expect(source.state.voices?.kokoro?.state).toBe("ready");
    world.refuse = null;
    await source.kokoro("remove");
    expect(source.state.message).toBeNull();
    expect(source.state.voices?.kokoro?.state).toBe("absent");
  });
});
