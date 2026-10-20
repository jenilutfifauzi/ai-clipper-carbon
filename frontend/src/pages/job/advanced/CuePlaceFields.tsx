import { RotateCcw } from "lucide-react";
import { CUE_MAX_SCALE, CUE_MIN_SCALE, type CueKey, type RenderPlan } from "../../../api";
import { Button } from "../../../components/Button";
import { Slider } from "../../../components/Slider";
import { FRAME } from "../editor/picture";
import { keyText, sameKey } from "../editor/timelineKey";
import { cueEditOf } from "./cueEdits";
import { placeCue, resetCuePosition } from "./cuePlace";
import type { AdvancedEdits } from "./edits";

/**
 * A picked Cue's own place (the middle of its lines, in output pixels) and its scale over the
 * Caption Style's size, as its Grips on the preview set them, and "Reset position", which puts it
 * back where the Caption Style does. Each slider's drag is one step of undo.
 */
export function CuePlaceFields({
  cueKey,
  edits,
  plan,
  onEdits,
}: {
  cueKey: CueKey;
  edits: AdvancedEdits;
  plan: RenderPlan | null;
  onEdits: (edits: AdvancedEdits, group?: string) => void;
}) {
  const cue = plan?.captions.find((other) => sameKey(other.key, cueKey));
  if (!plan || !cue) return null;
  const edit = cueEditOf(edits.cue_edits, plan, cueKey);
  const scene = { edits, plan };
  const set = (field: "x" | "y" | "scale") => (value: number) => {
    const outcome = placeCue(scene, cueKey, { [field]: value });
    if (outcome) onEdits(outcome.edits, `cue-place:${field}:${keyText(cueKey)}`);
  };
  const reset = resetCuePosition(scene, cueKey);
  return (
    <div className="flex flex-col gap-3">
      <Slider label="Across" value={edit?.x ?? Math.round(cue.area.x + cue.area.width / 2)} min={0} max={FRAME.width} format={(x) => `${x} px`} onChange={set("x")} />
      <Slider label="Down" value={edit?.y ?? Math.round(cue.area.y + cue.area.height / 2)} min={0} max={FRAME.height} format={(y) => `${y} px`} onChange={set("y")} />
      <Slider
        label="Scale"
        value={edit?.scale ?? 1}
        min={CUE_MIN_SCALE}
        max={CUE_MAX_SCALE}
        step={0.05}
        format={(scale) => `${Math.round(scale * 100)}%`}
        onChange={set("scale")}
      />
      <Button size="sm" className="self-start" disabled={!reset} onClick={() => reset && onEdits(reset.edits)}>
        <RotateCcw aria-hidden size={16} />
        Reset position
      </Button>
    </div>
  );
}
