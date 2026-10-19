// .scratch/transitions-expanded/issues/01, 02 and 04: the preview's catalogue of Transition kinds, each
// with its label, group and look, by the knobs it reads.
import { describe, expect, test } from "vitest";
import { rgbsplitFilter, showLook, TRANSITION_GROUPS, TRANSITION_KINDS, TRANSITIONS, type LayerLook } from "./transitions";

// A layer as the preview styles it.
const layer = () => ({ style: {} as CSSStyleDeclaration });

// CSS functions in a value (`translateX(-50%) scale(1)`), each with its arguments' numbers.
const functions = (value: string) =>
  [...value.matchAll(/([\w-]+)\(((?:[^()]|\([^()]*\))*)\)/g)].map(([, name, args]) => ({ name, args, numbers: [...args.matchAll(/-?[\d.]+/g)].map(Number) }));

// How much of a mask a gradient of hard stops leaves: its transparent and black shares, or null when
// it fades between them somewhere.
function maskShares(mask: string): { transparent: number; black: number } | null {
  const [gradient] = functions(mask);
  if (!gradient || !gradient.name.endsWith("gradient")) return null;
  // Its stops, each a colour at a share of the gradient's line (a turn, for a conic one).
  const stops = gradient.args
    .split(/,(?![^(]*\))/)
    .map((part) => part.trim().split(/\s+/))
    .filter(([colour]) => colour === "transparent" || colour === "black")
    .flatMap(([colour, ...at]) =>
      at.map((position) => ({ colour, at: position.endsWith("deg") ? parseFloat(position) / 360 : position.endsWith("turn") ? parseFloat(position) : parseFloat(position) / 100 })),
    );
  const period = gradient.name.startsWith("repeating") ? stops[stops.length - 1].at : 1;
  const points = [{ ...stops[0], at: 0 }, ...stops, { ...stops[stops.length - 1], at: period }];
  const shares = { transparent: 0, black: 0 };
  for (let i = 1; i < points.length; i++) {
    const width = Math.min(points[i].at, period) - Math.max(points[i - 1].at, 0);
    if (width <= 1e-9) continue;
    if (points[i].colour !== points[i - 1].colour) return null;
    shares[points[i].colour as "transparent" | "black"] += width / period;
  }
  return shares;
}

// What a layer shows of its picture with `look`: all of it as it is, none of it, or some.
function shows(look: LayerLook): "all" | "none" | "some" {
  const transform = functions(look.transform ?? "");
  const clip = functions(look.clipPath ?? "");
  const mask = look.maskImage ? maskShares(look.maskImage) : { transparent: 0, black: 1 };
  const inset = clip.find((f) => f.name === "inset")?.numbers;
  // inset()'s one to four sides, as CSS reads them: top, right, bottom, left.
  const [top, right, bottom, left] = inset ? [inset[0], inset[1] ?? inset[0], inset[2] ?? inset[0], inset[3] ?? inset[1] ?? inset[0]] : [0, 0, 0, 0];
  const circle = clip.find((f) => f.name === "circle")?.numbers[0];
  const gone =
    look.opacity === 0 ||
    transform.some((f) => (f.name.startsWith("translate") && f.numbers.some((n) => Math.abs(n) >= 100)) || (f.name.startsWith("scale") && f.numbers.includes(0))) ||
    top + bottom >= 100 ||
    left + right >= 100 ||
    circle === 0 ||
    mask?.black === 0;
  if (gone) return "none";
  const whole =
    (look.opacity === undefined || look.opacity === 1) &&
    transform.every((f) => (f.name.startsWith("translate") ? f.numbers.every((n) => n === 0) : f.name.startsWith("scale") && f.numbers.every((n) => n === 1))) &&
    top + right + bottom + left === 0 &&
    (circle === undefined || circle >= 70.72) &&
    clip.every((f) => f.name === "inset" || f.name === "circle") &&
    mask?.transparent === 0 &&
    functions(look.filter ?? "").every((f) => f.name !== "url" && f.numbers.every((n) => n === (["brightness", "contrast", "saturate"].includes(f.name) ? 1 : 0)));
  return whole ? "all" : "some";
}

// A veil shows nothing without a colour or at no opacity.
const unveiled = (veil: LayerLook) => !veil.background || veil.opacity === 0;

describe("the Transition catalogue", () => {
  test("lists every kind by group, in the Transitions tab's order", () => {
    const listed = TRANSITION_GROUPS.map((group) => [group, TRANSITION_KINDS.filter((kind) => TRANSITIONS[kind].group === group).map((kind) => TRANSITIONS[kind].label)]);
    expect(listed).toEqual([
      ["Basic", ["Fade", "Dip to black", "Dip to white", "Dip through grey", "Dip to colour", "Dissolve"]],
      ["Slide", ["Push left", "Push right", "Push up", "Push down", "Cover left", "Cover right", "Cover up", "Cover down"]],
      ["Wipe", ["Wipe left", "Wipe right", "Wipe up", "Wipe down", "Clock wipe"]],
      ["Shape", ["Circle open", "Circle close", "Iris", "Box", "Doors vertical", "Doors horizontal"]],
      ["Zoom", ["Zoom in", "Squeeze across", "Squeeze down"]],
      ["Light", ["Film burn", "Light leak"]],
      ["Glitch", ["RGB split", "Pixelize", "Blur", "Distance", "Slices"]],
    ]);
    // In the tab's order, group by group.
    expect(TRANSITION_KINDS).toEqual(listed.flatMap(([, labels]) => labels).map((label) => TRANSITION_KINDS.find((kind) => TRANSITIONS[kind].label === label)));
  });

  test.each(TRANSITION_KINDS)("%s shows only the outgoing picture at its start and only the incoming one at its end", (kind) => {
    const start = TRANSITIONS[kind].look(0);
    expect(shows(start.outgoing)).toBe("all");
    expect(unveiled(start.veil)).toBe(true);
    const end = TRANSITIONS[kind].look(1);
    expect(shows(end.outgoing)).toBe("none");
    expect(shows(end.incoming)).toBe("all");
    expect(unveiled(end.veil)).toBe(true);
    // And something of both, or of neither (a dip), in its middle.
    const middle = TRANSITIONS[kind].look(0.4);
    expect(shows(middle.outgoing) !== "all" || !unveiled(middle.veil)).toBe(true);
  });

  test("Push moves both pictures, Cover only the incoming one", () => {
    expect(TRANSITIONS.slideleft.look(0.25)).toMatchObject({ outgoing: { transform: "translateX(-25%)" }, incoming: { transform: "translateX(75%)" } });
    expect(TRANSITIONS.slideup.look(0.25)).toMatchObject({ outgoing: { transform: "translateY(-25%)" }, incoming: { transform: "translateY(75%)" } });
    const cover = TRANSITIONS.coverleft.look(0.25);
    expect(cover.incoming.transform).toBe("translateX(75%)");
    expect(cover.outgoing.transform).toBeUndefined();
    expect(shows(cover.outgoing)).toBe("some");
  });

  test("a look shown on a layer replaces what the last one set there", () => {
    const outgoing = layer();
    const veil = layer();
    showLook(TRANSITIONS.slideleft.look(0.5).outgoing, outgoing);
    expect(outgoing.style.transform).toBe("translateX(-50%)");
    showLook(TRANSITIONS.fade.look(0.25).outgoing, outgoing);
    expect(outgoing.style).toMatchObject({ transform: "", opacity: "0.75" });
    showLook(TRANSITIONS.hblur.look(0.25).outgoing, outgoing);
    expect(outgoing.style.filter).not.toBe("");
    showLook(TRANSITIONS.fade.look(0.25).outgoing, outgoing);
    expect(outgoing.style.filter).toBe("");

    showLook(TRANSITIONS.fadeblack.look(0.25).veil, veil);
    expect(veil.style).toMatchObject({ background: "#000", opacity: "0.5" });
    showLook(TRANSITIONS.fade.look(0.25).veil, veil);
    expect(veil.style).toMatchObject({ background: "", opacity: "" });
  });

  test("only Film burn, Light leak and RGB split read a strength, with their own defaults, and only Dip to colour a colour", () => {
    expect(TRANSITION_KINDS.filter((kind) => TRANSITIONS[kind].strength !== undefined).map((kind) => [kind, TRANSITIONS[kind].strength])).toEqual([
      ["filmburn", 0.6],
      ["lightleak", 0.7],
      ["rgbsplit", 0.5],
    ]);
    expect(TRANSITION_KINDS.filter((kind) => TRANSITIONS[kind].colour !== undefined)).toEqual(["dipcolour"]);
  });

  test("Dip to colour dips through its colour, black when unset", () => {
    expect(TRANSITIONS.dipcolour.look(0.5, { colour: "#3366FF" }).veil).toEqual({ background: "#3366FF", opacity: 1 });
    expect(TRANSITIONS.dipcolour.look(0.25, { colour: null }).veil).toEqual({ background: "#000000", opacity: 0.5 });
    expect(TRANSITIONS.dipcolour.look(0.75).outgoing.opacity).toBe(0);
  });

  test.each(["filmburn", "lightleak"] as const)("%s blends a warm layer over both, as strong as the strength, brightest halfway", (kind) => {
    const { look } = TRANSITIONS[kind];
    const middle = look(0.5, { strength: 0.8 }).veil;
    expect(middle).toMatchObject({ mixBlendMode: "screen", opacity: 0.8 });
    expect(middle.background).toMatch(/gradient\(/);
    expect(look(0.25, { strength: 0.8 }).veil.opacity).toBeCloseTo(0.4);
    expect(unveiled(look(0.5, { strength: 0 }).veil)).toBe(true);
    // Unset, its kind's own.
    expect(look(0.5).veil.opacity).toBe(TRANSITIONS[kind].strength);
    // A Light leak's band moves across as it goes.
    if (kind === "lightleak") expect(look(0.25).veil.background).not.toBe(look(0.75).veil.background);
  });

  test("RGB split parts both pictures by the strength, in tenths, and not at all at none", () => {
    expect(TRANSITIONS.rgbsplit.look(0.5, { strength: 1 })).toMatchObject({
      outgoing: { opacity: 0.5, filter: `url(#${rgbsplitFilter(10)})` },
      incoming: { filter: `url(#${rgbsplitFilter(10)})` },
    });
    expect(TRANSITIONS.rgbsplit.look(0.2, { strength: 0.33 }).incoming.filter).toBe(`url(#${rgbsplitFilter(3)})`);
    expect(TRANSITIONS.rgbsplit.look(0.5).incoming.filter).toBe(`url(#${rgbsplitFilter(5)})`);
    expect(TRANSITIONS.rgbsplit.look(0.5, { strength: 0 }).incoming.filter).toBeUndefined();
  });

  test("a look's blend is cleared with it", () => {
    const veil = layer();
    showLook(TRANSITIONS.filmburn.look(0.5).veil, veil);
    expect(veil.style.mixBlendMode).toBe("screen");
    showLook(TRANSITIONS.fade.look(0.5).veil, veil);
    expect(veil.style.mixBlendMode).toBe("");
  });
});
