import { createContext, useContext, type ReactNode } from "react";
import type { Grade } from "../../../api";
import { foldGrade, gradeFilter, gradeFilterId, hasGradeFilter, sharpenKernel, vignetteBackground } from "./grading";

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

/** The CSS filter that draws `grade` (`gradeFilter`), or none while the original is shown. */
export function useGradeFilter(grade: Grade | null | undefined): string | undefined {
  const original = useOriginal();
  return original ? undefined : gradeFilter(grade);
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
 * The filter `id` that draws `grade` (none when it has nothing for one to do). With `mix` (0..1, an
 * Adjustment Layer's strength times its fade), the graded picture is mixed over the picture as it was
 * by that much, as the render lays its graded branch back at that alpha.
 */
export function GradeFilter({ id, grade, mix = 1 }: { id: string; grade: Grade; mix?: number }) {
  const folded = foldGrade(grade);
  if (!folded || !hasGradeFilter(grade)) return null;
  const { tables, matrix, sharpen, lut } = folded;
  // The picture before the Look's table, which its intensity mixes the table's over.
  const graded = tables || matrix ? "graded" : "SourceGraphic";
  return (
    <filter id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="1" height="1">
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
 * The Source's panels (the decks', or a Transition's ghost's) in a Segment's `grade` (ADR 0013), or the
 * whole Main Track (decks, ghost and media Segments) in the Candidate's: drawn over black, as the
 * render pads a panel, so that the Grade colours the whole frame, its vignette over them. As they
 * are without one, or while the original is shown.
 */
export function DecksGraded({ grade, children }: { grade: Grade | undefined; children: ReactNode }) {
  const filter = useGradeFilter(grade);
  return (
    <>
      <div className="absolute inset-0" style={filter ? { filter, background: "#000" } : undefined}>
        {children}
      </div>
      <GradeVignette grade={grade} />
    </>
  );
}
