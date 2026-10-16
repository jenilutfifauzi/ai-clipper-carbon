import type { ClipSegment, MediaItem, Overlay, PreviewPlan } from "../../../api";
import { Hint } from "../../../components/InfoTip";
import type { Playback } from "../editor/playback";
import { DecorationFields } from "./DecorationFields";
import type { AdvancedEdits } from "./edits";
import { FramingFields } from "./MainTrack";
import { onlyItem, type Pick } from "./pick";
import { SceneFields } from "./SceneFields";
import { TransformFields } from "./TransformFields";

/**
 * The phone's Transform sheet: of the picture picked alone, the inspector's fields that place it and
 * nothing else (ADR 0007). An Overlay's Transform and Crop, then its corners, border and shadow; a
 * video's Segment's Framing (its Transform, Crop and Background); a Segment of the episode's Scene
 * at the playhead (its Layout, and a Manual Scene's Framing). Its Crop button opens Crop mode on the
 * stage (`cropMode`, which closes the sheet). Each field is the same history group as the
 * inspector's.
 */
export function TransformPanel({
  pick,
  edits,
  preview,
  mediaById,
  playback,
  onEdits,
  onOverlay,
  onSegment,
  cropMode,
}: {
  pick: Pick;
  edits: AdvancedEdits;
  preview: PreviewPlan | null;
  mediaById: Map<string, MediaItem>;
  playback: Playback;
  onEdits: (edits: AdvancedEdits, group?: string) => void;
  onOverlay: (overlay: Overlay, group: string) => void;
  onSegment: (segment: ClipSegment, group: string) => void;
  cropMode: (kind: "segment" | "overlay", id: string) => (() => void) | undefined;
}) {
  const only = onlyItem(pick);
  const overlay = only?.kind === "overlay" ? edits.overlays.find((other) => other.id === only.id) : undefined;
  const segment = only?.kind === "segment" ? edits.segments.find((other) => other.id === only.id) : undefined;
  const sizeOf = (item: MediaItem | undefined) => (item?.width && item.height ? { width: item.width, height: item.height } : undefined);
  if (overlay) {
    return (
      <div className="flex flex-col gap-4">
        <Hint more="Pinch it to scale it, and twist two fingers to turn it.">Drag it on the video with a finger to place it.</Hint>
        <TransformFields
          transform={overlay.transform}
          crop={overlay.crop}
          size={sizeOf(mediaById.get(overlay.media))}
          onChange={(transform, field) => onOverlay({ ...overlay, transform }, `overlay:${overlay.id}:transform.${field}`)}
          onCrop={(crop, field, transform) => onOverlay({ ...overlay, crop, transform: transform ?? overlay.transform }, `overlay:${overlay.id}:crop.${field}`)}
          onCropMode={cropMode("overlay", overlay.id)}
        />
        <DecorationFields overlay={overlay} onChange={onOverlay} />
      </div>
    );
  }
  if (segment?.media && segment.framing) {
    return (
      <div className="flex flex-col gap-4">
        <FramingFields
          segment={segment}
          framing={segment.framing}
          item={mediaById.get(segment.media)}
          onChange={onSegment}
          onCropMode={cropMode("segment", segment.id)}
        />
      </div>
    );
  }
  if (segment) {
    return (
      <SceneFields
        plan={preview?.plan ?? null}
        index={edits.segments.indexOf(segment)}
        count={edits.segments.length}
        playback={playback}
        edits={edits}
        onEdits={onEdits}
        onCropMode={cropMode("segment", segment.id)}
      />
    );
  }
  return <p className="text-sm text-pretty text-muted">Pick an Overlay or a Segment to place its picture.</p>;
}
