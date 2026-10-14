import { RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import type { ClipSegment, FontInfo, MediaItem, MusicClip, Overlay, PreviewPlan, TextLayer } from "../../../api";
import { Button } from "../../../components/Button";
import { Hint } from "../../../components/InfoTip";
import { usePlayback, type Playback } from "../editor/playback";
import { isPlaced, unplacedOverrides } from "../editor/placing";
import { HookTimingFields } from "../HookEditor";
import type { ItemActions } from "./actions";
import type { AdvancedEdits, Picked } from "./edits";
import { SegmentFields } from "./MainTrack";
import { MusicFields } from "./Music";
import { OverlayFields } from "./Overlays";
import { TextLayerFields } from "./TextLayers";

/** The picked item's properties: a Segment's, a Text Layer's, a Music Clip's, an Overlay's, the hook's, or a join's Transition. */
export function Inspector({
  picked,
  edits,
  duration,
  preview,
  fonts,
  actions,
  mediaById,
  playback,
  transition,
  onEdits,
  onText,
  onMusic,
  onOverlay,
  onSegment,
}: {
  picked: Picked;
  edits: AdvancedEdits;
  duration: number;
  preview: PreviewPlan | null;
  fonts: FontInfo[] | null;
  actions: ItemActions | null;
  mediaById: Map<string, MediaItem>;
  playback: Playback;
  // The Transitions' panel, for a picked join.
  transition: ReactNode;
  onEdits: (edits: AdvancedEdits, group?: string) => void;
  onText: (layer: TextLayer, group?: string) => void;
  onMusic: (clip: MusicClip, group?: string) => void;
  onOverlay: (overlay: Overlay, group?: string) => void;
  onSegment: (segment: ClipSegment, group?: string) => void;
}) {
  const splittable = usePlayback(playback, (time) => actions?.canSplit(time) ?? false);
  const find = <T extends { id: string }>(items: T[], kind: string) =>
    picked && "id" in picked && picked.kind === kind ? items.find((item) => item.id === picked.id) : undefined;

  if (picked?.kind === "join") {
    return (
      <div className="flex flex-col gap-3">
        <h2 className="font-semibold">Transition</h2>
        {transition}
      </div>
    );
  }
  const segment = find(edits.segments, "segment");
  if (segment && actions) {
    return (
      <SegmentFields
        key={segment.id}
        segment={segment}
        item={segment.media ? mediaById.get(segment.media) : undefined}
        index={edits.segments.indexOf(segment)}
        count={edits.segments.length}
        sourceVolume={edits.source_volume}
        canSplit={splittable}
        onSplit={actions.split}
        onDuplicate={actions.duplicate}
        onDelete={actions.remove}
        onChange={onSegment}
        onSourceVolume={(source_volume) => onEdits({ ...edits, source_volume }, "source-volume")}
      />
    );
  }
  const layer = find(edits.text_layers, "text");
  if (layer && actions) {
    return <TextLayerFields key={layer.id} layer={layer} duration={duration} fonts={fonts} onChange={onText} onDuplicate={actions.duplicate} onDelete={actions.remove} />;
  }
  const clip = find(edits.music, "music");
  if (clip && actions) {
    return (
      <MusicFields
        key={clip.id}
        clip={clip}
        item={mediaById.get(clip.media)}
        duration={duration}
        onChange={onMusic}
        onDuplicate={actions.duplicate}
        onDelete={actions.remove}
      />
    );
  }
  const overlay = find(edits.overlays, "overlay");
  if (overlay && actions) {
    return (
      <OverlayFields
        key={overlay.id}
        overlay={overlay}
        item={mediaById.get(overlay.media)}
        duration={duration}
        onChange={onOverlay}
        onDuplicate={actions.duplicate}
        onDelete={actions.remove}
      />
    );
  }
  if (picked?.kind === "hook") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">Hook</h2>
          <p className="text-sm text-pretty break-words">“{preview?.plan.hook?.lines.join(" ") ?? edits.hook_text}”</p>
          <Hint more="Drag it to move it, or a corner to resize it; arrow keys nudge it. Its look is changed in the clip editor.">
            Double-click it on the preview to change its words.
          </Hint>
        </div>
        <ResetPlace edits={edits} part="hook" onEdits={onEdits} />
        <HookTimingFields
          timing={edits}
          duration={duration}
          onTiming={(timing) => onEdits({ ...edits, ...timing }, "hook-timing")}
          blank={edits.hook_text.trim() === ""}
        />
      </div>
    );
  }
  if (picked?.kind === "captions") {
    return (
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h2 className="font-semibold">Captions</h2>
          <Hint more="Drag one to move them all, or a corner to resize them; arrow keys nudge them. Their look is changed in the clip editor.">
            Double-click a line on the preview to correct its words.
          </Hint>
        </div>
        <ResetPlace edits={edits} part="caption" onEdits={onEdits} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-1">
      <h2 className="font-semibold">Nothing selected</h2>
      <p className="text-sm text-pretty text-muted">Select an item on the timeline or the preview to change it.</p>
    </div>
  );
}

/** "Reset position": the hook or the captions back where their Style Preset puts them, once moved. */
function ResetPlace({
  edits,
  part,
  onEdits,
}: {
  edits: AdvancedEdits;
  part: "hook" | "caption";
  onEdits: (edits: AdvancedEdits, group?: string) => void;
}) {
  return (
    <Button
      size="sm"
      className="self-start"
      disabled={!isPlaced(edits.style_overrides, part)}
      onClick={() => onEdits({ ...edits, style_overrides: unplacedOverrides(edits.style_overrides, part) })}
    >
      <RotateCcw aria-hidden size={16} />
      Reset position
    </Button>
  );
}
