import { createContext, createElement, useContext, useLayoutEffect, useRef, type ReactNode } from "react";
import type { Grade, VideoEffect } from "../../../api";
import { foldGrade, gradeFilter, gradeFilterId, hasGradeFilter, sharpenKernel, vignetteBackground } from "./grading";
import type { Playback } from "./playback";
import { effectPrimitives, effectsFilterId, frameEffectsFilter, type Box, type Primitive } from "./videoEffects";

// Whether the player shows the original: every Grade dropped (the before view, while its button is held).
const Original = createContext(false);

/**
 * `children` drawn as the original while `on` (the before view): every Grade-drawing piece of the
 * preview under it (a Segment's, an Overlay's, the Candidate's and the Adjustment Layers' filters and
 * vignettes) reads this one flag (`useOriginal`) and draws nothing of its Grade. Nothing remounts:
 * only their `filter` styles and vignette layers go, so the videos play on.
 */
export function ShowOriginal({ on, children }: { on: boolean; children: ReactNode }) {
  return <Original.Provider value={on}>{children}</Original.Provider>;
}

/** Whether the preview is drawn as the original, every Grade dropped (ShowOriginal). */
export const useOriginal = () => useContext(Original);

// The playback whose time shown the Video Effects that change with time follow (EffectsClock).
const Clock = createContext<Playback | null>(null);

/**
 * `children` with their Video Effects that change with time (Bloom pulse, Film grain; ADR 0014)
 * following `playback`: each such filter primitive is written again on its every frame and seek, at
 * the time shown less its item's start, outside React's render (TimedPrimitive), so that they move
 * while it plays and hold still while it is paused. Without one, they are drawn as at their start.
 */
export function EffectsClock({ playback, children }: { playback: Playback; children: ReactNode }) {
  return <Clock.Provider value={playback}>{children}</Clock.Provider>;
}

/** The CSS filter that draws `grade` (`gradeFilter`), or none while the original is shown. */
export function useGradeFilter(grade: Grade | null | undefined): string | undefined {
  const original = useOriginal();
  return original ? undefined : gradeFilter(grade);
}

/**
 * The CSS filter of a Segment's whole frame: its Grade's (`useGradeFilter`), then its Video Effects'
 * (ADR 0014; EffectFilters defines them, their time from the Segment's `start`), as the render draws
 * them after it.
 */
export function useFrameFilter(grade: Grade | null | undefined, effects: VideoEffect[] | undefined, start = 0): string | undefined {
  const graded = useGradeFilter(grade);
  const effected = frameEffectsFilter(effects, start);
  return [graded, effected].filter(Boolean).join(" ") || undefined;
}

/**
 * The SVG filters the preview's Grades are drawn with (ADR 0013), one per distinct Grade of `grades`,
 * referenced by CSS (`gradeFilter`): the fold's tables as an feComponentTransfer, then its matrix as
 * an feColorMatrix, both on the picture as encoded (sRGB), as the render's curves and
 * colorchannelmixer are; then an Imported Look's table, as the tables and matrix fitted to it (an
 * feComponentTransfer and an feColorMatrix) mixed over the picture before them by the intensity (an
 * feComposite), near the render's lut3d; then its sharpen as an feConvolveMatrix, near the render's
 * unsharp. A neutral Grade has none, nor one whose only dial is vignette (GradeVignette draws that).
 */
export function GradeFilters({ grades }: { grades: (Grade | null | undefined)[] }) {
  const filters = new Map<string, Grade>();
  for (const grade of grades) {
    const id = gradeFilterId(grade);
    if (id && grade && hasGradeFilter(grade)) filters.set(id, grade);
  }
  if (!filters.size) return null;
  return (
    <svg aria-hidden width={0} height={0} className="pointer-events-none absolute">
      <defs>
        {[...filters].map(([id, grade]) => (
          <GradeFilter key={id} id={id} grade={grade} />
        ))}
      </defs>
    </svg>
  );
}

/**
 * The SVG filters the preview's Video Effects are imitated with (ADR 0014; videoEffects.ts), one per
 * distinct stack and element size of `items`, referenced by CSS after the Grade's filter on the same
 * element (`effectsFilter`), so that they come after it, as in the render. Their units are fractions
 * of the element's box, and they draw within it. One that changes with time is an item's own, from
 * its `start`.
 */
export function EffectFilters({ items }: { items: { effects?: VideoEffect[]; box: Box; start?: number }[] }) {
  const filters = new Map<string, { effects: VideoEffect[]; box: Box; start: number }>();
  for (const { effects, box, start = 0 } of items) {
    const id = effectsFilterId(effects, box, start);
    if (id && effects) filters.set(id, { effects, box, start });
  }
  if (!filters.size) return null;
  return (
    <svg aria-hidden width={0} height={0} className="pointer-events-none absolute">
      <defs>
        {[...filters].map(([id, { effects, box, start }]) => (
          <filter key={id} id={id} colorInterpolationFilters="sRGB" primitiveUnits="objectBoundingBox" x="0" y="0" width="1" height="1">
            <Primitives primitives={effectPrimitives(effects, box)} start={start} />
          </filter>
        ))}
      </defs>
    </svg>
  );
}

// Video Effects' imitations as elements, each with its own (an feComponentTransfer's functions), those
// that change with time at the time shown less `start`, their item's start (TimedPrimitive).
function Primitives({ primitives, start = 0 }: { primitives: Primitive[]; start?: number }) {
  return primitives.map((primitive, i) => {
    const { element: Element, attributes, children, timed } = primitive;
    if (timed) return <TimedPrimitive key={i} primitive={primitive} start={start} />;
    return (
      <Element key={i} {...attributes}>
        {children && <Primitives primitives={children} start={start} />}
      </Element>
    );
  });
}

/**
 * A primitive that changes with time (its `timed` attributes), written on every frame and seek of
 * the EffectsClock's playback at the time shown less `start`, outside React's render. Its timed
 * attributes are named as in the DOM (seed, k2), which React passes on as they are.
 */
function TimedPrimitive({ primitive, start }: { primitive: Primitive; start: number }) {
  const playback = useContext(Clock);
  const element = useRef<SVGElement>(null);
  const { element: name, attributes, timed } = primitive;
  useLayoutEffect(() => {
    if (!playback || !timed) return;
    const paint = () => {
      for (const [key, value] of Object.entries(timed(playback.shownTime - start))) element.current?.setAttribute(key, value);
    };
    paint();
    return playback.subscribe(paint);
  }, [playback, timed, start]);
  return createElement(name, { ref: element, ...attributes, ...timed?.(playback ? playback.shownTime - start : 0) });
}

/**
 * The filter `id` that draws `grade` (none when it has nothing for one to do). With `mix` (0..1, an
 * Adjustment Layer's strength times its fade), the graded picture is mixed over the picture as it was
 * by that much, as the render lays its graded branch back at that alpha. An Adjustment Layer's Video
 * Effects (`effects` on an element of `box`, ADR 0014, their time from its `start`) come after its
 * Grade and before the mix; the filter's units are then fractions of the element's box, as
 * EffectFilters' are.
 */
export function GradeFilter({
  id,
  grade,
  mix = 1,
  effects = [],
  box,
  start = 0,
}: {
  id: string;
  grade: Grade | null;
  mix?: number;
  effects?: VideoEffect[];
  box?: Box;
  start?: number;
}) {
  const folded = hasGradeFilter(grade) ? foldGrade(grade) : null;
  const effected = box ? effectPrimitives(effects, box) : [];
  if (!folded && !effected.length) return null;
  const { tables, matrix, sharpen, lut } = folded ?? { tables: null, matrix: null, sharpen: 0, lut: null };
  // The picture before the Look's table, which its intensity mixes the table's over.
  const graded = tables || matrix ? "graded" : "SourceGraphic";
  return (
    <filter
      id={id}
      colorInterpolationFilters="sRGB"
      x="0"
      y="0"
      width="1"
      height="1"
      {...(effected.length ? { primitiveUnits: "objectBoundingBox" } : {})}
    >
      {tables && <Tables tables={tables} result={matrix ? undefined : graded} />}
      {matrix && <Mixer matrix={matrix} result={graded} />}
      {lut && (
        <>
          <Tables tables={lut.fit.tables} input={graded} />
          <Mixer matrix={lut.fit.matrix} result="looked" />
          {lut.intensity < 100 && (
            <feComposite in="looked" in2={graded} operator="arithmetic" k1="0" k2={number(lut.intensity / 100)} k3={number(1 - lut.intensity / 100)} k4="0" />
          )}
        </>
      )}
      {sharpen > 0 && (
        <feConvolveMatrix order="3" kernelMatrix={sharpenKernel(sharpen).map(number).join(" ")} divisor="1" edgeMode="duplicate" preserveAlpha="true" />
      )}
      <Primitives primitives={effected} start={start} />
      {mix < 1 && <feComposite in2="SourceGraphic" operator="arithmetic" k1="0" k2={number(mix)} k3={number(1 - mix)} k4="0" />}
    </filter>
  );
}

/**
 * The vignette of `grade` (ADR 0013): a radial gradient layer over the graded picture, filling its
 * parent, as the render's vignette comes after the Grade's other filters; nothing without one.
 */
export function GradeVignette({ grade }: { grade: Grade | null | undefined }) {
  const original = useOriginal();
  const background = vignetteBackground(foldGrade(grade)?.vignette ?? 0);
  return background && !original ? <div aria-hidden data-vignette className="pointer-events-none absolute inset-0" style={{ background }} /> : null;
}

// The tables as an feComponentTransfer, from `input` (the previous result by default).
function Tables({ tables, input, result }: { tables: number[][]; input?: string; result?: string }) {
  return (
    <feComponentTransfer in={input} result={result}>
      <feFuncR type="table" tableValues={values(tables[0])} />
      <feFuncG type="table" tableValues={values(tables[1])} />
      <feFuncB type="table" tableValues={values(tables[2])} />
    </feComponentTransfer>
  );
}

// The matrix as an feColorMatrix: rows R, G, B of its weights, no alpha weight and no offset; alpha kept.
function Mixer({ matrix, result }: { matrix: number[][]; result?: string }) {
  return <feColorMatrix type="matrix" result={result} values={[...matrix.map((row) => [...row, 0, 0]).flat(), 0, 0, 0, 1, 0].map(number).join(" ")} />;
}

const number = (value: number) => String(Math.round(value * 1e6) / 1e6);
const values = (table: number[]) => table.map(number).join(" ");

/**
 * The Source's panels (the decks', or a Transition's ghost's) in a Segment's `grade` (ADR 0013) and
 * its Video Effects (`effects`, ADR 0014, after it, from its `start`), or the whole Main Track (decks, ghost and media
 * Segments) in the Candidate's Grade: drawn over black, as the render pads a panel, so that they
 * reach the whole frame, the vignette over them. As they are without either, or (the Grade) while the
 * original is shown.
 */
export function DecksGraded({
  grade,
  effects,
  start,
  children,
}: {
  grade: Grade | undefined;
  effects?: VideoEffect[];
  start?: number;
  children: ReactNode;
}) {
  const filter = useFrameFilter(grade, effects, start);
  return (
    <>
      <div className="absolute inset-0" style={filter ? { filter, background: "#000" } : undefined}>
        {children}
      </div>
      <GradeVignette grade={grade} />
    </>
  );
}
