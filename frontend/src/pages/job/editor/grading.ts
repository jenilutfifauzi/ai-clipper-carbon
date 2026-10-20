import type { Adjust, Grade, RenderPlan, SegmentPlan } from "../../../api";

/**
 * The fold of a Grade (ADR 0013): its Adjust turned into one table per channel and one colour matrix,
 * which the preview draws as an SVG filter (GradeFilters.tsx: an feComponentTransfer of the tables,
 * then an feColorMatrix, in sRGB). The render folds it the same way (backend/app/grading.py, whose
 * docstring gives the maths), and both test suites read the same cases
 * (backend/tests/fixtures/grade_folds.json), so that the two can't drift.
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

export type Matrix = [[number, number, number], [number, number, number], [number, number, number]];

// A Grade as the preview draws it: a table per channel (R, G, B; TABLE_SIZE entries, the output for
// input i / (TABLE_SIZE − 1), 0..1), then a colour matrix (rows R, G, B of weights on R, G, B); each
// null when it would change nothing.
export interface Folded {
  tables: [number[], number[], number[]] | null;
  matrix: Matrix | null;
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

/** `grade` folded into its tables and matrix; null for a neutral one, which adds no filter. */
export function foldGrade(grade: Partial<Grade> | null | undefined): Folded | null {
  const { adjust } = gradeOf(grade);
  const tables = foldTables(adjust);
  const matrix = foldMatrix(adjust);
  return tables === null && matrix === null ? null : { tables, matrix };
}

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
 * by its dials so that equal Grades share it; null for a neutral one.
 */
export function gradeFilterId(grade: Partial<Grade> | null | undefined): string | null {
  if (isNeutral(grade)) return null;
  const { adjust } = gradeOf(grade);
  const dials = (Object.keys(NEUTRAL_ADJUST) as (keyof Adjust)[]).map((dial) => String(adjust[dial]).replace(/[^0-9a-z]/gi, "_"));
  return `grade-${dials.join("-")}`;
}

/** The CSS `filter` that draws `grade` on an element, or undefined for a neutral one. */
export function gradeFilter(grade: Partial<Grade> | null | undefined): string | undefined {
  const id = gradeFilterId(grade);
  return id && foldGrade(grade) ? `url(#${id})` : undefined;
}

/** `grade` with the dials of `change` set, the rest kept. */
export const adjusted = (grade: Partial<Grade> | null | undefined, change: Partial<Adjust>): Grade => {
  const given = gradeOf(grade);
  return { ...given, adjust: { ...given.adjust, ...change } };
};

/**
 * `plan` with its Segments in the Grades the draft's `segments` give them now (by id), so that a dial
 * dragged shows at once, before the Preview Plan of the change comes (ADR 0013). `plan` itself when
 * none differs.
 */
export function draftGrades(plan: RenderPlan, segments: { id: string; grade?: Grade }[]): RenderPlan {
  const grades = new Map(segments.map((segment) => [segment.id, segment.grade]));
  const differs = (segment: SegmentPlan) => grades.has(segment.id) && gradeFilterId(grades.get(segment.id)) !== gradeFilterId(segment.grade);
  if (!plan.segments.some(differs)) return plan;
  return { ...plan, segments: plan.segments.map((segment) => (differs(segment) ? { ...segment, grade: gradeOf(grades.get(segment.id)) } : segment)) };
}
