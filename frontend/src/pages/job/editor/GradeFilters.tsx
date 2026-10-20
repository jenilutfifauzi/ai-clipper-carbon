import type { ReactNode } from "react";
import type { Grade } from "../../../api";
import { foldGrade, gradeFilter, gradeFilterId, hasGradeFilter, sharpenKernel, vignetteBackground } from "./grading";

/**
 * The SVG filters the preview's Grades are drawn with (ADR 0013), one per distinct Grade of `grades`,
 * referenced by CSS (`gradeFilter`): the fold's tables as an feComponentTransfer, then its matrix as
 * an feColorMatrix, both on the picture as encoded (sRGB), as the render's curves and
 * colorchannelmixer are; then its sharpen as an feConvolveMatrix, near the render's unsharp. A
 * neutral Grade has none, nor one whose only dial is vignette (GradeVignette draws that).
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

/** The filter `id` that draws `grade` (none when it has nothing for one to do). */
export function GradeFilter({ id, grade }: { id: string; grade: Grade }) {
  const folded = foldGrade(grade);
  if (!folded || !hasGradeFilter(grade)) return null;
  const { tables, matrix, sharpen } = folded;
  return (
    <filter id={id} colorInterpolationFilters="sRGB" x="0" y="0" width="1" height="1">
      {tables && (
        <feComponentTransfer>
          <feFuncR type="table" tableValues={values(tables[0])} />
          <feFuncG type="table" tableValues={values(tables[1])} />
          <feFuncB type="table" tableValues={values(tables[2])} />
        </feComponentTransfer>
      )}
      {matrix && <feColorMatrix type="matrix" values={[...matrix.map((row) => [...row, 0, 0]).flat(), 0, 0, 0, 1, 0].map(number).join(" ")} />}
      {sharpen > 0 && (
        <feConvolveMatrix order="3" kernelMatrix={sharpenKernel(sharpen).map(number).join(" ")} divisor="1" edgeMode="duplicate" preserveAlpha="true" />
      )}
    </filter>
  );
}

/**
 * The vignette of `grade` (ADR 0013): a radial gradient layer over the graded picture, filling its
 * parent, as the render's vignette comes after the Grade's other filters; nothing without one.
 */
export function GradeVignette({ grade }: { grade: Grade | null | undefined }) {
  const background = vignetteBackground(foldGrade(grade)?.vignette ?? 0);
  return background ? <div aria-hidden data-vignette className="pointer-events-none absolute inset-0" style={{ background }} /> : null;
}

const number = (value: number) => String(Math.round(value * 1e6) / 1e6);
const values = (table: number[]) => table.map(number).join(" ");

/**
 * The Source's panels (the decks', or a Transition's ghost's) in a Segment's `grade` (ADR 0013), or the
 * whole Main Track (decks, ghost and media Segments) in the Candidate's: drawn over black, as the
 * render pads a panel, so that the Grade colours the whole frame, its vignette over them. As they
 * are without one.
 */
export function DecksGraded({ grade, children }: { grade: Grade | undefined; children: ReactNode }) {
  const filter = gradeFilter(grade);
  return (
    <>
      <div className="absolute inset-0" style={filter ? { filter, background: "#000" } : undefined}>
        {children}
      </div>
      <GradeVignette grade={grade} />
    </>
  );
}
