import { Pause, Play, Repeat, SkipForward } from "lucide-react";
import { createRef, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import {
  CUE_MAX_SCALE,
  CUE_MIN_SCALE,
  logoUrl,
  type Box,
  type CaptionStyle,
  type Cue,
  type CueKey,
  type DropShadow,
  type Crop,
  type FontInfo,
  type HookEvent,
  type HookStyle,
  type Panel,
  type Picture,
  type PictureLayerEvent,
  type PreviewPlan,
  type RenderPlan,
  type Transform,
  type WatermarkEvent,
} from "../../../api";
import { Button } from "../../../components/Button";
import { cssFontSize, fontFamily } from "../../../fonts";
import { useLooks } from "../../../looks";
import { cx, formatPrecise } from "../../../format";
import { RATES, usePlayback, useShown, type Playback } from "./playback";
import { allStroke, FRAME, hasKeyedPictures, isKeyed, overlaysAt, pictureAt, pictureLayers, pictureStyle, scenesAt, slotView } from "./picture";
import { PreviewEffected } from "./PreviewEffected";
import { PreviewMusic } from "./PreviewMusic";
import { PreviewOverlays } from "./PreviewOverlays";
import { PreviewSegments } from "./PreviewSegments";
import { InlineText, type Editing, type Retype } from "./InlineText";
import { hookEnds, hookLook } from "./animation";
import { placedLayer, useLayerPicture, wantedPicture, type PlacedLayer } from "./layerPicture";
import { heldLayerEvent, layerEventAt, layersAt, layerStagePicture } from "./layerStage";
import type { Place } from "./placing";
import { PreviewTransitions } from "./PreviewTransitions";
import { DecksGraded, EffectFilters, GradeFilters } from "./GradeFilters";
import { pictureBox } from "./videoEffects";
import { PreviewAdjusted } from "./PreviewAdjustments";
import { sceneAt, segmentOfScene } from "./ScenesTrack";
import { framePoint, type Size } from "./pictureGestures";
import { picturesAt, SAFE_BOTTOM, SAFE_TOP } from "./smartGuides";
import { StageHandles, useStageEdit, type StageEdit, type StageItem, type StagePicture } from "./StageEdit";
import { drawnShadow, highlightShape } from "./styleShape";
import { trackedWidth, trackedX, wordSpan } from "./tracking";
import { cueLineMiddle, cueStageId, cueWordAt, cueWords } from "./cues";
import type { GripSet } from "./stagePicture";
import type { BoxEdge } from "./textBox";

// The planner's and renderer's numbers the drawing repeats (backend/app/planner.py, renderer.py).
// In a staggered entrance, each element of the hook comes on this long after the one before.
const HOOK_STAGGER_SECS = 0.08;
// The Quote Mark's corners, as a share of its width, and its marks on a badge 100 units wide: two
// dots and their tails (renderer.py's QUOTE_RADIUS, QUOTE_DOT_RADIUS, QUOTE_DOTS, _quote_marks).
const QUOTE_RADIUS = 0.22;
const QUOTE_DOT_RADIUS = 11;
const QUOTE_DOTS = [
  [35, 58.8],
  [65, 58.8],
];
// Blur's background, blurred with a sigma of 10 shrunk pixels at a quarter size, and darkened.
export const BLUR_SIGMA = 40;
export const BLUR_BRIGHTNESS = 0.9;
// How far an arrow key nudges the Watermark, in output pixels (with Shift, five times as far).
const NUDGE_PX = 8;
// How much of the ending "Play ending" plays.
const ENDING_SECS = 3;

const percent = (value: number) => `${value * 100}%`;

/**
 * The Candidate as its Clip will look: the Source framed by the Preview Plan's Scenes (each panel a
 * crop of the video, following its path), with the plan's caption lines and hook drawn over it
 * where, when and how large the render will draw them. Drawn in the output's 1080x1920 pixels and
 * scaled to fit. The Source plays on two decks (docs/adr/0006-the-preview-plays-the-source-on-two-decks.md),
 * each two videos in step, one per panel (Split's two, or Blur's background and shot): the first is
 * the master, which `playback` drives and which is heard while its deck is live. The panels show
 * the live deck; the other waits, hidden, for the next join.
 * With `onWatermarkMove`, the Watermark can be dragged (or nudged with the arrow keys) to a new
 * centre, in output pixels. With `stage`, the hook, the captions and (in the Advanced Edit) the Text
 * Layers on screen are picked by a click (several with Shift, Cmd or Ctrl, which then move
 * together), moved, resized and retyped on the frame (StageEdit.tsx, InlineText.tsx); and in the
 * Advanced Edit the Overlays and the picture behind them are picked and transformed by their Grips.
 * While a picture is held, it is drawn from the drag until the plan has it. With `fit`, the frame is as large as fits the space its parent gives it (the
 * Advanced Edit's player), and the transport is a single row, ending with `tools`; with `rates` too,
 * it offers the playback rate, and with `loop` a button that turns Loop on and off; with `hideBar`,
 * that row fades out (full screen, while the pointer is still). `over` is laid over the stage.
 */
export function ClipPreview({
  src,
  jobId,
  preview,
  fonts,
  playback,
  onWatermarkMove,
  stage: controls,
  fit = false,
  rates = false,
  loop,
  blank = false,
  tools,
  hideBar = false,
  over,
  onPlay,
}: {
  src: string;
  // The Job whose Source `src` is: a reversed Segment of it plays from its Retimed copy.
  jobId: string;
  preview: PreviewPlan | null;
  fonts: FontInfo[] | null;
  playback: Playback;
  onWatermarkMove?: (x: number, y: number) => void;
  stage?: StageControls;
  fit?: boolean;
  rates?: boolean;
  // Loop on or off, and what turns it over (the Advanced Edit's Loop Region).
  loop?: LoopControl;
  // Black where the Segments are (the Advanced Edit's Video Track hidden).
  blank?: boolean;
  tools?: ReactNode;
  hideBar?: boolean;
  // Laid over the whole stage, under nothing (the Advanced Edit's Compare render).
  over?: ReactNode;
  // What the Play button does instead of playing or pausing (the Advanced Edit's Space, which stops a
  // Take while one records).
  onPlay?: () => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const room = useRef<HTMLDivElement>(null);
  // The Segments' picture, which a Transition's look styles as its incoming side.
  const incoming = useRef<HTMLDivElement>(null);
  // Each deck's videos, its master then its follower; and the masters, whose sound PreviewMusic sets.
  const decks = useMemo(() => [0, 1].map(() => [createRef<HTMLVideoElement>(), createRef<HTMLVideoElement>()]), []);
  const masters = useMemo(() => decks.map(([master]) => master), [decks]);
  const [scale, setScale] = useState(1 / 3);
  const fitted = useFittedSize(room, fit);
  const plan = preview?.plan ?? null;

  useEffect(() => {
    const slots = [0, 1] as const;
    for (const slot of slots) playback.attachDeck(slot, decks[slot][0].current, decks[slot][1].current);
    return () => {
      for (const slot of slots) playback.attachDeck(slot, null);
    };
  }, [playback, decks]);
  const shownDeck = usePlayback(playback, (_, p) => p.shownDeck);
  const shownSegment = usePlayback(playback, (_, p) => p.shownSegmentIndex);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / 1080));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const sceneIndex = useShown(playback, (time, p) => (plan ? sceneAt(plan, time, p.shownSegmentIndex) : 0));
  const fontById = useMemo(() => new Map((fonts ?? []).map((font) => [font.id, font])), [fonts]);
  const watermark = useWatermarkDrag(plan, stage, onWatermarkMove);
  // What is being retyped, the playback paused while it is.
  const [editing, setEditing] = useState<Editing | null>(null);
  const retype = controls?.retype;
  const startEditing = retype
    ? (next: Editing) => {
        playback.pause();
        setEditing(next);
      }
    : undefined;
  const items = plan && fonts && controls ? stageItems(plan, fontById, controls, startEditing, () => playback.time) : [];
  // The picture under the playhead, unless the Video Track is hidden.
  const behind = plan && !blank && controls?.pictureAt ? controls.pictureAt(segmentOfScene(plan, sceneIndex), sceneIndex) : null;
  // Keyed pictures' handles and Grips go by their bounds at the playhead: drawn again at each new
  // time while paused, and left where they were while playing, which doesn't draw the stage again.
  const keyedAt = useKeyedTime(plan, playback);
  const pictures =
    plan && controls
      ? stagePictures(
          keyedAt === null ? plan : { ...plan, overlays: overlaysAt(plan, keyedAt), scenes: scenesAt(plan, keyedAt), ...layersAt(plan, keyedAt) },
          controls,
          behind,
          sceneIndex,
          keyedAt ?? playback.time,
          startEditing,
        )
      : [];
  // What is picked on the stage: moving one of several moves them all.
  const picked: string[] = [...(controls?.selected ?? []), ...(behind?.picked ? [behindId(sceneIndex)] : [])];
  const edit = useStageEdit(
    plan,
    stage,
    items,
    pictures,
    picked,
    (id, toggle) => (id.startsWith("picture:") ? behind?.onPick(toggle) : controls?.onSelect(id as PickedOnStage, toggle)),
    // What a picture snaps to: the pictures shown now, the Segment's unless the Video Track is hidden.
    () => (plan ? picturesAt(plan, playback.time, blank ? null : sceneAt(plan, playback.time, playback.shownSegmentIndex)) : []),
    // Crop mode, asked for by the editor's Crop, holds the playback still.
    { asked: controls?.cropAsked, onOpen: () => playback.pause() },
  );
  // The plan as drawn: a picture held or moved with one is drawn where it is being put.
  const drawn = plan && edit.moving ? drawnPlan(plan, edit, sceneIndex, keyedAt) : plan;
  // Drawn again once the Looks' values are known, for the Grades with a Look.
  useLooks();
  // What is dropped on the stage from the asset panel (a Stickers tile), at its point on the frame.
  const [dropOver, setDropOver] = useState(false);
  const takes = (data: DataTransfer) => !!controls?.drop && controls.drop.types.some((type) => data.types.includes(type));
  const scene = drawn?.scenes[sceneIndex];

  const frame = (
    <div
      ref={stage}
      className={cx(
        "relative mx-auto overflow-hidden rounded-control bg-black outline-1 -outline-offset-1 outline-white/10",
        fit ? "shrink-0" : "aspect-[9/16] w-full max-w-[22rem]",
        // The Advanced Edit's stage takes every finger: a pinch or a drag there neither zooms nor
        // scrolls the page (in the clip editor, a swipe over the preview still scrolls it).
        fit && controls && "touch-none",
      )}
      style={{ "--scale": scale, ...(fit ? { width: fitted.width, height: fitted.height } : {}) } as CSSProperties}
      onDragOver={(event) => {
        if (!takes(event.dataTransfer)) return;
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setDropOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropOver(false);
      }}
      onDrop={(event) => {
        setDropOver(false);
        if (!takes(event.dataTransfer) || !plan) return;
        event.preventDefault();
        controls?.drop?.onDrop(event.dataTransfer, framePoint(event.currentTarget.getBoundingClientRect(), event, plan));
      }}
    >
      {drawn && <GradeFilters grades={[...drawn.segments, ...drawn.overlays, drawn].map((item) => item.grade)} />}
      {drawn && (
        <EffectFilters
          items={[
            ...drawn.segments.map((segment) => ({ effects: segment.video_effects, box: FRAME })),
            ...drawn.overlays.map((event) => ({ effects: event.video_effects, box: pictureBox(event.picture) })),
          ]}
        />
      )}
      {/* The Main Track and the Overlays under the Adjustment Layers showing (ADR 0013). */}
      <PreviewAdjusted plan={drawn} playback={playback}>
        {/* The pictures of the Segments, hidden (still playing their sound) while the Video Track is, in the
            Candidate's Grade (ADR 0013): the joined Main Track's, never the Overlays' after it. */}
        <div data-main-track className={cx("absolute inset-0", blank && "opacity-0")}>
          <DecksGraded grade={drawn?.grade}>
            {/* The playing Segment's picture: a Transition's incoming side, which its look may style. */}
            <div ref={incoming} className="absolute inset-0">
              {/* The decks' panels in the shown Segment's Grade and Video Effects (ADR 0013, 0014): its whole frame, black included. */}
              <DecksGraded grade={drawn?.segments[shownSegment]?.grade} effects={drawn?.segments[shownSegment]?.video_effects}>
                {decks.map((refs, deck) =>
                  refs.map((ref, slot) => (
                    <PanelView
                      key={`${deck}:${slot}`}
                      videoRef={ref}
                      src={src}
                      plan={drawn}
                      {...slotView(scene, slot)}
                      playback={playback}
                      muted={deck > 0 || slot > 0}
                      hidden={deck !== shownDeck}
                    />
                  )),
                )}
              </DecksGraded>
              <PreviewSegments plan={drawn} playback={playback} src={src} jobId={jobId} />
            </div>
            <PreviewTransitions plan={drawn} playback={playback} src={src} jobId={jobId} incoming={incoming} />
          </DecksGraded>
        </div>
        <PreviewOverlays
          plan={drawn}
          playback={playback}
          selected={(controls?.selected ?? []).flatMap((id) => (id.startsWith("overlay:") ? [id.slice("overlay:".length)] : []))}
        />
      </PreviewAdjusted>
      {plan && fonts && (
        <svg viewBox={`0 0 ${plan.width} ${plan.height}`} className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          {watermark.event && <Watermark plan={plan} event={watermark.event} font={fontById.get(plan.watermark_style.font)} />}
          {editing?.kind !== "captions" && (
            <Captions plan={plan} font={fontById.get(plan.caption_style.font)} playback={playback} edit={edit} />
          )}
          {pictureLayers(drawn ?? plan).map(
            ({ id, event }) =>
              !(editing?.kind === "text" && id === `text:${editing.id}`) && (
                <PictureLayerView key={id} event={event} jobId={jobId} playback={playback} still={controls?.selected.includes(id)} />
              ),
          )}
          {plan.hook && editing?.kind !== "hook" && editing?.kind !== "kicker" && (
            <Hook
              plan={plan}
              hook={plan.hook}
              font={fontById.get(plan.hook_style.font)}
              playback={playback}
              moving={edit.transform("hook", plan.hook.area)}
              still={controls?.selected.includes("hook")}
            />
          )}
        </svg>
      )}
      {plan && watermark.event && onWatermarkMove && (
        <div
          role="button"
          tabIndex={0}
          aria-roledescription="movable watermark"
          aria-label="Watermark: drag to move it, or use the arrow keys"
          {...watermark.handlers}
          className={cx(
            "absolute cursor-move touch-none rounded-[4px] outline-1 outline-white/70 outline-dashed",
            "hover:outline-white focus-visible:outline-2 focus-visible:outline-focus focus-visible:outline-solid",
            watermark.dragging && "cursor-grabbing outline-white",
          )}
          style={{
            left: percent(watermark.event.area.x / plan.width),
            top: percent(watermark.event.area.y / plan.height),
            width: percent(watermark.event.area.width / plan.width),
            height: percent(watermark.event.area.height / plan.height),
          }}
        />
      )}
      {plan && controls && <StageHandles plan={plan} playback={playback} edit={edit} scale={scale} />}
      {dropOver && <div aria-hidden className="pointer-events-none absolute inset-0 bg-accent/10" />}
      {preview && editing && retype && (
        <InlineText
          // A keyed Text Layer is retyped where it is at the playhead.
          preview={keyedAt === null ? preview : { ...preview, plan: { ...preview.plan, ...layersAt(preview.plan, keyedAt) } }}
          fontById={fontById}
          editing={editing}
          retype={retype}
          onClose={() => setEditing(null)}
        />
      )}
      {over}
      <PreviewMusic plan={plan} playback={playback} masters={masters} src={src} jobId={jobId} />
      <PreviewEffected plan={plan} playback={playback} />
    </div>
  );
  if (fit) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div ref={room} className="flex min-h-0 flex-1 items-center justify-center">
          {frame}
        </div>
        <Transport playback={playback} compact rates={rates} loop={loop} tools={tools} hidden={hideBar} onPlay={onPlay} />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-3">
      {frame}
      <Transport playback={playback} />
    </div>
  );
}

/**
 * The time a plan with keyed pictures (an Overlay's, a video Segment's or a Manual Scene's) has them sampled at for the
 * stage: the playhead's while paused, and the last one paused at while playing; null without any.
 */
function useKeyedTime(plan: RenderPlan | null, playback: Playback): number | null {
  const keyed = !!plan && hasKeyedPictures(plan);
  const paused = useRef(playback.time);
  const time = usePlayback(playback, (now, p) => (keyed && !p.playing ? now : null));
  if (time !== null) paused.current = time;
  return keyed ? paused.current : null;
}

// The picture behind the Overlays, at the plan's Scene `scene`: another Scene's is another picture,
// so that one held isn't drawn in the next Scene, nor saved to it.
const behindId = (scene: number): StageId => `picture:${scene}`;

/**
 * The pictures `controls` can pick and transform on the stage, in the order they are drawn: the
 * picture `behind` every Overlay (of the plan's Scene `scene`), then the Overlays, as they are at
 * `time`, then the Shapes and the Text Layers, by their areas (layerStage.ts) as they are at `time`,
 * each Text Layer retyped by `edit` when given.
 */
function stagePictures(
  plan: RenderPlan,
  controls: StageControls,
  behind: PictureTarget | null,
  scene: number,
  time: number,
  edit: ((editing: Editing) => void) | undefined,
): StagePicture[] {
  const pictures: StagePicture[] = [];
  const shown = plan.scenes[scene];
  if (behind && shown) {
    const picture = behind.transform ? shown.picture : null;
    pictures.push({
      id: behindId(scene),
      label: shown.layout === "media" ? "Video" : shown.layout === "manual" ? "Scene, framed by hand" : "Scene",
      start: shown.start,
      end: shown.end,
      picture,
      transform: picture && behind.transform,
      behind: true,
      grips: behind.grips,
      onTransform: behind.onTransform,
      crop: picture && behind.crop,
      onCrop: behind.onCrop,
    });
  }
  const overlays = controls.overlays;
  for (const event of overlays ? plan.overlays : []) {
    const transform = overlays!.transformOf(event.id, time);
    if (!transform) continue;
    pictures.push({
      id: `overlay:${event.id}`,
      label: "Overlay",
      start: event.start,
      end: event.end,
      picture: event.picture,
      transform,
      onTransform: (next, group) => overlays!.onTransform(event.id, next, group, time),
      crop: overlays!.cropOf?.(event.id) ?? null,
      onCrop: overlays!.onCrop && ((crop, next, group) => overlays!.onCrop!(event.id, crop, next, group)),
    });
  }
  const shapes = controls.shapes;
  for (const event of shapes ? plan.shapes : []) {
    const { picture, fitted } = layerStagePicture(event);
    const { id, style, keys } = event.layer;
    const onResize = shapes!.onResize;
    const ends = allStroke(style.kind);
    pictures.push({
      id: `shape:${id}`,
      label: ends ? `Shape: ${style.kind}` : "Shape",
      start: event.start,
      end: event.end,
      picture,
      fitted,
      transform: shapes!.transformOf(id, time) ?? event.layer.transform,
      grips: !onResize ? "corners-rotate" : ends ? "ends" : "all",
      onTransform: (next, group) => shapes!.onTransform(id, next, group, time),
      // Its position keyed, an edge resizes it about its centre, as a Text Layer's box Grip does,
      // so that a resize writes no Keyframe.
      resize: onResize && { aboutCentre: !!(keys.x?.length || keys.y?.length), onResize: (box, next, group) => onResize(id, box, next, group, time) },
    });
  }
  const texts = controls.texts;
  for (const event of texts ? plan.texts : []) {
    const { picture, fitted } = layerStagePicture(event);
    pictures.push({
      id: `text:${event.layer.id}`,
      label: `Text: ${event.lines.join(" ")}`,
      start: event.start,
      end: event.end,
      picture,
      fitted,
      transform: texts!.transformOf(event.layer.id, time) ?? event.layer.transform,
      grips: "corners-rotate",
      onTransform: (next, group) => texts!.onTransform(event.layer.id, next, group, time),
      onBox: texts!.onBox && ((edge, length, group) => texts!.onBox!(event.layer.id, edge, length, group)),
      onEdit: edit && (() => edit({ kind: "text", id: event.layer.id })),
    });
  }
  return pictures;
}

// The plan with its Overlays, picture layers and the Scene `scene`'s picture drawn where the stage
// holds them; a keyed picture layer held where the stage has it at `keyedAt` (useKeyedTime), still.
function drawnPlan(plan: RenderPlan, edit: StageEdit, scene: number, keyedAt: number | null): RenderPlan {
  const overlays = plan.overlays.map((event) => {
    const picture = edit.shownPicture(`overlay:${event.id}`, event.picture);
    return picture === event.picture ? event : { ...event, picture };
  });
  const scenes = plan.scenes.map((each, index) => {
    const picture = index === scene && each.picture ? edit.shownPicture(behindId(scene), each.picture) : each.picture;
    return picture === each.picture ? each : { ...each, picture };
  });
  // A picture layer of the stage's `id`, as the stage holds it.
  const held = <Event extends PictureLayerEvent>(event: Event, id: string): Event => {
    const at = keyedAt === null ? event : layerEventAt(event, keyedAt);
    const { picture } = layerStagePicture(at);
    const shown = edit.shownPicture(id, picture);
    return shown === picture ? event : heldLayerEvent(at, picture, shown);
  };
  const shapes = plan.shapes.map((event) => held(event, `shape:${event.layer.id}`));
  const texts = plan.texts.map((event) => held(event, `text:${event.layer.id}`));
  return { ...plan, overlays, scenes, shapes, texts };
}

// The largest 9:16 size that fits in `room`, in CSS pixels, while `on`.
function useFittedSize(room: React.RefObject<HTMLDivElement | null>, on: boolean) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = room.current;
    if (!on || !element) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      const unit = Math.max(0, Math.min(width / 9, height / 16));
      setSize({ width: Math.floor(unit * 9), height: Math.floor(unit * 16) });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [room, on]);
  return size;
}

/**
 * The Watermark as drawn, and the pointer and key handlers that move it. While it is dragged, and
 * until a plan of another Watermark Style comes (the one it was moved to, or any other edit), it is
 * drawn where it is being put: the plan comes back from the backend only after the draft changes.
 */
function useWatermarkDrag(
  plan: RenderPlan | null,
  stage: React.RefObject<HTMLDivElement | null>,
  onMove: ((x: number, y: number) => void) | undefined,
) {
  const event = plan?.watermark ?? null;
  // The centre it is put at, and the plan it was moved in (it shows while that is the plan).
  const [held, setHeld] = useState<{ x: number; y: number; from: string } | null>(null);
  const [drag, setDrag] = useState<{ pointer: number; dx: number; dy: number; moved: boolean } | null>(null);
  const from = event && plan ? `${JSON.stringify(plan.watermark_style)}@${boxKey(event.area)}` : "";
  const centre = held && held.from === from ? held : event && { x: event.area.x + event.area.width / 2, y: event.area.y + event.area.height / 2 };

  function place(x: number, y: number): { x: number; y: number } {
    if (!event || !plan) return { x, y };
    const { width, height } = event.area;
    return {
      x: Math.round(Math.min(Math.max(x, width / 2), plan.width - width / 2)),
      y: Math.round(Math.min(Math.max(y, height / 2), plan.height - height / 2)),
    };
  }

  // Where the pointer is, in output pixels.
  function at(pointer: PointerEvent): { x: number; y: number } | null {
    const rect = stage.current?.getBoundingClientRect();
    if (!rect || !plan) return null;
    return { x: ((pointer.clientX - rect.left) / rect.width) * plan.width, y: ((pointer.clientY - rect.top) / rect.height) * plan.height };
  }

  function put(x: number, y: number) {
    const placed = place(x, y);
    setHeld({ ...placed, from });
    onMove?.(placed.x, placed.y);
  }

  const handlers = {
    onPointerDown: (pointer: PointerEvent<HTMLDivElement>) => {
      const point = at(pointer);
      if (!point || !centre || pointer.button !== 0) return;
      pointer.preventDefault();
      pointer.currentTarget.setPointerCapture(pointer.pointerId);
      // Held by where it was grabbed, so it doesn't jump to centre on the pointer.
      setDrag({ pointer: pointer.pointerId, dx: centre.x - point.x, dy: centre.y - point.y, moved: false });
    },
    onPointerMove: (pointer: PointerEvent<HTMLDivElement>) => {
      const point = at(pointer);
      if (!drag || pointer.pointerId !== drag.pointer || !point) return;
      if (!drag.moved) setDrag({ ...drag, moved: true });
      setHeld({ ...place(point.x + drag.dx, point.y + drag.dy), from });
    },
    onPointerUp: (pointer: PointerEvent<HTMLDivElement>) => {
      if (!drag || pointer.pointerId !== drag.pointer) return;
      setDrag(null);
      // A click that doesn't move it leaves it in its place.
      if (drag.moved && centre) put(centre.x, centre.y);
    },
    onPointerCancel: () => {
      setDrag(null);
      setHeld(null);
    },
    onKeyDown: (key: KeyboardEvent<HTMLDivElement>) => {
      const step = key.shiftKey ? NUDGE_PX * 5 : NUDGE_PX;
      const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[key.key];
      if (!delta || !centre) return;
      key.preventDefault();
      put(centre.x + delta[0], centre.y + delta[1]);
    },
  };

  const shown: WatermarkEvent | null =
    event && centre
      ? {
          ...event,
          area: { ...event.area, x: Math.round(centre.x - event.area.width / 2), y: Math.round(centre.y - event.area.height / 2) },
        }
      : null;
  return { event: shown, handlers, dragging: drag !== null };
}

/**
 * The hold of an editor on what can be moved on the preview: the hook ("hook"), the captions
 * ("captions"), with `texts` each Text Layer ("text:<id>"), with `shapes` each Shape ("shape:<id>"),
 * with `overlays` each Overlay ("overlay:<id>"), and with `pictureAt` the picture behind them all
 * ("picture:<n>": the Segment under the playhead, at the plan's Scene n). Which are picked, what a
 * click picks (with Shift, Cmd or Ctrl, `toggle`), where a move or resize puts one, and what
 * retyping one saves.
 */
export type StageId = "hook" | "captions" | `cue:${string}` | `text:${string}` | `shape:${string}` | `overlay:${string}` | `picture:${number}`;

// What is picked on the stage by its id: all but the picture behind, which says itself (PictureTarget).
export type PickedOnStage = Exclude<StageId, `picture:${number}`>;

/**
 * The picture under the playhead as an editor holds it: whether its Segment is picked, what picks it
 * (with `toggle`, added to the Pick or taken out), its Transform as saved (null: none to set on the
 * stage, an automatic Scene's, only outlined), its Grips (all, or only its corners), and where a
 * gesture puts it, once, as one `group`. With `crop` and `onCrop`, it has Crop mode: its Crop as
 * saved, and where Crop mode leaves it with the Transform that keeps the kept part in place,
 * together as one `group`.
 */
export interface PictureTarget {
  picked: boolean;
  onPick: (toggle: boolean) => void;
  transform: Transform | null;
  grips?: GripSet;
  onTransform: (transform: Transform, group: string) => void;
  crop?: Crop | null;
  onCrop?: (crop: Crop, transform: Transform, group: string) => void;
}

export interface StageControls {
  selected: PickedOnStage[];
  onSelect: (id: PickedOnStage, toggle: boolean) => void;
  // Moved to (x, y) in output pixels: the middle of a caption line, the middle and the top of the
  // hook; and resized to `size` (null: kept). Each gesture is one `group` of changes.
  onPlace: (id: "hook" | "captions", place: Place, group: string) => void;
  // With it, each Cue is picked, moved and resized on its own ("cue:<media>@<at>": cueStageId),
  // unless the captions are picked: where a move or resize (from its size as shown) puts it.
  cues?: { onPlace: (key: CueKey, place: Place, group: string) => void };
  // With it, a double-click (or Enter) retypes the hook, its Kicker, a caption line or a Text Layer.
  retype?: Retype;
  // The Text Layers (their Track unlocked), pictures with corners and a rotate handle: each one's
  // Transform as shown at `time` (a keyed one's at the playhead, as an Overlay's), and where a
  // gesture made from it there puts it, once, as one `group`.
  texts?: {
    transformOf: (id: string, time: number) => Transform | undefined;
    onTransform: (id: string, transform: Transform, group: string, time: number) => void;
    // Its box's wrap width or fixed height set by the box Grip on `edge` (`length`, its own pixels).
    onBox?: (id: string, edge: BoxEdge, length: number, group: string) => void;
  };
  // The Shapes (their Track unlocked), pictures with corners and a rotate handle as a Text Layer's
  // are: each one's Transform as shown at `time`, and where a gesture made from it there puts it.
  // With `onResize`, its edges (a line's or an arrow's ends) set its box (`box`, its Shape Style's
  // width and height, or a line's length, in its own pixels) with the Transform that keeps its other
  // edge or end in place.
  shapes?: {
    transformOf: (id: string, time: number) => Transform | undefined;
    onTransform: (id: string, transform: Transform, group: string, time: number) => void;
    onResize?: (id: string, box: Size, transform: Transform, group: string, time: number) => void;
  };
  // The hook or the captions held where they are: not moved, resized or retyped (their Track locked).
  fixed?: ("hook" | "captions")[];
  // The Overlays (their Track unlocked): each one's Transform as shown at `time` (a keyed one's at
  // the playhead), and where a gesture made from it there puts it; with `cropOf` and `onCrop`, its
  // Crop and where Crop mode leaves it (with its Transform).
  overlays?: {
    transformOf: (id: string, time: number) => Transform | undefined;
    onTransform: (id: string, transform: Transform, group: string, time: number) => void;
    cropOf?: (id: string) => Crop | undefined;
    onCrop?: (id: string, crop: Crop, transform: Transform, group: string) => void;
  };
  // The picture of the plan's Segment `segment`, Scene `scene` (those under the playhead): null when
  // it can't be picked on the stage (its Track locked, or the plan not yet of the edits).
  pictureAt?: (segment: number, scene: number) => PictureTarget | null;
  // Counted up to open Crop mode on the picture picked alone (the inspector's Crop).
  cropAsked?: number;
  // What the stage takes dropped on it (DataTransfer `types`), and where it was dropped, in output pixels.
  drop?: { types: string[]; onDrop: (data: DataTransfer, at: { x: number; y: number }) => void };
}

// The sizes the hook and the captions can be set to (styles.py).
const HOOK_SIZES = { min: 40, max: 160 };
const CAPTION_SIZES = { min: 40, max: 200 };
// Around a caption line's letters, what can be grabbed of it, in output pixels.
const CAPTION_GRAB_PAD = 12;
// The hook stays between the safe area's top and bottom, and a caption line's middle stays half its
// area's height (100, planner.py's LOWER_CAPTIONS) inside them (_caption_area).
const CAPTION_CENTRES: [number, number] = [SAFE_TOP + 100, SAFE_BOTTOM - 100];

/**
 * What of the plan `controls` can move on the stage, in the order they are drawn. With `edit`, each
 * can be retyped: the caption line on screen at `now()`, and the Kicker where it is double-clicked.
 */
function stageItems(
  plan: RenderPlan,
  fontById: Map<string, FontInfo>,
  controls: StageControls,
  edit: ((editing: Editing) => void) | undefined,
  now: () => number,
): StageItem[] {
  const items: StageItem[] = [];
  const middle = (area: Box) => ({ x: Math.round(area.x + area.width / 2), y: Math.round(area.y + area.height / 2) });
  const captionFont = fontById.get(plan.caption_style.font);
  const cues = controls.cues;
  if (plan.captions.length && captionFont && !controls.fixed?.includes("captions") && cues && !controls.selected.includes("captions")) {
    // Each Cue on its own: its entries either side of a Layout change are one.
    const style = plan.caption_style;
    const ids = plan.captions.map((cue) => cueStageId(cue.key));
    plan.captions.forEach((cue, index) => {
      if (index > 0 && ids[index - 1] === ids[index]) return;
      // Resized from its size as shown, which a line too wide for its area holds back as it grows.
      const set = cue.size;
      items.push({
        id: ids[index],
        label: `Caption: ${cue.plain.join(" ")}`,
        shows: plan.captions.flatMap((other, i) => (ids[i] === ids[index] ? [{ start: other.start, end: other.end, area: captionGrab(other, captionFont, style) }] : [])),
        size: { now: set, min: Math.min(set, style.size * CUE_MIN_SCALE), max: Math.max(set, style.size * CUE_MAX_SCALE) },
        centreY: CAPTION_CENTRES,
        onPlace: (area, size, group) => cues.onPlace(cue.key, { ...middle(area), size }, group),
        onEdit:
          edit &&
          (() => {
            const shown = plan.captions.findIndex((other, i) => ids[i] === ids[index] && other.start <= now() && now() < other.end);
            edit({ kind: "captions", line: shown === -1 ? index : shown });
          }),
      });
    });
  } else if (plan.captions.length && captionFont && !controls.fixed?.includes("captions")) {
    const style = plan.caption_style;
    items.push({
      id: "captions",
      label: "Captions (every line moves together)",
      shows: plan.captions.map((cue) => ({ start: cue.start, end: cue.end, area: captionGrab(cue, captionFont, style) })),
      size: { now: style.size, ...CAPTION_SIZES },
      centreY: CAPTION_CENTRES,
      onPlace: (area, size, group) => controls.onPlace("captions", { ...middle(area), size }, group),
      onEdit:
        edit &&
        (() => {
          const line = plan.captions.findIndex((cue) => cue.start <= now() && now() < cue.end);
          if (line !== -1) edit({ kind: "captions", line });
        }),
    });
  }
  if (plan.hook && !controls.fixed?.includes("hook")) {
    const hook = plan.hook;
    items.push({
      id: "hook",
      label: "Hook",
      shows: [{ start: hook.start, end: hook.end, area: hook.area }],
      size: { now: plan.hook_style.size, ...HOOK_SIZES },
      centreY: [SAFE_TOP + hook.area.height / 2, SAFE_BOTTOM - hook.area.height / 2],
      onPlace: (area, size, group) => controls.onPlace("hook", { x: middle(area).x, y: Math.round(area.y), size }, group),
      onEdit:
        edit &&
        ((point) => {
          const pill = hook.kicker?.box;
          const onPill = point && pill && point.x >= pill.x && point.x < pill.x + pill.width && point.y >= pill.y && point.y < pill.y + pill.height;
          edit(onPill ? { kind: "kicker" } : { kind: "hook" });
        }),
    });
  }
  return items;
}

// What can be grabbed of a Cue: its lines' letters (and outline and tracking) as set, padded, around its middle.
function captionGrab(cue: Cue, font: FontInfo, style: CaptionStyle): Box {
  let width = cue.area.width;
  if (measure) {
    measure.font = `${cssFontSize(font, cue.size)}px "${fontFamily(font.id)}"`;
    const lines = cue.lines.map((line) => line.map((word) => word.text).join(" "));
    const letters = Math.max(...lines.map((line) => trackedWidth(line, (text) => measure.measureText(text).width, style.tracking)));
    width = Math.min(letters + 2 * style.outline + 2 * CAPTION_GRAB_PAD, cue.area.width);
  }
  const height = cue.lines.length * cue.size + 2 * CAPTION_GRAB_PAD;
  const { x, y } = { x: cue.area.x + cue.area.width / 2, y: cue.area.y + cue.area.height / 2 };
  return { x: Math.round(x - width / 2), y: Math.round(y - height / 2), width: Math.round(width), height: Math.round(height) };
}

/**
 * A picture layer (a Text Layer, a Shape) while it is on screen: the picture the backend made of it
 * (docs/adr/0010), the same pixels the Clip burns, placed, scaled, turned and faded as its plan's
 * `picture` says (or as the stage holds it: `heldLayerEvent`), and animated on and off as the hook
 * is, on top of its Keyframes (`placedLayer`). While a changed look's picture loads, the last one
 * stays. A `still` one (picked in the Advanced Edit) is shown whole while paused in its time, so that
 * it can be seen while it is edited, even on a frame its animation hasn't reached.
 *
 * A keyed one (ADR 0008) moves with the playback as PicturePanel moves a keyed picture: on every
 * frame of its clock it is sampled at the time shown and written to its elements directly.
 */
function PictureLayerView({ event, jobId, playback, still = false }: { event: PictureLayerEvent; jobId: string; playback: Playback; still?: boolean }) {
  const shown = useLayerPicture(wantedPicture(jobId, event));
  const key = useShown(playback, (time, p) => layerLook(event, still, time, p)?.map((value) => value.toFixed(3)).join(" ") ?? null);
  const group = useRef<SVGGElement>(null);
  const image = useRef<SVGImageElement>(null);
  const moving = isKeyed(event.picture);

  useLayoutEffect(() => {
    if (!moving) return;
    const paint = () => {
      const time = playback.shownTime;
      const look = layerLook(event, still, time, playback);
      if (!look || !group.current || !image.current) return;
      const placed = placedLayer(event.picture, time, look);
      group.current.setAttribute("opacity", String(placed.opacity));
      for (const [name, value] of Object.entries(layerBox(placed))) image.current.setAttribute(name, String(value));
    };
    paint();
    return playback.subscribe(paint);
  }, [moving, event, still, playback]);

  if (!key || !shown) return null;
  const placed = placedLayer(event.picture, playback.shownTime, key.split(" ").map(Number) as [number, number, number]);
  return (
    <g ref={group} opacity={placed.opacity}>
      <image ref={image} href={shown.url} preserveAspectRatio="none" {...layerBox(placed)} />
    </g>
  );
}

// A picture layer's opacity, scale and drop at `time` (hookLook): whole while paused in its time when
// `still`; null while it is off screen.
function layerLook(event: PictureLayerEvent, still: boolean, time: number, playback: Playback): [number, number, number] | null {
  if (still && !playback.playing && event.start <= time && time < event.end) return [1, 1, 0];
  return hookLook(time, event, event.layer, 0);
}

// The SVG <image> attributes that draw a picture layer's picture where it is `placed`.
const layerBox = (placed: PlacedLayer) => ({
  x: placed.x - placed.width / 2,
  y: placed.y - placed.height / 2,
  width: placed.width,
  height: placed.height,
  transform: `rotate(${placed.rotation} ${placed.x} ${placed.y})`,
});

const boxKey = (box: Box) => `${box.x},${box.y},${box.width},${box.height}`;

/** The Watermark, under the captions and the hook: the Logo filling its area, or its text centred in it. */
function Watermark({ plan, event, font }: { plan: RenderPlan; event: WatermarkEvent; font: FontInfo | undefined }) {
  const { area } = event;
  if (event.kind === "logo" && event.logo) {
    return (
      <image
        href={logoUrl(event.logo)}
        x={area.x}
        y={area.y}
        width={area.width}
        height={area.height}
        opacity={event.opacity}
        preserveAspectRatio="none"
      />
    );
  }
  if (!font) return null;
  const style = plan.watermark_style;
  // As the renderer's: centred on its position, with an outline of a twentieth of its size.
  const baseline = area.y + area.height / 2 - event.size / 2 + (font.ascent / font.units) * event.size;
  const outline = style.outline ? Math.max(1, Math.round(style.size / 20)) : 0;
  return (
    <text
      x={area.x + area.width / 2}
      y={baseline}
      textAnchor="middle"
      fontFamily={fontFamily(font.id)}
      fontSize={cssFontSize(font, event.size)}
      fill={style.colour}
      stroke={outline ? "#000000" : undefined}
      strokeWidth={2 * outline}
      strokeLinejoin="round"
      paintOrder="stroke"
      opacity={event.opacity}
      style={{ whiteSpace: "pre" }}
    >
      {event.text}
    </text>
  );
}

/**
 * One panel slot: its <video>, always mounted (so that it keeps playing across Scenes), shown in the
 * current Scene's panel for the slot (hidden when the Scene has none), cropped at the path's point;
 * or, in a Manual Scene (`slotView`), its picture placed as PicturePanel places one, or its
 * Background's colour. A `hidden` one (its deck parked) is still drawn, transparent, so that its
 * frame is ready. A keyed Manual picture (ADR 0008) moves as PicturePanel moves one: sampled at the
 * time shown on every frame of the playback's clock, its box and opacity written to it directly.
 */
export function PanelView({
  videoRef,
  src,
  plan,
  panel,
  picture = null,
  colour = null,
  playback,
  muted,
  hidden = false,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  src: string;
  plan: RenderPlan | null;
  panel: Panel | null;
  picture?: Picture | null;
  colour?: string | null;
  playback: Playback;
  muted: boolean;
  hidden?: boolean;
}) {
  const pointIndex = useShown(playback, (time) => {
    if (!panel) return 0;
    let index = 0;
    while (index + 1 < panel.path.length && panel.path[index + 1].at <= time) index += 1;
    return index;
  });
  const parked = hidden ? { opacity: 0 } : {};
  const boxRef = useRef<HTMLDivElement>(null);
  const layerRef = useRef<HTMLDivElement>(null);
  const moving = plan && picture && isKeyed(picture) ? picture : null;
  useLayoutEffect(() => {
    if (!moving || !plan) return;
    const paint = () => {
      const { left, top, width, height, transform, opacity } = pictureStyle(pictureAt(moving, playback.shownTime), plan);
      if (boxRef.current) Object.assign(boxRef.current.style, { left, top, width, height, transform });
      if (layerRef.current) layerRef.current.style.opacity = String(opacity);
    };
    paint();
    return playback.subscribe(paint);
  }, [moving, plan, playback]);
  if (plan && picture) {
    const { inner, opacity, transform, left, top, width, height } = pictureStyle(moving ? pictureAt(moving, playback.shownTime) : picture, plan);
    return (
      <SlotVideo
        videoRef={videoRef}
        src={src}
        muted={muted}
        box={{ left, top, width, height, transform, ...parked }}
        layer={{ overflow: "hidden", opacity }}
        video={inner}
        boxRef={boxRef}
        layerRef={layerRef}
      />
    );
  }
  const point = panel?.path[Math.min(pointIndex, panel.path.length - 1)];
  const whole: CSSProperties = { inset: 0, width: "100%", height: "100%" };
  if (!plan || !panel || !point) {
    // A colour shows where the video doesn't.
    const box: CSSProperties = colour ? { inset: 0, background: colour } : { inset: 0, visibility: "hidden" };
    return <SlotVideo videoRef={videoRef} src={src} muted={muted} box={{ ...box, ...parked }} video={colour ? { ...whole, visibility: "hidden" } : whole} />;
  }
  const box: CSSProperties = {
    left: percent(panel.area.x / plan.width),
    top: percent(panel.area.y / plan.height),
    width: percent(panel.area.width / plan.width),
    height: percent(panel.area.height / plan.height),
    overflow: "hidden",
  };
  const video: CSSProperties = {
    left: percent(-point.x / panel.crop_width),
    top: percent(-point.y / panel.crop_height),
    width: percent(plan.source_width / panel.crop_width),
    height: percent(plan.source_height / panel.crop_height),
    filter: panel.blur ? `blur(calc(${BLUR_SIGMA}px * var(--scale))) brightness(${BLUR_BRIGHTNESS})` : undefined,
  };
  return <SlotVideo videoRef={videoRef} src={src} muted={muted} box={{ ...box, ...parked }} video={video} />;
}

/**
 * A slot's video in its `box`, inside a `layer` (a picture's: clipped to it, at its opacity), as
 * `video` sizes and moves it: always the same elements, so that the video plays on whatever its
 * slot shows.
 */
function SlotVideo({
  videoRef,
  src,
  muted,
  box,
  layer,
  video,
  boxRef,
  layerRef,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  src: string;
  muted: boolean;
  box: CSSProperties;
  layer?: CSSProperties;
  video: CSSProperties;
  boxRef?: React.RefObject<HTMLDivElement>;
  layerRef?: React.RefObject<HTMLDivElement>;
}) {
  return (
    <div ref={boxRef} className="absolute" style={box}>
      <div ref={layerRef} className="absolute inset-0" style={layer}>
        <video ref={videoRef} src={src} muted={muted} playsInline preload="auto" className="absolute max-w-none object-fill" style={video} />
      </div>
    </div>
  );
}

/**
 * The Cue on screen, with its spoken Word highlighted as the Caption Style says, moved while it is.
 */
function Captions({ plan, font, playback, edit }: { plan: RenderPlan; font: FontInfo | undefined; playback: Playback; edit: StageEdit }) {
  const key = useShown(playback, (time) => {
    const index = plan.captions.findIndex((cue) => cue.start <= time && time < cue.end);
    if (index === -1) return "";
    const word = cueWords(plan.captions[index]).findIndex((w) => w.start <= time && time < w.end);
    return `${index}:${word}`;
  });
  if (!key || !font) return null;
  const [index, word] = key.split(":").map(Number);
  const cue = plan.captions[index];
  return (
    <g transform={edit.transform(cueStageId(cue.key), cue.area) ?? edit.transform("captions", cue.area)}>
      <CaptionLines cue={cue} active={word} plan={plan} font={font} />
    </g>
  );
}

/** A Cue's lines, one under another, its Word `active` (counted across them) highlighted. */
function CaptionLines({ cue, active, plan, font }: { cue: Cue; active: number; plan: RenderPlan; font: FontInfo }) {
  const [row, index] = cueWordAt(cue, active);
  return cue.lines.map((_, i) => (
    <CaptionLine key={i} cue={cue} row={i} active={i === row ? index : -1} plan={plan} font={font} />
  ));
}

function CaptionLine({ cue, row, active, plan, font }: { cue: Cue; row: number; active: number; plan: RenderPlan; font: FontInfo }) {
  const style = plan.caption_style;
  const { area, size } = cue;
  const centreX = area.x + area.width / 2;
  // libass centres each line's ascent-plus-descent box, which is the font size, on its middle.
  const baseline = cueLineMiddle(cue, row) - size / 2 + (font.ascent / font.units) * size;
  const fontSize = cssFontSize(font, size);
  const family = fontFamily(font.id);
  const words = cue.lines[row].map((word) => word.text);
  const tspans = (colours: boolean) =>
    words.map((text, i) => (
      <tspan key={i} fill={colours && i === active && style.highlight === "colour" ? style.active_colour : undefined}>
        {i < words.length - 1 ? `${text} ` : text}
      </tspan>
    ));
  const text = (props: React.SVGProps<SVGTextElement>, colours: boolean) => (
    <text
      x={trackedX(centreX, style.tracking)}
      y={baseline}
      textAnchor="middle"
      fontFamily={family}
      fontSize={fontSize}
      letterSpacing={style.tracking || undefined}
      strokeLinejoin="round"
      paintOrder="stroke"
      style={{ whiteSpace: "pre" }}
      {...props}
    >
      {tspans(colours)}
    </text>
  );
  const outline = style.outline > 0 ? { stroke: style.outline_colour, strokeWidth: 2 * style.outline } : {};
  const shadow = style.shadow.colour;
  return (
    <g>
      {style.highlight === "box" && active >= 0 && (
        <HighlightBox words={words} active={active} centreX={centreX} baseline={baseline} size={size} font={font} style={style} />
      )}
      <Shadow shadow={style.shadow}>{text({ fill: shadow, stroke: style.outline > 0 ? shadow : undefined, strokeWidth: 2 * style.outline }, false)}</Shadow>
      {text({ fill: style.colour, ...outline }, true)}
    </g>
  );
}

/**
 * A line's drop `shadow` under it, as the renderer draws it: `children` (the line in the shadow's
 * colour, its stroke too) moved, faded and blurred. Nothing when it is off.
 */
function Shadow({ shadow, children }: { shadow: DropShadow; children: ReactNode }) {
  const id = `shadow${useId().replace(/[^\w-]/g, "")}`;
  const drawn = drawnShadow(shadow);
  if (!drawn) return null;
  return (
    <g transform={`translate(${drawn.x} ${drawn.y})`} opacity={drawn.opacity} filter={drawn.sigma ? `url(#${id})` : undefined}>
      {drawn.sigma > 0 && (
        // Over the whole frame, wherever the line is.
        <filter id={id} filterUnits="userSpaceOnUse" x={-1080} y={-1920} width={3 * 1080} height={3 * 1920}>
          <feGaussianBlur stdDeviation={drawn.sigma} />
        </filter>
      )}
      {children}
    </g>
  );
}

const measure = document.createElement("canvas").getContext("2d");

/** The box of the active colour behind the spoken Word, as the renderer draws it (_highlight_box). */
function HighlightBox({
  words,
  active,
  centreX,
  baseline,
  size,
  font,
  style,
}: {
  words: string[];
  active: number;
  centreX: number;
  baseline: number;
  size: number;
  font: FontInfo;
  style: CaptionStyle;
}) {
  if (!measure) return null;
  measure.font = `${cssFontSize(font, size)}px "${fontFamily(font.id)}"`;
  const { before, word, line } = wordSpan(words, active, (text) => measure.measureText(text).width, style.tracking);
  const { padX, padY, radius } = highlightShape(style, size);
  const cap = (font.cap_height / font.units) * size;
  const height = cap + 2 * padY;
  return (
    <rect
      x={centreX - line / 2 + before - padX}
      y={baseline - cap - padY}
      width={word + 2 * padX}
      height={height}
      rx={Math.min(Math.round(radius), Math.floor(height / 2))}
      fill={style.active_colour}
    />
  );
}

// How long after each other the `steps` + 1 elements of a staggered entrance come on (renderer.py's
// _stagger), each entrance and exit taking hookEnds' time.
function stagger(hook: HookEvent, style: HookStyle, steps: number): number {
  if (style.animation_in === "none" || !steps) return 0;
  const [on, off] = hookEnds(hook, style);
  return Math.max(0, Math.min(HOOK_STAGGER_SECS, (hook.end - hook.start - on - off) / steps));
}

/**
 * The hook's boxes, lines, Kicker and Quote Mark while it is on screen, animated on and off as its
 * style says: the Kicker first, then the lines one by one (each strip with its line, a block and the
 * Quote Mark with the first); moved by `moving` while it is. A `still` one (selected) is shown whole
 * while paused in its time, as a selected Text Layer is.
 */
function Hook({
  plan,
  hook,
  font,
  playback,
  moving,
  still = false,
}: {
  plan: RenderPlan;
  hook: HookEvent;
  font: FontInfo | undefined;
  playback: Playback;
  moving: string | undefined;
  still?: boolean;
}) {
  const style = plan.hook_style;
  const first = hook.kicker ? 1 : 0;
  const steps = first + hook.lines.length - 1;
  const step = stagger(hook, style, steps);
  const key = useShown(playback, (time, p) => {
    if (still && !p.playing && hook.start <= time && time < hook.end) return Array.from({ length: steps + 1 }, () => "1 1 0").join("|");
    const looks = Array.from({ length: steps + 1 }, (_, rank) => hookLook(time, hook, style, rank * step));
    if (looks.every((look) => look === null)) return null;
    return looks.map((look) => (look ?? [0, 1, 0]).map((value) => value.toFixed(3)).join(" ")).join("|");
  });
  if (!key || !font) return null;
  const looks = key.split("|").map((look) => look.split(" ").map(Number));
  // An element at `rank`: faded and moved as a whole, and grown from its own centre, as libass scales it.
  const moved = (rank: number, children: React.ReactNode, key?: number) => {
    const [opacity, , below] = looks[rank];
    return (
      <g key={key} opacity={opacity} transform={below ? `translate(0 ${below})` : undefined}>
        {children}
      </g>
    );
  };
  const grown = (rank: number) => {
    const scale = looks[rank][1];
    return scale === 1 ? undefined : { transform: `scale(${scale})`, transformBox: "fill-box" as const, transformOrigin: "center" };
  };
  // Line `i` in `fill`, its emphasised runs in `emphasis`.
  const text = (i: number, fill: string, emphasis: string, props: React.SVGProps<SVGTextElement>) => {
    const [x, baseline] = hook.anchors[i];
    return (
      <text
        x={trackedX(x, style.tracking)}
        y={baseline}
        textAnchor="middle"
        fontFamily={fontFamily(font.id)}
        fontSize={cssFontSize(font, hook.size)}
        letterSpacing={style.tracking || undefined}
        fill={fill}
        strokeLinejoin="round"
        paintOrder="stroke"
        style={{ whiteSpace: "pre", ...grown(first + i) }}
        {...props}
      >
        {runs(hook.lines[i], hook.emphasis[i]).map(([part, emphasised], j) => (
          <tspan key={j} fill={emphasised ? emphasis : undefined}>
            {part}
          </tspan>
        ))}
      </text>
    );
  };
  const outline = style.outline > 0 ? { stroke: style.outline_colour, strokeWidth: 2 * style.outline } : {};
  const strips = hook.boxes.length > 1;
  const kicker = hook.kicker;
  const quote = hook.quote;
  return (
    <g transform={moving}>
      {style.box_opacity > 0 &&
        hook.boxes.map((box, i) =>
          moved(
            strips ? first + i : first,
            <rect
              x={box.x}
              y={box.y}
              width={box.width}
              height={box.height}
              rx={Math.min(style.radius, Math.floor(box.height / 2))}
              fill={style.box_colour}
              fillOpacity={style.box_opacity}
              style={grown(strips ? first + i : first)}
            />,
            i,
          ),
        )}
      {kicker &&
        moved(
          0,
          <>
            <rect
              x={kicker.box.x}
              y={kicker.box.y}
              width={kicker.box.width}
              height={kicker.box.height}
              rx={Math.floor(kicker.box.height / 2)}
              fill={style.kicker_box_colour}
              style={grown(0)}
            />
            <text
              x={kicker.anchor[0]}
              y={kicker.anchor[1]}
              textAnchor="middle"
              fontFamily={fontFamily(font.id)}
              fontSize={cssFontSize(font, kicker.size)}
              fill={style.kicker_colour}
              style={{ whiteSpace: "pre", ...grown(0) }}
            >
              {kicker.text}
            </text>
          </>,
        )}
      {hook.lines.map((_, i) =>
        moved(
          first + i,
          <>
            <Shadow shadow={style.shadow}>
              {text(i, style.shadow.colour, style.shadow.colour, {
                stroke: style.outline > 0 ? style.shadow.colour : undefined,
                strokeWidth: 2 * style.outline,
              })}
            </Shadow>
            {text(i, style.colour, style.emphasis_colour, outline)}
          </>,
          i,
        ),
      )}
      {quote &&
        moved(
          first,
          // Grows from its corner, as the renderer places it.
          <g transform={`translate(${quote.x} ${quote.y})${looks[first][1] === 1 ? "" : ` scale(${looks[first][1]})`}`}>
            <rect width={quote.width} height={quote.height} rx={Math.round(QUOTE_RADIUS * quote.width)} fill={style.quote_colour} />
            <path d={quoteMarks(quote.width)} fill="#FFFFFF" />
          </g>,
        )}
    </g>
  );
}

// The Quote Mark's two marks as an SVG path, on a badge `width` wide.
function quoteMarks(width: number): string {
  const scale = width / 100;
  const r = QUOTE_DOT_RADIUS;
  const c = 0.5523 * r;
  const at = (x: number, y: number) => `${(x * scale).toFixed(1)} ${(y * scale).toFixed(1)}`;
  return QUOTE_DOTS.map(
    ([x, y]) =>
      `M ${at(x + r, y)} C ${at(x + r, y + c)} ${at(x + c, y + r)} ${at(x, y + r)} ` +
      `C ${at(x - c, y + r)} ${at(x - r, y + c)} ${at(x - r, y)} C ${at(x - r, y - c)} ${at(x - c, y - r)} ${at(x, y - r)} ` +
      `C ${at(x + c, y - r)} ${at(x + r, y - c)} ${at(x + r, y)} Z ` +
      `M ${at(x - r, y)} C ${at(x - r, y - 1.5 * r)} ${at(x - 0.4 * r, y - 2.3 * r)} ${at(x + 0.8 * r, y - 2.6 * r)} ` +
      `L ${at(x + 0.8 * r, y - 1.9 * r)} C ${at(x + 0.1 * r, y - 1.7 * r)} ${at(x - 0.1 * r, y - 1.3 * r)} ${at(x - 0.1 * r, y - r)} Z`,
  ).join(" ");
}

// A line cut into its plain and emphasised parts. The spans count characters as Python does (code
// points), not UTF-16 units.
function runs(line: string, spans: [number, number][]): [string, boolean][] {
  const chars = Array.from(line);
  const parts: [string, boolean][] = [];
  let at = 0;
  for (const [start, end] of spans) {
    if (start > at) parts.push([chars.slice(at, start).join(""), false]);
    parts.push([chars.slice(start, end).join(""), true]);
    at = end;
  }
  if (at < chars.length) parts.push([chars.slice(at).join(""), false]);
  return parts;
}

/** Loop on or off, and what turns it over. */
export interface LoopControl {
  on: boolean;
  onToggle: () => void;
}

/**
 * Play and pause, a scrubber over the Clip, the time, with `rates` the playback rate, with `loop` the
 * loop button, and `tools`, and "Play clip" and "Play ending" (not when `compact`). While `hidden`,
 * faded out, but shown again for the keyboard's focus.
 */
function Transport({
  playback,
  compact = false,
  rates = false,
  tools,
  hidden = false,
  loop,
  onPlay,
}: {
  playback: Playback;
  compact?: boolean;
  rates?: boolean;
  tools?: ReactNode;
  hidden?: boolean;
  loop?: LoopControl;
  onPlay?: () => void;
}) {
  const playing = usePlayback(playback, (_, p) => p.playing);
  // Tenths of a second: enough for the label and the scrubber, and few re-renders.
  const tenths = usePlayback(playback, (time) => Math.round(time * 10));
  const duration = playback.duration;
  return (
    <div
      className={cx(
        "flex flex-col gap-2 motion-safe:transition-opacity motion-safe:duration-300",
        hidden && "not-has-focus-visible:pointer-events-none not-has-focus-visible:opacity-0",
      )}
    >
      {/* Compact on a phone (closer together, the time over the Clip's length) to fit 375 px. */}
      <div className={cx("flex items-center gap-3", compact && "max-sm:gap-2")}>
        <Button variant="secondary" size="icon" onClick={() => (onPlay ? onPlay() : playback.toggle())} aria-label={playing ? "Pause" : "Play"}>
          {playing ? <Pause aria-hidden size={18} /> : <Play aria-hidden size={18} />}
        </Button>
        <input
          type="range"
          min={0}
          max={Math.max(duration, 0.1)}
          step={0.1}
          value={Math.min(tenths / 10, duration)}
          onChange={(event) => playback.seek(Number(event.target.value))}
          aria-label="Position in the clip"
          // The Advanced Edit's ← and → step frames here too, rather than its own 0.1 s steps.
          data-shortcuts
          className="min-w-0 flex-1 accent-accent"
        />
        <span className={cx("shrink-0 text-sm text-muted tabular-nums", compact && "max-sm:flex max-sm:flex-col max-sm:items-end max-sm:text-xs")}>
          {formatPrecise(Math.max(0, tenths / 10))}
          <span className={cx(compact && "max-sm:sr-only")}> / </span>
          {formatPrecise(duration)}
        </span>
        {loop && (
          <Button
            variant="ghost"
            size="icon"
            onClick={loop.onToggle}
            aria-pressed={loop.on}
            aria-label="Loop"
            aria-keyshortcuts="L"
            title={loop.on ? "Loop on (L): playing repeats from In to Out" : "Loop (L): repeat from In to Out, or with no marks, the whole Clip"}
            className="aria-pressed:text-accent-text"
          >
            <Repeat aria-hidden size={18} />
          </Button>
        )}
        {rates && <RateMenu playback={playback} />}
        {tools}
      </div>
      {!compact && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" size="sm" onClick={() => playback.play(0)}>
            <Play aria-hidden size={16} />
            Play clip
          </Button>
          <Button size="sm" onClick={() => playback.play(Math.max(0, duration - ENDING_SECS))}>
            <SkipForward aria-hidden size={16} />
            Play ending
          </Button>
        </div>
      )}
    </div>
  );
}

// The playback rate, picked from RATES; marked in the accent whenever it isn't 1×, so that a fast
// preview isn't taken for a fast Clip.
function RateMenu({ playback }: { playback: Playback }) {
  const rate = usePlayback(playback, (_, p) => p.rate);
  return (
    <select
      value={rate}
      // Let go once a rate is picked, so that Space plays; the Advanced Edit's keys go on meanwhile.
      onChange={(event) => {
        playback.setRate(Number(event.target.value));
        event.currentTarget.blur();
      }}
      aria-label="Playback rate"
      data-shortcuts
      className={cx(
        "min-h-9 shrink-0 cursor-pointer appearance-none rounded-[10px] px-2 text-center text-sm font-medium tabular-nums hover:bg-fill",
        rate === 1 ? "text-muted hover:text-text" : "text-accent-text",
      )}
    >
      {RATES.map((each) => (
        <option key={each} value={each}>
          {each}×
        </option>
      ))}
    </select>
  );
}
