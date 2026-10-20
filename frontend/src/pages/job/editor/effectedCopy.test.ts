import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioEvent, EffectedCopy, RenderPlan, SegmentPlan, TransitionEvent } from "../../../api";
import { askWhenSettled, copySounds, effectedAsks, effectsPreparing, forgetEffectedCopies, SETTLE_MS, urlOf, type EffectedAsk } from "./effectedCopy";
import { loudness } from "./loudness";

const TELEPHONE = [{ id: "telephone", params: { drive: 3 }, enabled: true }];

const segment = (fields: Partial<SegmentPlan>): SegmentPlan =>
  ({ start: 0, end: 2, source_start: 10, source_end: 12, volume: 1, silent: false, scenes: 1, gain: [], id: "a", fade_in: 0, fade_out: 0, ...fields }) as SegmentPlan;

const sound = (fields: Partial<AudioEvent>): AudioEvent => ({
  media: "song",
  start: 1,
  end: 3,
  offset: 0,
  volume: 1,
  fade_in: 0,
  fade_out: 0,
  gain: [],
  id: "m",
  ...fields,
});

const planOf = (fields: Partial<RenderPlan>): RenderPlan =>
  ({ segments: [], audio: [], overlays: [], transitions: [], source_volume: 1, ...fields }) as unknown as RenderPlan;

const keyOf = (plan: RenderPlan) => effectedAsks(plan)[0]?.key;

describe("effectedAsks", () => {
  it("asks for each sounding item with effects: Segments, Music Clips and Overlay videos' sounds", () => {
    const plan = planOf({
      segments: [segment({ id: "a", audio_effects: TELEPHONE }), segment({ id: "b", start: 2, end: 4 })],
      audio: [sound({ id: "m", audio_effects: TELEPHONE }), sound({ id: "o", media: "video", audio_effects: TELEPHONE })],
      overlays: [{ id: "o" } as RenderPlan["overlays"][number]],
    });
    expect(effectedAsks(plan).map(({ kind, id }) => `${kind}:${id}`)).toEqual(["segment:a", "music:m", "overlay:o"]);
  });

  it("has no ask for a Muted item, a Freeze frame, a silent video's Segment or no plan", () => {
    const plan = planOf({
      segments: [
        segment({ id: "muted", muted: true, audio_effects: TELEPHONE }),
        segment({ id: "still", hold: 1, audio_effects: TELEPHONE }),
        segment({ id: "silent", media: "v", silent: true, audio_effects: TELEPHONE }),
      ],
      audio: [sound({ muted: true, audio_effects: TELEPHONE })],
    });
    expect(effectedAsks(plan)).toEqual([]);
    expect(effectedAsks(null)).toEqual([]);
  });

  it("keys a copy by what it is made from: its range, Speed, pitch, Reverse and stack, not its volume, fades or place", () => {
    const base = planOf({ segments: [segment({ audio_effects: TELEPHONE })] });
    const same = [{ volume: 0.3, fade_in: 1, start: 5, end: 7 }, { gain: [{ time: 0, value: 0.5 }] }] as Partial<SegmentPlan>[];
    for (const fields of same) expect(keyOf(planOf({ segments: [segment({ audio_effects: TELEPHONE, ...fields })] }))).toBe(keyOf(base));
    const other: Partial<SegmentPlan>[] = [
      { source_start: 11 },
      { speed: 2, end: 1 },
      { pitch: true },
      { reverse: true },
      { media: "v" },
      { audio_effects: [{ id: "telephone", params: { drive: 4 }, enabled: true }] },
    ];
    for (const fields of other) expect(keyOf(planOf({ segments: [segment({ audio_effects: TELEPHONE, ...fields })] }))).not.toBe(keyOf(base));
  });
});

describe("copySounds", () => {
  it("plays each copy at 1× from its start, in the item's own time, at its volume and fades", () => {
    const plan = planOf({ segments: [segment({ start: 1, end: 3, volume: 0.5, fade_in: 1, speed: 2 })], source_volume: 0.8 });
    const [heard] = copySounds(plan, [{ kind: "segment", id: "a", url: "/copy.wav" }]);
    expect(heard.span).toEqual({ start: 1, end: 3, from: 0 });
    expect(loudness(heard.sound, 2.5, heard.crossed)).toBeCloseTo(0.4);
    expect(loudness(heard.sound, 1.5, heard.crossed)).toBeCloseTo(0.2);
  });

  it("under a Transition, hears the outgoing Segment through its copy over the overlap, as the incoming one is brought in", () => {
    const transition: TransitionEvent = { kind: "fade", start: 1.5, end: 2, sound: "linear" } as TransitionEvent;
    const plan = planOf({
      segments: [segment({ id: "a", start: 0, end: 2 }), segment({ id: "b", start: 1.5, end: 4 })],
      transitions: [transition],
    });
    const [outgoing, incoming] = copySounds(plan, [
      { kind: "segment", id: "a", url: "/a.wav" },
      { kind: "segment", id: "b", url: "/b.wav" },
    ]);
    expect(outgoing.span).toEqual({ start: 0, end: 2, from: 0 });
    expect(loudness(outgoing.sound, 1.75, outgoing.crossed)).toBeCloseTo(0.5);
    expect(loudness(incoming.sound, 1.75, incoming.crossed)).toBeCloseTo(0.5);
    expect(loudness(incoming.sound, 3, incoming.crossed)).toBeCloseTo(1);
  });

  it("hears a Music Clip's copy at its volume, the Clip's own for one of the Source's, ducked as it is", () => {
    const plan = planOf({ audio: [sound({ id: "s", media: null, source: true, volume: 0.5 })], source_volume: 0.5 });
    const [heard] = copySounds(plan, [{ kind: "music", id: "s", url: "/s.wav" }]);
    expect(heard.span).toEqual({ start: 1, end: 3, from: 0 });
    expect(loudness(heard.sound, 2, heard.crossed)).toBeCloseTo(0.25);
  });
});

describe("asking for copies", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    forgetEffectedCopies();
  });
  afterEach(() => vi.useRealTimers());

  const ask = (key: string, id = "a"): EffectedAsk => ({ kind: "segment", id, key });

  it("asks once the asks have settled, so a slider dragged asks only for where it stops", async () => {
    const asked: string[] = [];
    const request = (item: EffectedAsk) => {
      asked.push(item.key);
      return Promise.resolve<EffectedCopy>({ url: `/${item.key}.wav` });
    };
    const stop = askWhenSettled([ask("k1")], request);
    vi.advanceTimersByTime(SETTLE_MS / 2);
    stop();
    askWhenSettled([ask("k2")], request);
    // Preparing while it settles and while it is made.
    expect(effectsPreparing([{ kind: "segment", id: "a" }])).toBe(true);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(asked).toEqual(["k2"]);
    expect(urlOf({ kind: "segment", id: "a" })).toBe("/k2.wav");
    expect(effectsPreparing([{ kind: "segment", id: "a" }])).toBe(false);
    // Asked again for the same key, it isn't asked again.
    askWhenSettled([ask("k2")], request);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(asked).toEqual(["k2"]);
  });

  it("falls back to the item's own sound for an item without a copy or one that failed, which isn't preparing", async () => {
    askWhenSettled([ask("none", "a"), ask("bad", "b")], (item) =>
      item.key === "bad" ? Promise.reject(new Error("ffmpeg")) : Promise.resolve<EffectedCopy>({ url: null, why: "Muted" }),
    );
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    expect(urlOf({ kind: "segment", id: "a" })).toBeNull();
    expect(urlOf({ kind: "segment", id: "b" })).toBeNull();
    expect(effectsPreparing([{ kind: "segment", id: "a" }, { kind: "segment", id: "b" }])).toBe(false);
    // An item not asked for isn't preparing either.
    expect(effectsPreparing([{ kind: "music", id: "z" }])).toBe(false);
  });

  it("follows the items the plan has now: an item no longer asked for has no copy", async () => {
    const request = (item: EffectedAsk) => Promise.resolve<EffectedCopy>({ url: `/${item.key}.wav` });
    askWhenSettled([ask("k1")], request);
    await vi.advanceTimersByTimeAsync(SETTLE_MS);
    askWhenSettled([], request);
    expect(urlOf({ kind: "segment", id: "a" })).toBeNull();
  });
});
