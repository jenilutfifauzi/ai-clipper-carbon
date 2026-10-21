import { Copy, Palette, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import type { AdjustmentLayer } from "../../../api";
import { Button } from "../../../components/Button";
import { Hint } from "../../../components/InfoTip";
import { Slider } from "../../../components/Slider";
import { Group } from "../editor/StyleFields";
import { fadesHalved } from "./actions";
import { halfFadeMax } from "./edits";
import { TimingFields } from "./TimingFields";

/**
 * The picked Adjustment Layer (ADR 0013): its strength and fades (`onMix`, each a change of its field;
 * a fade at most half its length), its Color section (`color`: its own Grade, as an Overlay's), its
 * Effects section (`pictureEffects`: its Video Effects, after its Grade, ADR 0014), and its times, a trim keeping its fades within half of it.
 */
export function AdjustmentLayerFields({
  layer,
  duration,
  color,
  pictureEffects,
  onChange,
  onMix,
  onDuplicate,
  onDelete,
}: {
  layer: AdjustmentLayer;
  duration: number;
  color: ReactNode;
  // Its Video Effects section (VideoEffectsFields), after its Color section; none on a phone.
  pictureEffects?: ReactNode;
  // `group` names the field being changed, so that its changes are undone as one.
  onChange: (layer: AdjustmentLayer, group: string) => void;
  onMix: (change: { strength?: number; fade_in?: number; fade_out?: number }, group: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const half = halfFadeMax(layer.secs);
  const group = (field: string) => `adjust:${layer.id}:${field}`;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 font-semibold">
          <Palette aria-hidden size={17} className="shrink-0 text-muted" />
          <span className="truncate">Adjustment Layer</span>
        </h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={onDuplicate} aria-label="Duplicate Adjustment Layer">
            <Copy aria-hidden size={17} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete Adjustment Layer">
            <Trash2 aria-hidden size={17} />
          </Button>
        </div>
      </div>
      <Hint>Grades and adds effects to the video and the overlays under it; never the captions, text, shapes, hook or watermark.</Hint>
      <Group title="Mix">
        <Slider
          label="Strength"
          value={layer.strength}
          min={0}
          max={100}
          step={1}
          format={(v) => `${Math.round(v)}%`}
          onChange={(strength) => onMix({ strength }, group("strength"))}
        />
        <Slider
          label="Fade in"
          value={Math.min(layer.fade_in, half)}
          min={0}
          max={half}
          step={0.05}
          format={(v) => `${v.toFixed(2)} s`}
          onChange={(fade_in) => onMix({ fade_in }, group("fade_in"))}
        />
        <Slider
          label="Fade out"
          value={Math.min(layer.fade_out, half)}
          min={0}
          max={half}
          step={0.05}
          format={(v) => `${v.toFixed(2)} s`}
          onChange={(fade_out) => onMix({ fade_out }, group("fade_out"))}
        />
      </Group>
      {color}
      {pictureEffects}
      <TimingFields
        item={layer}
        duration={duration}
        labels={{ start: "Starts at", secs: "Lasts" }}
        onChange={(next, changed) => onChange(fadesHalved(next), changed)}
      />
    </div>
  );
}
