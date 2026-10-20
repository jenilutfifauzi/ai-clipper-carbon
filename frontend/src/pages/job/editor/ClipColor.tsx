import type { Grade } from "../../../api";
import { ColorFields } from "../advanced/ColorFields";
import { adjusted, NEUTRAL_GRADE } from "./grading";

/**
 * The clip editor's Color section: the Candidate's own Grade (ADR 0013), the one the Advanced Edit's
 * Inspector shows with nothing picked, by the same dials and reset. It grades the whole Main Track,
 * never the Overlays.
 */
export function ClipColor({ grade, onGrade }: { grade: Grade; onGrade: (grade: Grade) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <ColorFields grades={[grade]} onDial={(change) => onGrade(adjusted(grade, change))} onReset={() => onGrade(NEUTRAL_GRADE)} />
      <p className="text-sm text-pretty text-muted">Grades the whole clip. Its Overlays keep their own colours.</p>
    </div>
  );
}
