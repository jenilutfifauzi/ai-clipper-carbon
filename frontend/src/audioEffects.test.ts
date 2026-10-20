import { describe, expect, test } from "vitest";
import type { AudioEffectKind } from "./api";
import { libraryOf } from "./audioEffects";

const kind = (id: string, name: string, group: AudioEffectKind["group"], order: number, description = ""): AudioEffectKind => ({ id, name, group, order, description, settings: [] });
const catalogue = [
  kind("echo", "Echo", "Space", 2, "Repeats of the sound"),
  kind("normalize", "Normalize loudness", "Clean", 3),
  kind("telephone", "Telephone", "Voice", 1, "A thin, narrow line"),
  kind("hall", "Hall", "Space", 1),
  kind("bass", "Bass boost", "Tone", 1),
  kind("robot", "Robot", "Voice", 0),
];

describe("the Add effect library", () => {
  test("lists Voice, Tone and Space in that order, each by its order, and leaves the Clean effects out", () => {
    expect(libraryOf(catalogue, "").map(({ group, effects }) => [group, effects.map((effect) => effect.id)])).toEqual([
      ["Voice", ["robot", "telephone"]],
      ["Tone", ["bass"]],
      ["Space", ["hall", "echo"]],
    ]);
  });

  test("a search keeps the effects whose name or description has it, ignoring case, and drops empty groups", () => {
    expect(libraryOf(catalogue, " ECHO").map(({ group, effects }) => [group, effects.map((effect) => effect.id)])).toEqual([["Space", ["echo"]]]);
    expect(libraryOf(catalogue, "narrow")[0].effects.map((effect) => effect.id)).toEqual(["telephone"]);
    expect(libraryOf(catalogue, "loudness")).toEqual([]);
  });
});
