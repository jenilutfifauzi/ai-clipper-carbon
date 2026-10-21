import { ClipboardCopy, Copy, RotateCcw, Trash2 } from "lucide-react";
import { useContext, useState, type ReactNode } from "react";
import type { AdjustmentLayer, ClipSegment, FontInfo, MediaItem, MusicClip, Overlay, PreviewPlan, RenderPlan, Shape, TextLayer } from "../../../api";
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
import { applyTextStyle, reshape, restyle, setAdjustment, setDuck, setFade, setSpeech, setVolume, type Detacher, type ItemActions, type Outcome, type SpeedRef, type StackRef } from "./actions";
import { audioEffectChanges, AudioEffectsFields } from "./AudioEffectsFields";
import { videoEffectChanges, VideoEffectsFields } from "./VideoEffectsFields";
import { AdjustmentLayerFields } from "./AdjustmentLayers";
import { colorChanges, ColorFields } from "./ColorFields";
import type { AdvancedEdits } from "./edits";
import { KeyingContext, useKeyTime } from "./KeyCluster";
import { keyedGroup, keyedInPick, keyedItem, segmentSpan, writeItemKey } from "./keying";
import { SegmentFields } from "./MainTrack";
import { SceneFields } from "./SceneFields";
import { MusicFields } from "./Music";
import { OverlayFields } from "./Overlays";
import { itemsOf, onlyItem, type ItemKind, type Pick } from "./pick";
import { CueFields } from "./CueFields";
import type { TrackKind } from "./trackState";
import { ShapeFields, ShapesFields } from "./Shapes";
import { TextLayerFields, TextLayersFields } from "./TextLayers";

/**
 * The picked item's properties: a Segment's, a Text Layer's, a Shape's, a Music Clip's, an Overlay's, an Adjustment Layer's,
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
  sourceLength,
  playback,
  transition,
  onEdits,
  onText,
  onShape,
  onAdjustment,
  onMusic,
  onOverlay,
  onSegment,
  onSpeed,
  onReverse,
  copyOf,
  onHold,
  cropMode,
  locked = [],
  onCue,
  captionsOf,
  detaching,
  effectsPreparing,
  effectsElsewhere = false,
  videoEffectsShown = true,
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
  // The Source's length, which a Music Clip of the Source reads within.
  sourceLength: number;
  playback: Playback;
  // The Transitions' panel, for a picked join.
  transition: ReactNode;
  onEdits: (edits: AdvancedEdits, group?: string) => void;
  onText: (layer: TextLayer, group?: string) => void;
  onShape: (shape: Shape, group?: string) => void;
  onAdjustment: (layer: AdjustmentLayer, group?: string) => void;
  onMusic: (clip: MusicClip, group?: string) => void;
  onOverlay: (overlay: Overlay, group?: string) => void;
  onSegment: (segment: ClipSegment, group?: string) => void;
  // A Segment's, video Overlay's or Music Clip's Speed set (actions.ts' setSpeed), a change of `group`.
  onSpeed: (item: SpeedRef, speed: number, group: string) => void;
  // A Segment's, video Overlay's or Music Clip's Reverse turned on or off (actions.ts' setReverse).
  onReverse: (item: SpeedRef, reverse: boolean) => void;
  // The Retimed copy the preview plays a Segment, video Overlay or Music Clip from, as the plan has it, if any.
  copyOf: (item: SpeedRef) => RetimedAsk | null;
  // A Freeze frame's hold set (actions.ts' setHold).
  onHold: (id: string, hold: number) => void;
  // What opens Crop mode on the stage for a picked Segment's or Overlay's picture: none where it can't be.
  cropMode?: (kind: "segment" | "overlay", id: string) => (() => void) | undefined;
  // The locked Tracks: a picked Cue's actions are refused on a locked Captions Track.
  locked?: TrackKind[];
  // A picked Cue's action applied: its edits as one change (of `group`) and what it picks.
  onCue: (outcome: Outcome, group?: string) => void;
  // A video's Segment's caption controls (MediaCaptionFields).
  captionsOf?: (segment: ClipSegment, item: MediaItem) => ReactNode;
  // Detach and Reattach of a Segment's sound (GLOSSARY.md).
  detaching?: Detacher;
  // Whether any of these items' Effected copies is being made: "Preparing effects…" (ticket 03 feeds it; none until then).
  effectsPreparing?: (items: StackRef[]) => boolean;
  // On a phone, the Audio Effects section is the toolbar's Audio effects sheet, not here.
  effectsElsewhere?: boolean;
  // Whether the Video Effects section is shown: on a desktop only (a phone plays them, not edits them).
  videoEffectsShown?: boolean;
}) {
  const splittable = usePlayback(playback, (time) => actions?.canSplit(time) ?? false);
  const only = onlyItem(pick);
  const find = <T extends { id: string }>(items: T[], kind: string) => (only?.kind === kind ? items.find((item) => item.id === only.id) : undefined);
  const keyTime = useKeyTime(playback);
  // Where the Segments play on the Timeline, which their Keyframes are set in.
  const keying = useContext(KeyingContext);
  const track = keying?.track;
  // An item's volume set from its slider, as its Volume Line sets it; a keyed Music Clip's or
  // Segment's, as a Keyframe at the playhead.
  const volumeOf = (item: { kind: "music" | "segment"; id: string }) => (volume: number, group: string) => {
    const keyed = !!keyedItem(edits, item, track)?.keys.volume?.length;
    const outcome = keyed ? writeItemKey({ edits, pick, track }, item, "volume", volume, keyTime) : setVolume({ edits, pick }, item, volume);
    if (outcome?.notice) keying?.onNotice?.(outcome.notice);
    else if (outcome) onEdits(outcome.edits, keyedGroup(group, keyed, keyTime));
  };

  // A Detached sound's Segment, while it is there to Reattach it to.
  const detachedOf = ({ detached_from }: MusicClip) => {
    const index = edits.segments.findIndex((segment) => segment.id === detached_from);
    return detached_from && index !== -1 && detaching ? { index, onReattach: () => detaching.reattach(detached_from) } : undefined;
  };

  // The picked Segments', Overlays' and Adjustment Layers' Color section: a dial set on all of them, or all reset, each one change.
  const colorOf = () => <ColorFields {...colorChanges({ edits, pick }, onEdits)} />;

  // The picked items' Audio Effects section, for those with sound (a Freeze frame and an image have none): null without any.
  const sounded = (media: string) => mediaById.get(media)?.has_audio === true;
  const effectsOf = () => {
    if (effectsElsewhere) return null;
    const controls = audioEffectChanges({ edits, pick }, sounded, onEdits, effectsPreparing);
    return controls && <AudioEffectsFields {...controls} />;
  };

  // The picked pictures' (Segments', Overlays' and Adjustment Layers') Video Effects section, after their Color section: null without any, or on a phone.
  const pictureEffectsOf = () => {
    if (!videoEffectsShown) return null;
    const controls = videoEffectChanges({ edits, pick }, onEdits);
    return controls && <VideoEffectsFields {...controls} />;
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
    const summary = <PickSummary pick={pick} edits={edits} plan={preview?.plan ?? null} actions={actions} />;
    // Several Segments, Overlays and Adjustment Layers: their Grades edited together.
    const graded = items.every((item) => item.kind === "segment" || item.kind === "overlay" || item.kind === "adjustment");
    // Those with sound: their Audio Effects edited together.
    const effects = effectsOf();
    if (!graded && !effects) return summary;
    return (
      <div className="flex flex-col gap-4">
        {summary}
        {graded && colorOf()}
        {graded && pictureEffectsOf()}
        {effects}
      </div>
    );
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
        onFade={(fade, secs, group) => {
          const outcome = setFade({ edits, pick }, segment.id, fade, secs);
          if (outcome) onEdits(outcome.edits, group);
        }}
        onSpeed={(speed, group) => onSpeed({ kind: "segment", id: segment.id }, speed, group)}
        onReverse={(reverse) => onReverse({ kind: "segment", id: segment.id }, reverse)}
        copy={copyOf({ kind: "segment", id: segment.id })}
        onHold={(hold) => onHold(segment.id, hold)}
        onSourceVolume={(source_volume) => onEdits({ ...edits, source_volume }, "source-volume")}
        onCropMode={cropMode?.("segment", segment.id)}
        onDetach={detaching?.canDetach(segment.id) ? () => detaching.detach(segment.id) : undefined}
        onReattach={detaching?.canReattach(segment.id) ? () => detaching.reattach(segment.id) : undefined}
        playback={playback}
        span={segmentSpan(edits.segments, segment.id, track)}
        captions={segment.media && mediaById.get(segment.media) ? captionsOf?.(segment, mediaById.get(segment.media)!) : undefined}
        color={colorOf()}
        pictureEffects={pictureEffectsOf()}
        effects={effectsOf()}
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
  const adjustment = find(edits.adjustment_layers ?? [], "adjustment");
  if (adjustment && actions) {
    return (
      <AdjustmentLayerFields
        key={adjustment.id}
        layer={adjustment}
        duration={duration}
        color={colorOf()}
        pictureEffects={pictureEffectsOf()}
        onChange={onAdjustment}
        onMix={(change, group) => {
          const outcome = setAdjustment({ edits, pick }, adjustment.id, change);
          if (outcome) onEdits(outcome.edits, group);
        }}
        onDuplicate={actions.duplicate}
        onDelete={actions.remove}
      />
    );
  }
  const clip = find(edits.music, "music");
  if (clip && actions) {
    return (
      <MusicFields
        key={clip.id}
        clip={clip}
        item={clip.media ? mediaById.get(clip.media) : undefined}
        sourceLength={sourceLength}
        duration={duration}
        playback={playback}
        onChange={onMusic}
        onSpeed={(speed, group) => onSpeed({ kind: "music", id: clip.id }, speed, group)}
        onReverse={(reverse) => onReverse({ kind: "music", id: clip.id }, reverse)}
        copy={copyOf({ kind: "music", id: clip.id })}
        onVolume={volumeOf({ kind: "music", id: clip.id })}
        onFade={(fade, secs, group) => {
          const outcome = setFade({ edits, pick }, clip.id, fade, secs);
          if (outcome) onEdits(outcome.edits, group);
        }}
        onDuck={(duck, group) => {
          const outcome = setDuck({ edits, pick }, clip.id, duck);
          if (outcome) onEdits(outcome.edits, group);
        }}
        onSpeech={(speech) => {
          const outcome = setSpeech({ edits, pick }, clip.id, speech);
          if (outcome) onEdits(outcome.edits);
        }}
        onDuplicate={actions.duplicate}
        onDelete={actions.remove}
        detached={detachedOf(clip)}
        effects={effectsOf()}
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
        color={colorOf()}
        pictureEffects={pictureEffectsOf()}
        effects={effectsOf()}
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
    return <CueFields cueKey={pick.key} edits={edits} preview={preview} locked={locked} playback={playback} onCue={onCue} />;
  }
  // Nothing picked: the Candidate's own Grade (ADR 0013), over the whole Main Track, each dial one change.
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">Nothing selected</h2>
        <p className="text-sm text-pretty text-muted">
          Select an item on the timeline or the preview to change it. The Color here grades the whole clip, not its Overlays.
        </p>
      </div>
      <ColorFields {...colorChanges({ edits, pick: null }, onEdits)} />
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
  adjustment: ["Adjustment Layer", "Adjustment Layers"],
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
