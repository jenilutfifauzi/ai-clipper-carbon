// .scratch/speed/issues/12-phone.md: Speed, Reverse and Freeze frame on a phone (docs/adr/0009):
// the toolbar's Speed for one Segment or video Overlay, its sheet (each change one step of undo, every
// control a finger's size), and the toolbar's Freeze frame beside Split.
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { ClipSegment, MediaItem, Overlay } from "../../../api";
import { NO_CROP } from "../editor/cropGestures";
import { IDENTITY } from "../editor/picture";
import { Playback, playedFrom } from "../editor/playback";
import { freezer, gestureSpeed, setReverse, speedSheetItem, splitter, type Outcome, type PickContext, type SpeedRef } from "./actions";
import { Toolbar } from "./Chrome";
import type { AdvancedEdits } from "./edits";
import { picked, type Pick } from "./pick";
import { HoldFields, SpeedFields, SpeedPanel } from "./SpeedFields";
import { merges } from "./useEditHistory";

const segment = (id: string, start: number, end: number, changes: Partial<ClipSegment> = {}): ClipSegment => ({ id, start, end, ...changes });

const overlay = (id: string, media: string): Overlay => ({
  id,
  media,
  start: 0,
  secs: 2,
  offset: 0,
  transform: IDENTITY,
  crop: NO_CROP,
  volume: 0,
  radius: 0,
  border: null,
  shadow: null,
  keys: {},
});

function edits(changes: Partial<AdvancedEdits> = {}): AdvancedEdits {
  return {
    hook_start: 0,
    hook_secs: 3,
    hook_text: "Hook",
    hook_kicker: "",
    preset_id: "default",
    style_overrides: { caption: {}, hook: {}, watermark: {} },
    word_edits: [], cue_edits: [],
    layout: "auto",
    framing: null,
    layout_overrides: [],
    text_layers: [], shapes: [],
    music: [],
    source_volume: 1,
    segments: [segment("s1", 100, 106)],
    overlays: [],
    transitions: [],
    ...changes,
  };
}

function scene(state: AdvancedEdits, pick: Pick = null): PickContext {
  let n = 0;
  const played = playedFrom(state.segments);
  return { edits: state, pick, played, duration: played.at(-1)?.end ?? 0, gap: (time) => time, ids: () => `n${++n}`, magnetic: true };
}

const seg = (id: string) => ({ kind: "segment", id }) as const;
const over = (id: string) => ({ kind: "overlay", id }) as const;
const videos = (media: string) => media === "clip";
const clipEnd = (state: AdvancedEdits) => playedFrom(state.segments).at(-1)!.end;

describe("Speed in the phone's toolbar", () => {
  const state = edits({
    segments: [segment("s1", 100, 106), segment("s2", 200, 206), segment("f", 103, 103, { hold: 1 })],
    overlays: [overlay("o", "clip"), overlay("still", "png")],
  });
  const at = (pick: Pick) => speedSheetItem({ edits: state, pick }, videos);

  test("is there for one Segment, a Freeze frame or a video Overlay picked alone", () => {
    expect(at(picked(seg("s1")))).toEqual(seg("s1"));
    expect(at(picked(seg("f")))).toEqual(seg("f"));
    expect(at(picked(over("o")))).toEqual(over("o"));
  });

  test("is not for two Segments, an image, a Text Layer or nothing", () => {
    expect(at(picked(seg("s1"), seg("s2")))).toBeNull();
    expect(at(picked(over("still")))).toBeNull();
    expect(at(picked({ kind: "text", id: "t" }))).toBeNull();
    expect(at(null)).toBeNull();
  });

  // Rendered without item actions: Split and Freeze frame follow the playhead, which a page without a
  // browser can't subscribe to.
  const toolbar = (onSpeed: (() => void) | null) =>
    renderToStaticMarkup(
      <Toolbar
        pick={picked(seg("s1"))}
        actions={null}
        splitter={splitter(scene(state), () => 0, () => {})}
        freezer={freezer(scene(state), () => 0, () => {})}
        playback={new Playback()}
        picking={false}
        paste={null}
        onAsset={() => {}}
        onInspect={() => {}}
        onTransform={() => {}}
        onSpeed={onSpeed}
        onTracks={() => {}}
        onPlayback={() => {}}
        onPicking={() => {}}
        onDeselect={() => {}}
      />,
    );

  test("is a tool button, a finger's size, opening the sheet", () => {
    expect(toolbar(() => {})).toMatch(/<button type="button" class="[^"]*min-h-14 min-w-16[^"]*"><svg[^>]*>.*?<\/svg>Speed<\/button>/);
    expect(toolbar(null)).not.toContain("Speed");
  });
});

describe("the Speed sheet", () => {
  const media = new Map<string, MediaItem>([["clip", { id: "clip", kind: "video", has_audio: true } as MediaItem]]);
  // The Advanced Edit's history as the sheet changes it: each `set` with its group.
  function workspace(start: AdvancedEdits) {
    const steps: { edits: AdvancedEdits; group?: string }[] = [{ edits: start }];
    const now = () => steps.at(-1)!.edits;
    const speedGesture = gestureSpeed();
    const sheet = (item: SpeedRef) =>
      SpeedPanel({
        item,
        edits: now(),
        mediaById: media,
        copyOf: () => null,
        onSpeed: (ref, speed, group) => {
          const outcome = speedGesture(scene(now()), ref, speed, group)!;
          steps.push({ edits: outcome.edits, group });
        },
        onReverse: (ref, reverse) => steps.push({ edits: setReverse(scene(now()), ref, reverse)!.edits }),
        onHold: () => {},
        onSegment: (changed, group) => steps.push({ edits: { ...now(), segments: now().segments.map((s) => (s.id === changed.id ? changed : s)) }, group }),
        onOverlay: () => {},
      }) as ReactElement<Parameters<typeof SpeedFields>[0]>;
    return { steps, sheet };
  }
  const three = () => edits({ segments: [segment("s1", 100, 106), segment("s2", 200, 206), segment("s3", 300, 306)] });

  test("sets 2× from its chip and Reverse from its switch, each one step of undo, the Timeline updated", () => {
    const { steps, sheet } = workspace(three());
    const fields = sheet(seg("s2"));
    expect(fields.type).toBe(SpeedFields);
    expect(fields.props.group).toBe("segment:s2:speed");

    // A chip: one change of the Speed's group; the Main Track closes up by half of s2.
    fields.props.onSpeed(2, fields.props.group);
    expect(steps).toHaveLength(2);
    expect(steps[1].edits.segments[1]).toEqual(segment("s2", 200, 206, { speed: 2 }));
    expect(clipEnd(steps[1].edits)).toBe(15);
    expect(sheet(seg("s2")).props.speed).toBe(2);

    // Reverse: one change, of no group, so it never joins the Speed's step.
    sheet(seg("s2")).props.onReverse(true);
    expect(steps).toHaveLength(3);
    expect(merges({ group: "segment:s2:speed", at: 0 }, steps[2].group, 10)).toBe(false);
    expect(steps[2].edits.segments[1]).toEqual(segment("s2", 200, 206, { speed: 2, reverse: true }));
    expect(sheet(seg("s2")).props.reverse).toBe(true);

    // Undo takes back Reverse, then the Speed.
    expect(steps[1].edits.segments[1].reverse).toBeUndefined();
    expect(steps[0].edits).toEqual(three());
  });

  test("of a video Overlay changes the Overlay, with its pitch switch for its sound", () => {
    const { sheet } = workspace(edits({ overlays: [overlay("o", "clip")] }));
    const fields = sheet(over("o"));
    expect(fields.props.group).toBe("overlay:o:speed");
    expect(fields.props.heard).toBe(true);
  });

  test("of a Freeze frame shows its Duration instead", () => {
    const { sheet } = workspace(edits({ segments: [segment("s1", 100, 103), segment("f", 103, 103, { hold: 1 }), segment("s3", 103, 106)] }));
    const fields: ReactElement = sheet(seg("f"));
    expect(fields.type).toBe(HoldFields);
    expect(fields.props.hold).toBe(1);
  });

  test("has every control 44 px tall in a sheet", () => {
    const { sheet } = workspace(three());
    const fields = sheet(seg("s2"));
    expect(isValidElement(fields)).toBe(true);
    const markup = renderToStaticMarkup(fields);
    const controls = [...markup.matchAll(/<(button|input|label)\b[^>]*>/g)].map((match) => match[0]);
    // Chips, the slider, the number field, and the pitch and Reverse switches (their labels are what is tapped).
    expect(controls.filter((tag) => tag.startsWith("<button"))).toHaveLength(6);
    for (const tag of controls) {
      if (tag.startsWith("<label for=") || tag.includes("sr-only")) continue;
      expect(tag).toMatch(/min-h-11|in-data-sheet:h-11/);
    }
    expect(controls.filter((tag) => tag.includes('role="switch"'))).toHaveLength(2);
  });
});

describe("Freeze frame in the phone's toolbar", () => {
  test("inserts a 1 s Freeze frame at the playhead, picked, as one change", () => {
    const outcomes: Outcome[] = [];
    const before = edits();
    const tool = freezer(scene(before), () => 3, (outcome) => outcomes.push(outcome));
    expect(tool.canFreeze(3)).toBe(true);
    tool.freeze();

    expect(outcomes).toHaveLength(1);
    const after = outcomes[0].edits.segments;
    expect(playedFrom(after).map((shown) => [shown.start, shown.end])).toEqual([
      [0, 3],
      [3, 4],
      [4, 7],
    ]);
    expect(after[1]).toEqual(segment("n2", 103, 103, { hold: 1 }));
    expect(outcomes[0].pick).toEqual(picked(seg("n2")));
  });

  test("is off within 0.3 s of a Segment's edge", () => {
    const tool = freezer(scene(edits()), () => 0.2, () => {});
    expect(tool.canFreeze(0.2)).toBe(false);
  });
});
