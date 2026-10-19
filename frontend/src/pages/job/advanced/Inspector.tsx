import { ClipboardCopy, Copy, RotateCcw, Trash2 } from "lucide-react";
import { useContext, useState, type ReactNode } from "react";
import type { ClipSegment, CueKey, FontInfo, MediaItem, MusicClip, Overlay, PreviewPlan, RenderPlan, Shape, TextLayer } from "../../../api";
import { Button } from "../../../components/Button";
import { Hint } from "../../../components/InfoTip";
import { CaptionStylePanel } from "../editor/CaptionStylePanel";
import { PresetBar } from "../editor/PresetBar";
import { usePlayback, type Playback } from "../editor/playback";
import type { RetimedAsk } from "../editor/retimedCopy";
import { isPlaced, unplacedOverrides } from "../editor/placing";
import { StyleFieldsSkeleton } from "../editor/StyleFields";
import type { StyleControls } from "../editor/useStyleDraft";
import { HookTimingFields } from "../HookEditor";
import { applyTextStyle, reshape, restyle, setFade, setVolume, type ItemActions, type SpeedRef } from "./actions";
import type { AdvancedEdits } from "./edits";
import { KeyingContext, useKeyTime } from "./KeyCluster";
import { keyedGroup, keyedInPick, keyedItem, segmentSpan, writeItemKey } from "./keying";
import { SegmentFields } from "./MainTrack";
import { SceneFields } from "./SceneFields";
import { MusicFields } from "./Music";
import { OverlayFields } from "./Overlays";
import { itemsOf, onlyItem, sameCue, type ItemKind, type Pick } from "./pick";
import { cueOf, resetCueTiming } from "./cueEdits";
import { ShapeFields, ShapesFields } from "./Shapes";
import { TextLayerFields, TextLayersFields } from "./TextLayers";

/**
 * The picked item's properties: a Segment's, a Text Layer's, a Shape's, a Music Clip's, an Overlay's,
 * the hook's, or a join's Transition; or, with several picked, what they are and what can be done to them
 * (several Text Layers, or several Shapes, have their look edited together).
 */
export function Inspector({
  pick,
  edits,
  duration,
  preview,
  fonts,
  captionStyle,
  presetsError,
  actions,
  mediaById,
  playback,
  transition,
  onEdits,
  onText,
  onShape,
  onMusic,
  onOverlay,
  onSegment,
  onSpeed,
  onReverse,
  copyOf,
  onHold,
  cropMode,
  captionsOf,
}: {
  pick: Pick;
  edits: AdvancedEdits;
  duration: number;
  preview: PreviewPlan | null;
  fonts: FontInfo[] | null;
  // The Caption Style panel's and the Preset bar's controls, writing the edits; null while the Presets load.
  captionStyle: StyleControls | null;
  presetsError: string | null;
  actions: ItemActions | null;
  mediaById: Map<string, MediaItem>;
  playback: Playback;
  // The Transitions' panel, for a picked join.
  transition: ReactNode;
  onEdits: (edits: AdvancedEdits, group?: string) => void;
  onText: (layer: TextLayer, group?: string) => void;
  onShape: (shape: Shape, group?: string) => void;
  onMusic: (clip: MusicClip, group?: string) => void;
  onOverlay: (overlay: Overlay, group?: string) => void;
  onSegment: (segment: ClipSegment, group?: string) => void;
  // A Segment's or video Overlay's Speed set (actions.ts' setSpeed), a change of `group`.
  onSpeed: (item: SpeedRef, speed: number, group: string) => void;
  // A Segment's or video Overlay's Reverse turned on or off (actions.ts' setReverse).
  onReverse: (item: SpeedRef, reverse: boolean) => void;
  // The Retimed copy the preview plays a Segment or video Overlay from, as the plan has it, if any.
  copyOf: (item: SpeedRef) => RetimedAsk | null;
  // A Freeze frame's hold set (actions.ts' setHold).
  onHold: (id: string, hold: number) => void;
  // What opens Crop mode on the stage for a picked Segment's or Overlay's picture: none where it can't be.
  cropMode?: (kind: "segment" | "overlay", id: string) => (() => void) | undefined;
  // A video's Segment's caption controls (MediaCaptionFields).
  captionsOf?: (segment: ClipSegment, item: MediaItem) => ReactNode;
}) {
  const splittable = usePlayback(playback, (time) => actions?.canSplit(time) ?? false);
  const only = onlyItem(pick);
  const find = <T extends { id: string }>(items: T[], kind: string) => (only?.kind === kind ? items.find((item) => item.id === only.id) : undefined);
  const keyTime = useKeyTime(playback);
  // Where the Segments play on the Timeline, which a video's Keyframes are set in.
  const keying = useContext(KeyingContext);
  const track = keying?.track;
  // An item's volume set from its slider, as its Volume Line sets it; a keyed Music Clip's or
  // video Segment's, as a Keyframe at the playhead.
  const volumeOf = (item: { kind: "music" | "segment"; id: string }) => (volume: number, group: string) => {
    const keyed = !!keyedItem(edits, item, track)?.keys.volume?.length;
    const outcome = keyed ? writeItemKey({ edits, pick, track }, item, "volume", volume, keyTime) : setVolume({ edits, pick }, item, volume);
    if (outcome?.notice) keying?.onNotice?.(outcome.notice);
    else if (outcome) onEdits(outcome.edits, keyedGroup(group, keyed, keyTime));
  };

  const items = itemsOf(pick);
  if (items.length > 1 && actions) {
    if (items.every((item) => item.kind === "text")) {
      return (
        <TextLayersFields
          layers={edits.text_layers.filter((layer) => items.some((item) => item.id === layer.id))}
          fonts={fonts}
          onChange={(change, group) => onEdits(restyle({ edits, pick }, change).edits, group)}
          onApplyTextStyle={(style) => onEdits(applyTextStyle({ edits, pick }, style).edits)}
          onDuplicate={actions.duplicate}
          onCopy={actions.copy}
          onDelete={actions.remove}
        />
      );
    }
    if (items.every((item) => item.kind === "shape")) {
      return (
        <ShapesFields
          shapes={edits.shapes.filter((shape) => items.some((item) => item.id === shape.id))}
          onChange={(change, group) => onEdits(reshape({ edits, pick }, change).edits, group)}
          onDuplicate={actions.duplicate}
          onCopy={actions.copy}
          onDelete={actions.remove}
        />
      );
    }
    return <PickSummary pick={pick} edits={edits} plan={preview?.plan ?? null} actions={actions} />;
  }
  if (pick?.kind === "join") {
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
        onVolume={volumeOf({ kind: "segment", id: segment.id })}
        onSpeed={(speed, group) => onSpeed({ kind: "segment", id: segment.id }, speed, group)}
        onReverse={(reverse) => onReverse({ kind: "segment", id: segment.id }, reverse)}
        copy={copyOf({ kind: "segment", id: segment.id })}
        onHold={(hold) => onHold(segment.id, hold)}
        onSourceVolume={(source_volume) => onEdits({ ...edits, source_volume }, "source-volume")}
        onCropMode={cropMode?.("segment", segment.id)}
        playback={playback}
        span={segmentSpan(edits.segments, segment.id, track)}
        captions={segment.media && mediaById.get(segment.media) ? captionsOf?.(segment, mediaById.get(segment.media)!) : undefined}
        scene={
          <SceneFields
            plan={preview?.plan ?? null}
            index={edits.segments.indexOf(segment)}
            count={edits.segments.length}
            playback={playback}
            edits={edits}
            onEdits={onEdits}
            onCropMode={cropMode?.("segment", segment.id)}
          />
        }
      />
    );
  }
  const layer = find(edits.text_layers, "text");
  if (layer && actions) {
    return (
      <TextLayerFields
        key={layer.id}
        layer={layer}
        duration={duration}
        fonts={fonts}
        onChange={onText}
        onApplyTextStyle={(style) => onEdits(applyTextStyle({ edits, pick }, style).edits)}
        onDuplicate={actions.duplicate}
        onDelete={actions.remove}
      />
    );
  }
  const shape = find(edits.shapes, "shape");
  if (shape && actions) {
    return <ShapeFields key={shape.id} shape={shape} duration={duration} onChange={onShape} onDuplicate={actions.duplicate} onDelete={actions.remove} />;
  }
  const clip = find(edits.music, "music");
  if (clip && actions) {
    return (
      <MusicFields
        key={clip.id}
        clip={clip}
        item={mediaById.get(clip.media)}
        duration={duration}
        playback={playback}
        onChange={onMusic}
        onVolume={volumeOf({ kind: "music", id: clip.id })}
        onFade={(fade, secs, group) => {
          const outcome = setFade({ edits, pick }, clip.id, fade, secs);
          if (outcome) onEdits(outcome.edits, group);
        }}
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
        playback={playback}
        onChange={onOverlay}
        onSpeed={(speed, group) => onSpeed({ kind: "overlay", id: overlay.id }, speed, group)}
        onReverse={(reverse) => onReverse({ kind: "overlay", id: overlay.id }, reverse)}
        copy={copyOf({ kind: "overlay", id: overlay.id })}
        onDuplicate={actions.duplicate}
        onDelete={actions.remove}
        onCropMode={cropMode?.("overlay", overlay.id)}
      />
    );
  }
  if (pick?.kind === "hook") {
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
  if (pick?.kind === "captions") {
    return <CaptionsFields edits={edits} style={captionStyle} error={presetsError} fonts={fonts} onEdits={onEdits} />;
  }
  if (pick?.kind === "cue") {
    return <CueFields cueKey={pick.key} edits={edits} plan={preview?.plan ?? null} onEdits={onEdits} />;
  }
  return (
    <div className="flex flex-col gap-1">
      <h2 className="font-semibold">Nothing selected</h2>
      <p className="text-sm text-pretty text-muted">Select an item on the timeline or the preview to change it.</p>
    </div>
  );
}

/**
 * The picked captions: their Style Preset and their whole Caption Style, the clip editor's Preset bar
 * and panel, each change one step of undo; and "Reset position".
 */
function CaptionsFields({
  edits,
  style,
  error,
  fonts,
  onEdits,
}: {
  edits: AdvancedEdits;
  style: StyleControls | null;
  error: string | null;
  fonts: FontInfo[] | null;
  onEdits: (edits: AdvancedEdits, group?: string) => void;
}) {
  const [more, setMore] = useState(false);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">Captions</h2>
        <Hint more="Drag one to move them all, or a corner to resize them; arrow keys nudge them.">Double-click a line on the preview to correct its words.</Hint>
      </div>
      <ResetPlace edits={edits} part="caption" onEdits={onEdits} />
      <PresetBar style={style} error={error} />
      {style ? <CaptionStylePanel style={style} fonts={fonts} more={more} onMore={setMore} inspector /> : !error && <StyleFieldsSkeleton />}
    </div>
  );
}

/**
 * A picked Cue: its words, when it is shown (as planned, its Cue Edit applied) and "Reset timing",
 * which clears its Cue Edit's timing. Its edges and body are dragged on the Captions Track.
 */
function CueFields({
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
  const cue = plan?.captions.find((other) => sameCue(other.key, cueKey));
  const shown = plan && cueOf(plan, cueKey);
  const reset = resetCueTiming({ edits, plan }, cueKey);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">Caption</h2>
        {cue && <p className="text-sm text-pretty break-words">“{cue.plain.join(" ")}”</p>}
        <Hint more="Drag its edges to show it earlier or later at either end, or its middle to move it with its highlight. It stays between the captions either side of it.">
          Retime it on the Captions Track.
        </Hint>
      </div>
      {shown && (
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <dt className="text-xs text-muted">Starts</dt>
            <dd className="tabular-nums">{shown.start.toFixed(2)} s</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Ends</dt>
            <dd className="tabular-nums">{shown.end.toFixed(2)} s</dd>
          </div>
        </dl>
      )}
      <Button size="sm" className="self-start" disabled={!reset} onClick={() => reset && onEdits(reset.edits)}>
        <RotateCcw aria-hidden size={16} />
        Reset timing
      </Button>
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

// Each kind of item's name, one and several.
const NAMES: Record<ItemKind, [string, string]> = {
  segment: ["Segment", "Segments"],
  text: ["Text Layer", "Text Layers"],
  shape: ["Shape", "Shapes"],
  music: ["Music Clip", "Music Clips"],
  overlay: ["Overlay", "Overlays"],
};

/**
 * Several items picked: how many of each kind, and what can be done to them all. Keyframes are edited
 * with one item picked: a note says so when some picked item has them.
 */
function PickSummary({ pick, edits, plan, actions }: { pick: Pick; edits: AdvancedEdits; plan: RenderPlan | null; actions: ItemActions }) {
  const items = itemsOf(pick);
  const keyed = keyedInPick(edits, pick, plan);
  const counts = (Object.keys(NAMES) as ItemKind[])
    .map((kind) => [kind, items.filter((item) => item.kind === kind).length] as const)
    .filter(([, count]) => count > 0)
    .map(([kind, count]) => `${count} ${NAMES[kind][count === 1 ? 0 : 1]}`);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <h2 className="font-semibold">{items.length} items</h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={actions.duplicate} aria-label="Duplicate them">
            <Copy aria-hidden size={17} />
          </Button>
          <Button variant="ghost" size="icon" onClick={actions.copy} aria-label="Copy them">
            <ClipboardCopy aria-hidden size={17} />
          </Button>
          <Button variant="ghost" size="icon" onClick={actions.remove} aria-label="Delete them">
            <Trash2 aria-hidden size={17} />
          </Button>
        </div>
      </div>
      <p className="text-sm text-pretty text-muted">{counts.join(", ")}</p>
      {keyed && <p className="text-sm text-pretty text-muted">Some of them have Keyframes: pick one alone to change its keyed fields.</p>}
    </div>
  );
}
