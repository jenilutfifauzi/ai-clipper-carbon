import { Pause, Play, SkipForward } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent } from "react";
import {
  logoUrl,
  type Box,
  type CaptionEvent,
  type FontInfo,
  type HookEvent,
  type HookStyle,
  type Panel,
  type PreviewPlan,
  type RenderPlan,
  type TextEvent,
  type WatermarkEvent,
} from "../../../api";
import { Button } from "../../../components/Button";
import { cssFontSize, fontFamily } from "../../../fonts";
import { cx, formatPrecise } from "../../../format";
import { usePlayback, type Playback } from "./playback";
import { PreviewMusic } from "./PreviewMusic";

// The planner's and renderer's numbers the drawing repeats (backend/app/planner.py, renderer.py):
// how far a sliding hook moves; the highlight box's padding and corners, in sizes of the line's font;
// and Blur's background, blurred with a sigma of 10 shrunk pixels at a quarter size, and darkened.
const SLIDE_PX = 60;
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
const HIGHLIGHT_PAD_X = 0.12;
const HIGHLIGHT_PAD_Y = 0.08;
const HIGHLIGHT_RADIUS = 0.12;
const BLUR_SIGMA = 40;
const BLUR_BRIGHTNESS = 0.9;
// How far an arrow key nudges the Watermark, in output pixels (with Shift, five times as far).
const NUDGE_PX = 8;
// A Text Layer's box has corners this many of its sizes round (planner.py's TEXT_RADIUS).
const TEXT_RADIUS = 0.25;
// How much of the ending "Play ending" plays.
const ENDING_SECS = 3;
// A follower video further than this from the master is moved back in step.
const MAX_DRIFT_SECS = 0.12;

const percent = (value: number) => `${value * 100}%`;

/**
 * The Candidate as its Clip will look: the Source framed by the Preview Plan's Scenes (each panel a
 * crop of the video, following its path), with the plan's caption lines and hook drawn over it
 * where, when and how large the render will draw them. Drawn in the output's 1080x1920 pixels and
 * scaled to fit. Two videos play the Source in step, one per panel (Split's two, or Blur's
 * background and shot); the first is the master, which `playback` drives and which is heard.
 * With `onWatermarkMove`, the Watermark can be dragged (or nudged with the arrow keys) to a new
 * centre, in output pixels. With `texts` (the Advanced Edit), a Text Layer on screen is selected by a
 * click and dragged to a new centre. With `fit`, the frame is as large as fits the space its parent
 * gives it (the Advanced Edit's player), and the transport is a single row.
 */
export function ClipPreview({
  src,
  preview,
  fonts,
  playback,
  onWatermarkMove,
  texts,
  fit = false,
}: {
  src: string;
  preview: PreviewPlan | null;
  fonts: FontInfo[] | null;
  playback: Playback;
  onWatermarkMove?: (x: number, y: number) => void;
  texts?: TextControls;
  fit?: boolean;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const room = useRef<HTMLDivElement>(null);
  const master = useRef<HTMLVideoElement>(null);
  const follower = useRef<HTMLVideoElement>(null);
  const [scale, setScale] = useState(1 / 3);
  const fitted = useFittedSize(room, fit);
  const plan = preview?.plan ?? null;

  useEffect(() => {
    playback.attach(master.current);
    return () => playback.attach(null);
  }, [playback]);

  // The follower video plays, pauses and seeks with the master.
  useEffect(() => {
    const lead = master.current;
    const other = follower.current;
    if (!lead || !other) return;
    const follow = () => {
      if (Math.abs(other.currentTime - lead.currentTime) > MAX_DRIFT_SECS) other.currentTime = lead.currentTime;
      if (lead.paused !== other.paused) {
        if (lead.paused) other.pause();
        else void other.play().catch(() => {});
      }
    };
    return playback.subscribe(follow);
  }, [playback]);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / 1080));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const sceneIndex = usePlayback(playback, (time) => (plan ? sceneAt(plan, time) : 0));
  const scene = plan?.scenes[sceneIndex];
  const fontById = useMemo(() => new Map((fonts ?? []).map((font) => [font.id, font])), [fonts]);
  const watermark = useWatermarkDrag(plan, stage, onWatermarkMove);
  const textDrag = useTextDrag(plan, stage, texts);

  const frame = (
    <div
      ref={stage}
      className={cx(
        "relative mx-auto overflow-hidden rounded-control bg-black outline-1 -outline-offset-1 outline-white/10",
        fit ? "shrink-0" : "aspect-[9/16] w-full max-w-[22rem]",
      )}
      style={{ "--scale": scale, ...(fit ? { width: fitted.width, height: fitted.height } : {}) } as CSSProperties}
    >
      {[master, follower].map((ref, slot) => (
        <PanelView
          key={slot}
          videoRef={ref}
          src={src}
          plan={plan}
          panel={scene?.panels[slot] ?? null}
          playback={playback}
          muted={slot > 0}
        />
      ))}
      {plan && fonts && (
        <svg viewBox={`0 0 ${plan.width} ${plan.height}`} className="pointer-events-none absolute inset-0 size-full" aria-hidden>
          {watermark.event && <Watermark plan={plan} event={watermark.event} font={fontById.get(plan.watermark_style.font)} />}
          <Captions plan={plan} font={fontById.get(plan.caption_style.font)} playback={playback} />
          {plan.texts.map((event) => (
            <TextLayerView
              key={event.layer.id}
              event={event}
              font={fontById.get(event.layer.font)}
              playback={playback}
              offset={textDrag.offset(event)}
              still={event.layer.id === texts?.selected}
            />
          ))}
          {plan.hook && <Hook plan={plan} hook={plan.hook} font={fontById.get(plan.hook_style.font)} playback={playback} />}
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
      {plan && texts && <TextHandles plan={plan} playback={playback} controls={texts} drag={textDrag} />}
      <PreviewMusic plan={plan} playback={playback} master={master} />
    </div>
  );
  if (fit) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <div ref={room} className="flex min-h-0 flex-1 items-center justify-center">
          {frame}
        </div>
        <Transport playback={playback} compact />
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

/** The Advanced Edit's hold on the Text Layers in the preview: which is selected, and what a click or a drag does. */
export interface TextControls {
  selected: string | null;
  onSelect: (id: string) => void;
  // A drag moved it to centre (x, y), in output pixels; each drag is one `group` of changes.
  onMove: (id: string, x: number, y: number, group: string) => void;
}

let textDrags = 0;

/**
 * Dragging Text Layers on the stage. A dragged one is drawn where it is put until a plan that has it
 * there comes back, as the Watermark is.
 */
function useTextDrag(plan: RenderPlan | null, stage: React.RefObject<HTMLDivElement | null>, controls: TextControls | undefined) {
  const [held, setHeld] = useState<{ id: string; x: number; y: number } | null>(null);
  const drag = useRef<{ id: string; pointer: number; dx: number; dy: number; group: string; moved: boolean } | null>(null);

  // Where the pointer is, in output pixels.
  function at(pointer: PointerEvent): { x: number; y: number } | null {
    const rect = stage.current?.getBoundingClientRect();
    if (!rect || !plan) return null;
    return { x: ((pointer.clientX - rect.left) / rect.width) * plan.width, y: ((pointer.clientY - rect.top) / rect.height) * plan.height };
  }

  const centre = (event: TextEvent) => ({ x: event.area.x + event.area.width / 2, y: event.area.y + event.area.height / 2 });
  // Held until the plan has the Text Layer where it was put.
  const holding = (event: TextEvent) =>
    held && held.id === event.layer.id && (drag.current?.id === held.id || event.layer.x !== held.x || event.layer.y !== held.y);

  function offset(event: TextEvent): [number, number] {
    if (!holding(event) || !held) return [0, 0];
    const now = centre(event);
    return [held.x - now.x, held.y - now.y];
  }

  function handlers(event: TextEvent) {
    return {
      onPointerDown: (pointer: PointerEvent<HTMLDivElement>) => {
        const point = at(pointer);
        if (!point || !controls || pointer.button !== 0) return;
        pointer.preventDefault();
        pointer.currentTarget.setPointerCapture(pointer.pointerId);
        controls.onSelect(event.layer.id);
        const [dx, dy] = offset(event);
        const from = centre(event);
        drag.current = {
          id: event.layer.id,
          pointer: pointer.pointerId,
          dx: from.x + dx - point.x,
          dy: from.y + dy - point.y,
          group: `text-drag:${++textDrags}`,
          moved: false,
        };
      },
      onPointerMove: (pointer: PointerEvent<HTMLDivElement>) => {
        const current = drag.current;
        const point = at(pointer);
        if (!current || pointer.pointerId !== current.pointer || !point || !plan) return;
        current.moved = true;
        const x = Math.round(Math.min(Math.max(point.x + current.dx, 0), plan.width));
        const y = Math.round(Math.min(Math.max(point.y + current.dy, 0), plan.height));
        setHeld({ id: current.id, x, y });
        controls?.onMove(current.id, x, y, current.group);
      },
      onPointerUp: (pointer: PointerEvent<HTMLDivElement>) => {
        if (drag.current?.pointer === pointer.pointerId) drag.current = null;
      },
      onPointerCancel: () => {
        drag.current = null;
        setHeld(null);
      },
    };
  }

  return { offset, handlers };
}

/** A handle over each Text Layer on screen now, to select and drag it; the selected one outlined. */
function TextHandles({
  plan,
  playback,
  controls,
  drag,
}: {
  plan: RenderPlan;
  playback: Playback;
  controls: TextControls;
  drag: ReturnType<typeof useTextDrag>;
}) {
  const shown = usePlayback(playback, (time) =>
    plan.texts
      .filter((event) => event.start <= time && time < event.end)
      .map((event) => event.layer.id)
      .join(" "),
  );
  const on = new Set(shown.split(" "));
  return (
    <>
      {plan.texts
        .filter((event) => on.has(event.layer.id) || event.layer.id === controls.selected)
        .map((event) => {
          const [dx, dy] = drag.offset(event);
          const selected = event.layer.id === controls.selected;
          return (
            <div
              key={event.layer.id}
              role="button"
              tabIndex={-1}
              aria-roledescription="movable text"
              aria-label={`Text: ${event.lines.join(" ")}`}
              aria-pressed={selected}
              {...drag.handlers(event)}
              className={cx(
                "absolute cursor-move touch-none rounded-[4px]",
                selected ? "outline-2 outline-white outline-dashed" : "hover:outline-1 hover:outline-white/70 hover:outline-dashed",
                !on.has(event.layer.id) && "opacity-40",
              )}
              style={{
                left: percent((event.area.x + dx) / plan.width),
                top: percent((event.area.y + dy) / plan.height),
                width: percent(event.area.width / plan.width),
                height: percent(event.area.height / plan.height),
              }}
            />
          );
        })}
    </>
  );
}

/**
 * A Text Layer while it is on screen, animated on and off as the hook is, moved by `offset` while
 * dragged. A `still` one (selected in the Advanced Edit) is shown whole while paused in its time, so
 * that it can be seen while it is edited, even on a frame its animation hasn't reached.
 */
function TextLayerView({
  event,
  font,
  playback,
  offset,
  still = false,
}: {
  event: TextEvent;
  font: FontInfo | undefined;
  playback: Playback;
  offset: [number, number];
  still?: boolean;
}) {
  const layer = event.layer;
  const key = usePlayback(playback, (time, p) => {
    if (still && !p.playing && event.start <= time && time < event.end) return "1 1 0";
    const look = hookLook(time, event, layer, 0);
    return look && look.map((value) => value.toFixed(3)).join(" ");
  });
  if (!key || !font) return null;
  const [opacity, scale, below] = key.split(" ").map(Number);
  const { box, area, size } = event;
  return (
    <g opacity={opacity} transform={`translate(${offset[0]} ${offset[1] + below})`}>
      <g style={scale === 1 ? undefined : { transform: `scale(${scale})`, transformBox: "fill-box", transformOrigin: "center" }}>
        {/* What the scale grows from: the whole area, as libass grows the box and lines from its middle. */}
        <rect x={area.x} y={area.y} width={area.width} height={area.height} fill="none" />
        {box && (
          <rect
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
            rx={Math.min(Math.round(TEXT_RADIUS * size), Math.floor(box.height / 2))}
            fill={layer.box_colour}
            fillOpacity={layer.box_opacity}
          />
        )}
        {event.lines.map((line, i) => (
          <text
            key={i}
            x={event.anchors[i][0]}
            y={event.anchors[i][1]}
            textAnchor="middle"
            fontFamily={fontFamily(font.id)}
            fontSize={cssFontSize(font, size)}
            fill={layer.colour}
            stroke={layer.outline > 0 ? layer.outline_colour : undefined}
            strokeWidth={2 * layer.outline}
            strokeLinejoin="round"
            paintOrder="stroke"
            style={{ whiteSpace: "pre" }}
          >
            {line}
          </text>
        ))}
      </g>
    </g>
  );
}

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

function sceneAt(plan: RenderPlan, time: number): number {
  const index = plan.scenes.findIndex((scene) => time < scene.end);
  return index === -1 ? plan.scenes.length - 1 : index;
}

/**
 * One panel slot: its <video>, always mounted (so that it keeps playing across Scenes), shown in the
 * current Scene's panel for the slot (hidden when the Scene has none), cropped at the path's point.
 */
function PanelView({
  videoRef,
  src,
  plan,
  panel,
  playback,
  muted,
}: {
  videoRef: React.RefObject<HTMLVideoElement>;
  src: string;
  plan: RenderPlan | null;
  panel: Panel | null;
  playback: Playback;
  muted: boolean;
}) {
  const pointIndex = usePlayback(playback, (time) => {
    if (!panel) return 0;
    let index = 0;
    while (index + 1 < panel.path.length && panel.path[index + 1].at <= time) index += 1;
    return index;
  });
  const point = panel?.path[Math.min(pointIndex, panel.path.length - 1)];
  const box: CSSProperties =
    plan && panel
      ? {
          left: percent(panel.area.x / plan.width),
          top: percent(panel.area.y / plan.height),
          width: percent(panel.area.width / plan.width),
          height: percent(panel.area.height / plan.height),
        }
      : { inset: 0, visibility: "hidden" };
  const video: CSSProperties =
    plan && panel && point
      ? {
          left: percent(-point.x / panel.crop_width),
          top: percent(-point.y / panel.crop_height),
          width: percent(plan.source_width / panel.crop_width),
          height: percent(plan.source_height / panel.crop_height),
          filter: panel.blur ? `blur(calc(${BLUR_SIGMA}px * var(--scale))) brightness(${BLUR_BRIGHTNESS})` : undefined,
        }
      : { inset: 0, width: "100%", height: "100%" };
  return (
    <div className="absolute overflow-hidden" style={box}>
      <video
        ref={videoRef}
        src={src}
        muted={muted}
        playsInline
        preload="auto"
        className="absolute max-w-none object-fill"
        style={video}
      />
    </div>
  );
}

/** The caption line on screen, with its spoken Word highlighted as the Caption Style says. */
function Captions({ plan, font, playback }: { plan: RenderPlan; font: FontInfo | undefined; playback: Playback }) {
  const key = usePlayback(playback, (time) => {
    const event = plan.captions.findIndex((caption) => caption.start <= time && time < caption.end);
    if (event === -1) return "";
    const word = plan.captions[event].words.findIndex((w) => w.start <= time && time < w.end);
    return `${event}:${word}`;
  });
  if (!key || !font) return null;
  const [event, word] = key.split(":").map(Number);
  return <CaptionLine event={plan.captions[event]} active={word} plan={plan} font={font} />;
}

function CaptionLine({ event, active, plan, font }: { event: CaptionEvent; active: number; plan: RenderPlan; font: FontInfo }) {
  const style = plan.caption_style;
  const { area, size } = event;
  const centreX = area.x + area.width / 2;
  // libass centres the line's ascent-plus-descent box, which is the font size, on its position.
  const baseline = area.y + area.height / 2 - size / 2 + (font.ascent / font.units) * size;
  const fontSize = cssFontSize(font, size);
  const family = fontFamily(font.id);
  const words = event.words.map((word) => word.text);
  const tspans = (colours: boolean) =>
    words.map((text, i) => (
      <tspan key={i} fill={colours && i === active && style.highlight === "colour" ? style.active_colour : undefined}>
        {i < words.length - 1 ? `${text} ` : text}
      </tspan>
    ));
  const text = (props: React.SVGProps<SVGTextElement>, colours: boolean) => (
    <text
      x={centreX}
      y={baseline}
      textAnchor="middle"
      fontFamily={family}
      fontSize={fontSize}
      strokeLinejoin="round"
      paintOrder="stroke"
      style={{ whiteSpace: "pre" }}
      {...props}
    >
      {tspans(colours)}
    </text>
  );
  const outline = style.outline > 0 ? { stroke: style.outline_colour, strokeWidth: 2 * style.outline } : {};
  return (
    <g>
      {style.shadow > 0 &&
        text(
          {
            transform: `translate(${style.shadow} ${style.shadow})`,
            fill: style.shadow_colour,
            stroke: style.outline > 0 ? style.shadow_colour : undefined,
            strokeWidth: 2 * style.outline,
          },
          false,
        )}
      {style.highlight === "box" && active >= 0 && (
        <HighlightBox words={words} active={active} centreX={centreX} baseline={baseline} size={size} font={font} colour={style.active_colour} />
      )}
      {text({ fill: style.colour, ...outline }, true)}
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
  colour,
}: {
  words: string[];
  active: number;
  centreX: number;
  baseline: number;
  size: number;
  font: FontInfo;
  colour: string;
}) {
  if (!measure) return null;
  measure.font = `${cssFontSize(font, size)}px "${fontFamily(font.id)}"`;
  const width = (text: string) => measure.measureText(text).width;
  const line = width(words.join(" "));
  const before = active ? width(`${words.slice(0, active).join(" ")} `) : 0;
  const padX = HIGHLIGHT_PAD_X * size;
  const padY = HIGHLIGHT_PAD_Y * size;
  const cap = (font.cap_height / font.units) * size;
  const height = cap + 2 * padY;
  return (
    <rect
      x={centreX - line / 2 + before - padX}
      y={baseline - cap - padY}
      width={width(words[active]) + 2 * padX}
      height={height}
      rx={Math.min(HIGHLIGHT_RADIUS * size, height / 2)}
      fill={colour}
    />
  );
}

// How long the hook's entrance and exit take (renderer.py's _hook_ends), and how long after each
// other the `steps` + 1 elements of a staggered entrance come on (_stagger).
// What comes on and goes off as the hook does: the hook, or a Text Layer, in its style.
type Timed = { start: number; end: number };
type Moves = Pick<HookStyle, "animation_in" | "animation_out" | "animation_ms">;

function hookEnds(hook: Timed, style: Moves): [number, number] {
  const most = (hook.end - hook.start) / 2;
  const ms = style.animation_ms / 1000;
  return [style.animation_in === "none" ? 0 : Math.min(ms, most), style.animation_out === "none" ? 0 : Math.min(ms, most)];
}

function stagger(hook: HookEvent, style: HookStyle, steps: number): number {
  if (style.animation_in === "none" || !steps) return 0;
  const [on, off] = hookEnds(hook, style);
  return Math.max(0, Math.min(HOOK_STAGGER_SECS, (hook.end - hook.start - on - off) / steps));
}

// An element's look at `time`, coming on `delay` after the hook starts: its opacity, scale and how
// far below its place it is, as the renderer animates it (_hook_phases, _hook_motion); null while
// it is off screen.
function hookLook(time: number, hook: Timed, style: Moves, delay: number): [number, number, number] | null {
  const start = hook.start + delay;
  if (time < start || time >= hook.end) return null;
  const ms = style.animation_ms / 1000;
  const moving = (a: string) => a === "pop" || a === "slide";
  if (!moving(style.animation_in) && !moving(style.animation_out)) {
    const on = style.animation_in === "fade" ? (time - start) / ms : 1;
    const off = style.animation_out === "fade" ? (hook.end - time) / ms : 1;
    return [Math.max(0, Math.min(1, on, off)), 1, 0];
  }
  const [on, off] = hookEnds(hook, style);
  const animate = (animation: string, shown: number): [number, number, number] =>
    animation === "pop" ? [shown, 0.7 + 0.3 * shown, 0] : animation === "slide" ? [shown, 1, SLIDE_PX * (1 - shown)] : [shown, 1, 0];
  if (on && time < start + on) return animate(style.animation_in, (time - start) / on);
  if (off && time >= hook.end - off) return animate(style.animation_out, (hook.end - time) / off);
  return [1, 1, 0];
}

/**
 * The hook's boxes, lines, Kicker and Quote Mark while it is on screen, animated on and off as its
 * style says: the Kicker first, then the lines one by one (each strip with its line, a block and the
 * Quote Mark with the first).
 */
function Hook({ plan, hook, font, playback }: { plan: RenderPlan; hook: HookEvent; font: FontInfo | undefined; playback: Playback }) {
  const style = plan.hook_style;
  const first = hook.kicker ? 1 : 0;
  const steps = first + hook.lines.length - 1;
  const step = stagger(hook, style, steps);
  const key = usePlayback(playback, (time) => {
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
        x={x}
        y={baseline}
        textAnchor="middle"
        fontFamily={fontFamily(font.id)}
        fontSize={cssFontSize(font, hook.size)}
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
    <g>
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
            {style.shadow > 0 && (
              <g transform={`translate(${style.shadow} ${style.shadow})`}>
                {text(i, style.shadow_colour, style.shadow_colour, {
                  stroke: style.outline > 0 ? style.shadow_colour : undefined,
                  strokeWidth: 2 * style.outline,
                })}
              </g>
            )}
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

/** Play and pause, a scrubber over the Clip, and "Play clip" and "Play ending" (not when `compact`). */
function Transport({ playback, compact = false }: { playback: Playback; compact?: boolean }) {
  const playing = usePlayback(playback, (_, p) => p.playing);
  // Tenths of a second: enough for the label and the scrubber, and few re-renders.
  const tenths = usePlayback(playback, (time) => Math.round(time * 10));
  const duration = playback.duration;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <Button variant="secondary" size="icon" onClick={() => playback.toggle()} aria-label={playing ? "Pause" : "Play"}>
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
          className="min-w-0 flex-1 accent-accent"
        />
        <span className="shrink-0 text-sm text-muted tabular-nums">
          {formatPrecise(Math.max(0, tenths / 10))} / {formatPrecise(duration)}
        </span>
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
