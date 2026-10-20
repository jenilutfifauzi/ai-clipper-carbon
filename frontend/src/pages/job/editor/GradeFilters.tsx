import type { Grade } from "../../../api";
import { foldGrade, gradeFilterId } from "./grading";

/**
 * The SVG filters the preview's Grades are drawn with (ADR 0013), one per distinct Grade of `grades`,
 * referenced by CSS (`gradeFilter`): the fold's tables as an feComponentTransfer, then its matrix as
 * an feColorMatrix, both on the picture as encoded (sRGB), as the render's curves and
 * colorchannelmixer are. A neutral Grade has none.
 */
export function GradeFilters({ grades }: { grades: (Grade | null | undefined)[] }) {
  const filters = new Map<string, Grade>();
  for (const grade of grades) {
    const id = gradeFilterId(grade);
    if (id && grade && foldGrade(grade)) filters.set(id, grade);
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

/** The filter `id` that draws `grade` (none for a neutral one). */
export function GradeFilter({ id, grade }: { id: string; grade: Grade }) {
  const folded = foldGrade(grade);
  if (!folded) return null;
  const { tables, matrix } = folded;
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
    </filter>
  );
}

const number = (value: number) => String(Math.round(value * 1e6) / 1e6);
const values = (table: number[]) => table.map(number).join(" ");
