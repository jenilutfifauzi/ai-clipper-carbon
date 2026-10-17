// .scratch/text-advanced/issues/02-text-layers-as-pictures.md: the preview draws a Text Layer as the
// picture the backend made of it (docs/adr/0010), asking for a new one only when its look changes,
// and keeping the last one on screen until the new one has loaded.
import { describe, expect, test } from "vitest";
import type { Picture, TextEvent } from "../../../api";
import { pictureToShow, wantedPicture } from "./textPicture";

const picture = (centre: [number, number]): Picture => ({
  crop: { x: 0, y: 0, width: 300, height: 160 },
  item_size: [300, 160],
  width: 300,
  height: 160,
  centre,
  rotation: 0,
  flip_h: false,
  flip_v: false,
  opacity: 1,
  bounds: { x: centre[0] - 150, y: centre[1] - 80, width: 300, height: 160 },
  radius: 0,
  border: null,
  shadow: null,
});

// The plan's event of a layer whose look is the picture `image`, centred at `centre`.
const event = (image: string, centre: [number, number] = [540, 960]) => ({ image, picture: picture(centre) }) as TextEvent;

describe("a Text Layer's picture in the preview", () => {
  test("is asked for by its look alone: moving the layer keeps it, a new colour is another", () => {
    const here = wantedPicture("job 1", event("abc.png"));
    expect(here).toEqual({ url: "/api/jobs/job%201/texts/abc.png", width: 300, height: 160 });
    expect(wantedPicture("job 1", event("abc.png", [200, 1500])).url).toBe(here.url);
    expect(wantedPicture("job 1", event("def.png")).url).not.toBe(here.url);
  });

  test("keeps the last picture on screen until the new one has loaded", () => {
    const before = wantedPicture("j", event("abc.png"));
    const after = wantedPicture("j", event("def.png"));
    const loaded = new Set([before.url]);
    expect(pictureToShow(null, before, (url) => loaded.has(url))).toEqual(before);
    expect(pictureToShow(before, after, (url) => loaded.has(url))).toEqual(before);
    loaded.add(after.url);
    expect(pictureToShow(before, after, (url) => loaded.has(url))).toEqual(after);
    // Nothing is drawn before the first has loaded.
    expect(pictureToShow(null, after, () => false)).toBeNull();
  });
});
