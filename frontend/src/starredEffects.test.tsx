// .scratch/video-effects/issues/09: starred effects, one list on the server for every Job, a star on
// every library tile and a Starred chip keeping the library to them.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, type VideoEffectKind } from "./api";
import catalogue from "../../backend/tests/fixtures/video_effects.json";
import { EffectCards } from "./pages/job/advanced/EffectsPanel";
import { videoLibraryOf } from "./videoEffects";

const kinds = catalogue as VideoEffectKind[];

// A fresh store for each test: the list is the module's, loaded once for the page.
async function freshStore() {
  vi.resetModules();
  const { api } = await import("./api");
  const store = await import("./starredEffects");
  return { api, ...store };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toggling a star", () => {
  let saved: string[][];
  beforeEach(() => {
    saved = [];
  });

  test("stars and unstars from the server's list and saves the whole list", async () => {
    const { api, toggleStar, starredOnly } = await freshStore();
    vi.spyOn(api, "listStarredEffects").mockResolvedValue(["denoise", "gone-effect"]);
    vi.spyOn(api, "setStarredEffects").mockImplementation(async (ids) => (saved.push(ids), ids));

    await toggleStar("glow");
    // An id the catalogue no longer has stays in the list.
    expect(saved).toEqual([["denoise", "gone-effect", "glow"]]);
    await toggleStar("denoise");
    expect(saved.at(-1)).toEqual(["gone-effect", "glow"]);
    expect(api.listStarredEffects).toHaveBeenCalledTimes(1);

    // ...but it shows no card.
    expect(starredOnly(kinds, saved.at(-1)!, true).map((kind) => kind.id)).toEqual(["glow"]);
  });

  test("two quick toggles each start from the list the one before left", async () => {
    const { api, toggleStar } = await freshStore();
    vi.spyOn(api, "listStarredEffects").mockResolvedValue([]);
    vi.spyOn(api, "setStarredEffects").mockImplementation(async (ids) => (saved.push(ids), ids));

    await Promise.all([toggleStar("glow"), toggleStar("pixelate"), toggleStar("glow")]);
    expect(saved).toEqual([["glow"], ["glow", "pixelate"], ["pixelate"]]);
  });

  test("a failed save lists the server's again", async () => {
    const { api, toggleStar } = await freshStore();
    const listed = vi.spyOn(api, "listStarredEffects").mockResolvedValue(["fisheye"]);
    vi.spyOn(api, "setStarredEffects").mockRejectedValueOnce(new Error("offline")).mockImplementation(async (ids) => (saved.push(ids), ids));

    await toggleStar("glow");
    expect(listed).toHaveBeenCalledTimes(2);
    await toggleStar("pixelate");
    expect(saved).toEqual([["fisheye", "pixelate"]]);
  });
});

describe("the Starred chip", () => {
  test("keeps a library to its starred effects, in the catalogue's order; off, it keeps them all", async () => {
    const { starredOnly } = await freshStore();
    const stars = ["glow", "gaussian-blur", "denoise"];
    expect(videoLibraryOf(starredOnly(kinds, stars, true), "", true)).toEqual([
      { category: "Blur", effects: [kinds.find((kind) => kind.id === "gaussian-blur")] },
      { category: "Light", effects: [kinds.find((kind) => kind.id === "glow")] },
    ]);
    expect(starredOnly(kinds, stars, false)).toBe(kinds);
    expect(starredOnly(kinds, null, true)).toEqual([]);
  });
});

describe("the Effects tab's stars", () => {
  test("every card has a star, pressed when starred, and the tab has a Starred chip", () => {
    vi.spyOn(api, "listStarredEffects").mockResolvedValue([]);
    const frame = { url: "/strip.jpg", strip: { index: 3, count: 30 } };
    const markup = renderToStaticMarkup(<EffectCards kinds={kinds} starred={["glow", "gone-effect"]} frame={frame} keys onPick={() => {}} onAudition={() => {}} />);
    const stars = Object.fromEntries([...markup.matchAll(/<button[^>]*data-star="([^"]*)"[^>]*aria-pressed="(true|false)"/g)].map(([, id, pressed]) => [id, pressed]));
    expect(Object.keys(stars).sort()).toEqual(kinds.map((kind) => kind.id).sort());
    expect(Object.entries(stars).filter(([, pressed]) => pressed === "true")).toEqual([["glow", "true"]]);
    // The star is beside the card's button, not in it.
    expect(markup).not.toMatch(/data-effect="[^"]*"(?:(?!<\/button>).)*data-star/s);
    expect(markup).toMatch(/aria-pressed="false"[^>]*>(?:<svg[^]*?<\/svg>)?Starred<\/button>/);
  });
});
