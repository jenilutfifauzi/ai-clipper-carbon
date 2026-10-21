import type { Adjust, Grade, LookFit, RenderPlan } from "../../../api";

/**
 * The fold of a Grade (ADR 0013): its Adjust turned into one table per channel, one colour matrix and
 * the sharpen and vignette amounts, which the preview draws as an SVG filter (GradeFilters.tsx: an
 * feComponentTransfer of the tables, then an feColorMatrix, then an feConvolveMatrix for sharpen, in
 * sRGB) and a radial gradient layer over it for vignette; those two are near the render's, not exact. The render folds it the same way (backend/app/grading.py, whose
 * docstring gives the maths), and both test suites read the same cases
 * (backend/tests/fixtures/grade_folds.json), so that the two can't drift.
 *
 * A Grade's Look is a set of Adjust values laid over the Grade's own (`withLook`): each dial moved by
 * as much as the Look's is from neutral, held within its range, so the Look styles what the dials
 * corrected. That Adjust is folded as any other, and the Look's intensity mixes it over the fold
 * without the Look, entry by entry (a missing table or matrix the identity): at 0 the fold without
 * it, at 100 the fold with it. The Looks' values come from the catalogue (looks.ts, `knowLooks`); a
 * Look not (yet) known is drawn as none.
 *
 * An Imported Look also has a 3D table, which the render draws with lut3d after the tables and matrix
 * and before sharpen and vignette, mixed over the picture by the intensity. The preview draws the
 * table per channel and the matrix fitted to it at import (its `fit`) in its place (`Folded.lut`),
 * mixed so too (GradeFilters.tsx): near, not exact.
 */

export const TABLE_SIZE = 256;
// The luma weights (Rec. 709) a saturation change keeps, and the temperature and tint gains too.
const LUMA = [0.2126, 0.7152, 0.0722] as const;
const NEUTRAL_K = 6500;
// How far each dial goes at its end (as backend/app/grading.py).
const TEMPERATURE_GAIN = 0.25;
const TEMPERATURE_SPAN_K = 4500;
const TINT_GAIN = 0.2;
const CONTRAST_STOPS = 1.5;
const TONE_SHIFT = 0.15;
const END_SHIFT = 0.25;
const FADE_LIFT = 0.25;
const FADE_DIM = 0.05;
const SHARPEN_AMOUNT = 2;
const VIGNETTE_ANGLE = Math.PI / 2;

export const NEUTRAL_ADJUST: Adjust = {
  temperature: NEUTRAL_K,
  tint: 0,
  saturation: 0,
  exposure: 0,
  brightness: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  whites: 0,
  blacks: 0,
  sharpen: 0,
  fade: 0,
  vignette: 0,
};
export const NEUTRAL_GRADE: Grade = { adjust: NEUTRAL_ADJUST, look: null, intensity: 100 };

// Each dial's range (backend/app/candidates.py's Adjust), which a Look's added values are held within.
const DIAL_RANGES: Partial<Record<keyof Adjust, [number, number]>> = {
  temperature: [2000, 11000],
  exposure: [-3, 3],
  sharpen: [0, 100],
  fade: [0, 100],
  vignette: [0, 100],
};

// The Adjust values of each Look known, by its id (looks.ts registers the catalogue's), and the fit
// of each one with a 3D table (an Imported Look's).
const lookAdjusts = new Map<string, Adjust>();
const lookFits = new Map<string, LookFit>();

/** Make the Looks' Adjust values (and fits) known to the fold, replacing those known before. */
export function knowLooks(looks: { id: string; adjust: Adjust; fit?: LookFit | null }[]) {
  lookAdjusts.clear();
  lookFits.clear();
  for (const { id, adjust, fit } of looks) {
    lookAdjusts.set(id, { ...NEUTRAL_ADJUST, ...adjust });
    if (fit) lookFits.set(id, fit);
  }
}

/** The Adjust values of the Look `id`, or null while it isn't known. */
export const lookAdjust = (id: string | null | undefined): Adjust | null => (id == null ? null : (lookAdjusts.get(id) ?? null));

export type Matrix = [[number, number, number], [number, number, number], [number, number, number]];

// A Grade as the preview draws it: a table per channel (R, G, B; TABLE_SIZE entries, the output for
// input i / (TABLE_SIZE − 1), 0..1), then a colour matrix (rows R, G, B of weights on R, G, B); each
// null when it would change nothing; then the sharpen and vignette amounts (0..100, 0 for none); and
// an Imported Look's table (its Look, the intensity it is mixed at, and its fit), drawn after the
// tables and matrix and before sharpen, or none.
export interface Folded {
  tables: [number[], number[], number[]] | null;
  matrix: Matrix | null;
  sharpen: number;
  vignette: number;
  lut?: { look: string; intensity: number; fit: LookFit } | null;
}

// A Grade as stored or planned, a missing dial at its neutral value (one saved before Grades has none).
export const gradeOf = (grade: Partial<Grade> | null | undefined): Grade => ({
  ...NEUTRAL_GRADE,
  ...grade,
  adjust: { ...NEUTRAL_ADJUST, ...grade?.adjust },
});

/** Whether `grade` leaves the picture as it is: every dial neutral, and no Look. */
export function isNeutral(grade: Partial<Grade> | null | undefined): boolean {
  const { adjust, look } = gradeOf(grade);
  return look == null && (Object.keys(NEUTRAL_ADJUST) as (keyof Adjust)[]).every((dial) => adjust[dial] === NEUTRAL_ADJUST[dial]);
}

/**
 * `grade` folded into its tables, matrix and amounts; null for a neutral one, which adds no filter.
 * `look` is the Adjust of its Look and `fit` its table's (an Imported Look's), by default the
 * catalogue's (none while it isn't known).
 */
export function foldGrade(grade: Partial<Grade> | null | undefined, look?: Partial<Adjust> | null, fit?: LookFit | null): Folded | null {
  const { adjust, look: id, intensity } = gradeOf(grade);
  const without = foldAdjust(adjust);
  const values = id == null ? null : look ? { ...NEUTRAL_ADJUST, ...look } : lookAdjust(id);
  if (!values || intensity <= 0) return without;
  const looked = foldAdjust(withLook(adjust, values));
  const folded = intensity >= 100 ? looked : mixed(without, looked, intensity / 100);
  const table = look ? fit : (lookFits.get(id!) ?? null);
  if (!table) return folded;
  return { ...(folded ?? { tables: null, matrix: null, sharpen: 0, vignette: 0 }), lut: { look: id!, intensity, fit: table } };
}

/** `adjust` with a Look's values laid over it: each dial moved by as much as the Look's is from neutral, held within its range. */
export function withLook(adjust: Adjust, look: Adjust): Adjust {
  const moved = { ...adjust };
  for (const dial of Object.keys(NEUTRAL_ADJUST) as (keyof Adjust)[]) {
    const [low, high] = DIAL_RANGES[dial] ?? [-100, 100];
    moved[dial] = Math.min(high, Math.max(low, adjust[dial] + (look[dial] - NEUTRAL_ADJUST[dial])));
  }
  return moved;
}

function foldAdjust(adjust: Adjust): Folded | null {
  const tables = foldTables(adjust);
  const matrix = foldMatrix(adjust);
  const { sharpen, vignette } = adjust;
  return tables === null && matrix === null && !sharpen && !vignette ? null : { tables, matrix, sharpen, vignette };
}

const IDENTITY_TABLE = Array.from({ length: TABLE_SIZE }, (_, i) => i / (TABLE_SIZE - 1));
const IDENTITY_MATRIX: Matrix = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

// `b` mixed over `a` by `t` (0..1), entry by entry; a missing table or matrix is the identity.
function mixed(a: Folded | null, b: Folded | null, t: number): Folded | null {
  if (!a && !b) return null;
  const mix = (x: number, y: number) => x + (y - x) * t;
  const mixRows = <R extends number[]>(p: R[], q: R[]) => p.map((row, i) => row.map((x, j) => mix(x, q[i][j])));
  const tables =
    a?.tables || b?.tables
      ? (mixRows(a?.tables ?? [IDENTITY_TABLE, IDENTITY_TABLE, IDENTITY_TABLE], b?.tables ?? [IDENTITY_TABLE, IDENTITY_TABLE, IDENTITY_TABLE]) as Folded["tables"])
      : null;
  const matrix = a?.matrix || b?.matrix ? (mixRows(a?.matrix ?? IDENTITY_MATRIX, b?.matrix ?? IDENTITY_MATRIX) as Matrix) : null;
  return { tables, matrix, sharpen: mix(a?.sharpen ?? 0, b?.sharpen ?? 0), vignette: mix(a?.vignette ?? 0, b?.vignette ?? 0) };
}

/**
 * The 3×3 kernel (rows top to bottom) that sharpens by `amount` (0..100): the picture plus its
 * difference from a 3×3 box blur of it, times up to SHARPEN_AMOUNT, as the render's unsharp (which
 * does it on the luma only; this on R, G and B). It sums to 1, so a flat patch stays.
 */
export function sharpenKernel(amount: number): number[] {
  const k = (SHARPEN_AMOUNT * amount) / 100;
  return Array.from({ length: 9 }, (_, i) => (i === 4 ? 1 + k - k / 9 : -k / 9));
}

/**
 * The CSS background of the layer that draws a vignette of `amount` (0..100) over the graded picture:
 * black, as opaque as the render's vignette takes light away, 1 − cos(angle · d)^4 at the distance d
 * from the centre over the half diagonal (a circle to the farthest corner); undefined for none.
 */
export function vignetteBackground(amount: number): string | undefined {
  if (!amount) return undefined;
  const angle = (VIGNETTE_ANGLE * amount) / 100;
  const stops = Array.from({ length: 11 }, (_, i) => {
    const kept = Math.cos((angle * i) / 10) ** 4;
    return `rgba(0, 0, 0, ${Math.round((1 - kept) * 1000) / 1000}) ${i * 10}%`;
  });
  return `radial-gradient(circle farthest-corner at 50% 50%, ${stops.join(", ")})`;
}

// Whether `folded` has anything for the SVG filter to do (a vignette alone is the layer's).
const filtered = (folded: Folded | null): folded is Folded =>
  !!folded && (folded.tables !== null || folded.matrix !== null || !!folded.sharpen || !!folded.lut);

function foldTables(adjust: Adjust): [number[], number[], number[]] | null {
  const { exposure, brightness, contrast, highlights, shadows, whites, blacks, fade } = adjust;
  if (![exposure, brightness, contrast, highlights, shadows, whites, blacks, fade].some(Boolean)) return null;
  const table = Array.from({ length: TABLE_SIZE }, (_, i) => tone(i / (TABLE_SIZE - 1), adjust));
  return [table, table, table];
}

// What the tables make of `value` (0..1).
function tone(value: number, adjust: Adjust): number {
  let v = linearToSrgb(Math.min(1, srgbToLinear(value) * 2 ** adjust.exposure));
  v = within(v ** (2 ** (-adjust.brightness / 100)));
  const slope = 2 ** ((CONTRAST_STOPS * adjust.contrast) / 100);
  v = within(v ** slope / (v ** slope + (1 - v) ** slope));
  // Bumps over the lower and the upper half, each 1 at its peak (a third and two thirds up).
  const lower = 6.75 * v * (1 - v) ** 2;
  const upper = 6.75 * v * v * (1 - v);
  v = within(v + TONE_SHIFT * ((adjust.shadows / 100) * lower + (adjust.highlights / 100) * upper));
  v = within(v + END_SHIFT * ((adjust.whites / 100) * v ** 4 + (adjust.blacks / 100) * (1 - v) ** 4));
  const fade = adjust.fade / 100;
  return within(FADE_LIFT * fade + v * (1 - (FADE_LIFT + FADE_DIM) * fade));
}

function foldMatrix(adjust: Adjust): Matrix | null {
  if (adjust.temperature === NEUTRAL_K && !adjust.tint && !adjust.saturation) return null;
  const warmth = (adjust.temperature - NEUTRAL_K) / TEMPERATURE_SPAN_K;
  const raw = [1 + TEMPERATURE_GAIN * warmth, 1 - (TINT_GAIN * adjust.tint) / 100, 1 - TEMPERATURE_GAIN * warmth];
  // Kept at the same luma: a grey's brightness stays.
  const scale = LUMA[0] * raw[0] + LUMA[1] * raw[1] + LUMA[2] * raw[2];
  const gains = raw.map((gain) => gain / scale);
  const vivid = 1 + adjust.saturation / 100;
  const row = (out: number) => [0, 1, 2].map((given) => ((1 - vivid) * LUMA[given] + (out === given ? vivid : 0)) * gains[given]);
  return [row(0), row(1), row(2)] as Matrix;
}

const within = (value: number) => Math.min(1, Math.max(0, value));
const srgbToLinear = (value: number) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (value: number) => (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055);

/**
 * The id of the SVG filter that draws `grade` (GradeFilters.tsx defines one per distinct Grade), named
 * by its dials, Look and intensity so that equal Grades share it; null for a neutral one.
 */
export function gradeFilterId(grade: Partial<Grade> | null | undefined): string | null {
  if (isNeutral(grade)) return null;
  const { adjust, look, intensity } = gradeOf(grade);
  const parts = [...(Object.keys(NEUTRAL_ADJUST) as (keyof Adjust)[]).map((dial) => adjust[dial]), ...(look == null ? [] : [look, intensity])];
  return `grade-${parts.map((part) => String(part).replace(/[^0-9a-z]/gi, "_")).join("-")}`;
}

/** Whether `grade` has an SVG filter (GradeFilters.tsx): anything but a vignette alone, or neutral. */
export const hasGradeFilter = (grade: Partial<Grade> | null | undefined): boolean => filtered(foldGrade(grade));

/**
 * The CSS `filter` that draws `grade` on an element (its tables, matrix and sharpen; its vignette is
 * GradeVignette's layer), or undefined when it has none.
 */
export function gradeFilter(grade: Partial<Grade> | null | undefined): string | undefined {
  const id = gradeFilterId(grade);
  return id && hasGradeFilter(grade) ? `url(#${id})` : undefined;
}

/**
 * A display colour `rgb` (0..1 each) as `grade` turns it: through its fold's tables and then its
 * matrix, as the preview's filter draws a pixel (sharpen and vignette, which depend on the pixel's
 * neighbours and place, and an Imported Look's 3D table, left out). What the eyedropper picks from an
 * Overlay's picture, which the render keys after its Grade.
 */
export function gradedColour(grade: Partial<Grade> | null | undefined, rgb: [number, number, number]): [number, number, number] {
  const folded = foldGrade(grade);
  const clamp = (value: number) => Math.min(1, Math.max(0, value));
  const looked = (table: number[], value: number) => {
    const at = clamp(value) * (table.length - 1);
    const below = Math.floor(at);
    const above = Math.min(below + 1, table.length - 1);
    return table[below] + (table[above] - table[below]) * (at - below);
  };
  const tabled = rgb.map((value, channel) => (folded?.tables ? looked(folded.tables[channel], value) : value));
  const mixed = folded?.matrix ? folded.matrix.map((row) => row.reduce((sum, weight, channel) => sum + weight * tabled[channel], 0)) : tabled;
  return mixed.map(clamp) as [number, number, number];
}

/** `grade` with the dials of `change` set, the rest kept. */
export const adjusted = (grade: Partial<Grade> | null | undefined, change: Partial<Adjust>): Grade => {
  const given = gradeOf(grade);
  return { ...given, adjust: { ...given.adjust, ...change } };
};

/** `grade` with its Look set (null: none, its Adjust kept), its intensity, or both. */
export const relooked = (grade: Partial<Grade> | null | undefined, change: { look?: string | null; intensity?: number }): Grade => ({
  ...gradeOf(grade),
  ...change,
});

/**
 * `plan` with its Segments, Overlays and Adjustment Layers in the Grades the draft's `segments`,
 * `overlays` and `layers` give them now (by id), and with the Candidate's `grade` as drafted (when given), so that a dial dragged shows
 * at once, before the Preview Plan of the change comes (ADR 0013); a Clip of one range, which has no
 * Segment in its plan, too. `plan` itself when none differs.
 */
export function draftGrades(
  plan: RenderPlan,
  segments: { id: string; grade?: Grade }[],
  overlays: { id: string; grade?: Grade }[] = [],
  grade?: Grade,
  layers: { id: string; grade?: Grade }[] = [],
): RenderPlan {
  const segmentsNow = regraded(plan.segments, segments);
  const overlaysNow = regraded(plan.overlays, overlays);
  const adjustments = plan.adjustment_layers ?? [];
  const adjustmentsNow = regraded(adjustments, layers) as typeof adjustments;
  const regradedClip = grade !== undefined && gradeFilterId(grade) !== gradeFilterId(plan.grade);
  if (segmentsNow === plan.segments && overlaysNow === plan.overlays && adjustmentsNow === adjustments && !regradedClip) return plan;
  return {
    ...plan,
    segments: segmentsNow,
    overlays: overlaysNow,
    ...(adjustmentsNow !== adjustments ? { adjustment_layers: adjustmentsNow } : {}),
    ...(regradedClip ? { grade: gradeOf(grade) } : {}),
  };
}

// `planned` with each one's Grade as `drafted` gives it (by id); `planned` itself when none differs.
function regraded<T extends { id: string; grade?: Grade }>(planned: T[], drafted: { id: string; grade?: Grade }[]): T[] {
  const grades = new Map(drafted.map((item) => [item.id, item.grade]));
  const differs = (item: T) => grades.has(item.id) && gradeFilterId(grades.get(item.id)) !== gradeFilterId(item.grade);
  if (!planned.some(differs)) return planned;
  return planned.map((item) => (differs(item) ? { ...item, grade: gradeOf(grades.get(item.id)) } : item));
}
