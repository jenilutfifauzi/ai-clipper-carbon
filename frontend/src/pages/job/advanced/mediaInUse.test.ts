// .scratch/templates/issues/09-library-guards.md: a Media Library item a Template uses can't be
// deleted, and the Media Library's "in use" message names the Template beside the clips.
import { describe, expect, test } from "vitest";
import type { MediaUse } from "../../../api";
import { inUse } from "./MediaLibrary";

const clip = (title: string): MediaUse => ({ kind: "candidate", job_id: "j1", candidate_id: "c1", template_id: null, title });
const template = (title: string): MediaUse => ({ kind: "template", job_id: null, candidate_id: null, template_id: "t1", title });

describe("the Media Library's in-use message", () => {
  test("names the clips using an item", () => {
    expect(inUse([clip("Podcast")])).toBe("It is used by a clip: Podcast. Remove it from that clip first.");
    expect(inUse([clip("A"), clip("B")])).toBe("It is used by 2 clips: A, B. Remove it from them first.");
  });

  test("names a Template using it", () => {
    expect(inUse([template("Brand")])).toBe("It is used by a Template: Template “Brand”. Remove it from that Template first.");
    expect(inUse([clip("Podcast"), template("Brand")])).toBe(
      "It is used by a clip and a Template: Podcast, Template “Brand”. Remove it from them first.",
    );
  });
});
