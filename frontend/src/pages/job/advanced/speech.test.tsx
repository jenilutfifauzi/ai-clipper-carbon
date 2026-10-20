// .scratch/voiceover/issues/01-speech-on-music-clips.md: a Music Clip marked Speech (ADR 0018). Its
// switch in the inspector, which clears the Duck in the same change (setSpeech) and hides the duck
// control while on; none for a Music Clip of the Source; and no Duck set on a Speech one (setDuck).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";
import type { MusicClip } from "../../../api";
import { setDuck, setSpeech } from "./actions";
import type { AdvancedEdits } from "./edits";
import { SpeechFields } from "./Music";
import { picked } from "./pick";

const music = (id: string, changes: Partial<MusicClip> = {}): MusicClip => ({
  id,
  media: "memo",
  start: 0,
  secs: 10,
  offset: 0,
  volume: 1,
  fade_in: 0,
  fade_out: 0,
  keys: {},
  ...changes,
});

const edits = (clips: MusicClip[]) => ({ music: clips }) as unknown as AdvancedEdits;

describe("setSpeech", () => {
  const scene = { edits: edits([music("a", { duck: -12 }), music("b")]), pick: picked({ kind: "music", id: "a" }) };

  test("switched on, clears the Duck in the same change, keeping the rest of the clip and the Pick", () => {
    const outcome = setSpeech(scene, "a", true)!;
    expect(outcome.edits.music[0]).toEqual(music("a", { speech: true, duck: null }));
    expect(outcome.edits.music[1]).toBe(scene.edits.music[1]);
    expect(outcome.pick).toBe(scene.pick);
  });

  test("switched off, leaves the Duck off", () => {
    const speech = { edits: edits([music("a", { speech: true, duck: null })]), pick: null };
    expect(setSpeech(speech, "a", false)!.edits.music[0]).toEqual(music("a", { speech: false, duck: null }));
  });

  test("refuses a Music Clip of the Source, whose Words are its speech, and one that isn't there", () => {
    expect(setSpeech({ edits: edits([music("s", { media: null })]), pick: null }, "s", true)).toBeNull();
    expect(setSpeech(scene, "gone", true)).toBeNull();
  });

  test("leaves a Speech Music Clip without a Duck", () => {
    expect(setDuck({ edits: edits([music("a", { speech: true })]), pick: null }, "a", -12)).toBeNull();
  });
});

describe("the inspector of a Music Clip", () => {
  // Its Sound group's Speech switch and duck control, as MusicFields lays them.
  const fields = (clip: MusicClip) => renderToStaticMarkup(<SpeechFields clip={clip} onSpeech={() => {}} onDuck={() => {}} />);

  test("shows the Speech switch, and the duck control only while it is off", () => {
    const off = fields(music("a", { duck: -12 }));
    expect(off).toContain(">Speech<");
    expect(off).toContain("Duck under speech");
    expect(off).toContain("Depth");
    const on = fields(music("a", { speech: true }));
    expect(on).toContain(">Speech<");
    expect(on).not.toContain("Duck under speech");
    expect(on).not.toContain("Depth");
  });

  test("of the Source shows no Speech switch", () => {
    expect(fields(music("s", { media: null }))).toBe("");
  });
});
