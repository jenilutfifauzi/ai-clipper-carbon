import { Pause, Play, SkipForward } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { CaptionEvent, FontInfo, HookEvent, HookStyle, Panel, PreviewPlan, RenderPlan } from "../../../api";
import { Button } from "../../../components/Button";
import { cssFontSize, fontFamily } from "../../../fonts";
import { formatPrecise } from "../../../format";
import { usePlayback, type Playback } from "./playback";

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
 */
export function ClipPreview({
  src,
  preview,
  fonts,
  playback,
}: {
  src: string;
  preview: PreviewPlan | null;
  fonts: FontInfo[] | null;
  playback: Playback;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const master = useRef<HTMLVideoElement>(null);
  const follower = useRef<HTMLVideoElement>(null);
  const [scale, setScale] = useState(1 / 3);
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

  return (
    <div className="flex flex-col gap-3">
      <div
        ref={stage}
        className="relative mx-auto aspect-[9/16] w-full max-w-[22rem] overflow-hidden rounded-control bg-black outline-1 -outline-offset-1 outline-white/10"
        style={{ "--scale": scale } as CSSProperties}
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
            <Captions plan={plan} font={fontById.get(plan.caption_style.font)} playback={playback} />
            {plan.hook && <Hook plan={plan} hook={plan.hook} font={fontById.get(plan.hook_style.font)} playback={playback} />}
          </svg>
        )}
      </div>
      <Transport playback={playback} />
    </div>
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
function hookEnds(hook: HookEvent, style: HookStyle): [number, number] {
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
function hookLook(time: number, hook: HookEvent, style: HookStyle, delay: number): [number, number, number] | null {
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

/** Play and pause, a scrubber over the Clip, and "Play clip" and "Play ending". */
function Transport({ playback }: { playback: Playback }) {
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
    </div>
  );
}
