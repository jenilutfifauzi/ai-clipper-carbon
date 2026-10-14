import { Pause, Play, SkipForward } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import type { CaptionEvent, FontInfo, HookEvent, Panel, PreviewPlan, RenderPlan } from "../../../api";
import { Button } from "../../../components/Button";
import { cssFontSize, fontFamily } from "../../../fonts";
import { formatPrecise } from "../../../format";
import { usePlayback, type Playback } from "./playback";

// The planner's and renderer's numbers the drawing repeats (backend/app/planner.py, renderer.py):
// how far a sliding hook moves; the highlight box's padding and corners, in sizes of the line's font;
// and Blur's background, blurred with a sigma of 10 shrunk pixels at a quarter size, and darkened.
const SLIDE_PX = 60;
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

// The hook's look at `time`: its opacity, scale and how far below its place it is, as the renderer
// animates it (_hook_phases, _hook_motion); null while it is off screen.
function hookLook(time: number, hook: HookEvent, style: RenderPlan["hook_style"]): [number, number, number] | null {
  if (time < hook.start || time >= hook.end) return null;
  const ms = style.animation_ms / 1000;
  const moving = (a: string) => a === "pop" || a === "slide";
  if (!moving(style.animation_in) && !moving(style.animation_out)) {
    const on = style.animation_in === "fade" ? (time - hook.start) / ms : 1;
    const off = style.animation_out === "fade" ? (hook.end - time) / ms : 1;
    return [Math.max(0, Math.min(1, on, off)), 1, 0];
  }
  const most = (hook.end - hook.start) / 2;
  const on = style.animation_in === "none" ? 0 : Math.min(ms, most);
  const off = style.animation_out === "none" ? 0 : Math.min(ms, most);
  const animate = (animation: string, shown: number): [number, number, number] =>
    animation === "pop" ? [shown, 0.7 + 0.3 * shown, 0] : animation === "slide" ? [shown, 1, SLIDE_PX * (1 - shown)] : [shown, 1, 0];
  if (on && time < hook.start + on) return animate(style.animation_in, (time - hook.start) / on);
  if (off && time >= hook.end - off) return animate(style.animation_out, (hook.end - time) / off);
  return [1, 1, 0];
}

/** The hook's boxes and lines while it is on screen, animated on and off as its style says. */
function Hook({ plan, hook, font, playback }: { plan: RenderPlan; hook: HookEvent; font: FontInfo | undefined; playback: Playback }) {
  const style = plan.hook_style;
  const key = usePlayback(playback, (time) => {
    const look = hookLook(time, hook, style);
    return look && look.map((value) => value.toFixed(3)).join(" ");
  });
  if (!key || !font) return null;
  const [opacity, scale, below] = key.split(" ").map(Number);
  // Each element grows from its own centre, as libass scales it.
  const grown = scale === 1 ? undefined : { transform: `scale(${scale})`, transformBox: "fill-box" as const, transformOrigin: "center" };
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
        style={{ whiteSpace: "pre", ...grown }}
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
  return (
    <g opacity={opacity} transform={below ? `translate(0 ${below})` : undefined}>
      {style.box_opacity > 0 &&
        hook.boxes.map((box, i) => (
          <rect
            key={i}
            x={box.x}
            y={box.y}
            width={box.width}
            height={box.height}
            rx={Math.min(style.radius, Math.floor(box.height / 2))}
            fill={style.box_colour}
            fillOpacity={style.box_opacity}
            style={grown}
          />
        ))}
      {hook.kicker && (
        <g>
          <rect
            x={hook.kicker.box.x}
            y={hook.kicker.box.y}
            width={hook.kicker.box.width}
            height={hook.kicker.box.height}
            rx={Math.floor(hook.kicker.box.height / 2)}
            fill={style.kicker_box_colour}
            style={grown}
          />
          <text
            x={hook.kicker.anchor[0]}
            y={hook.kicker.anchor[1]}
            textAnchor="middle"
            fontFamily={fontFamily(font.id)}
            fontSize={cssFontSize(font, hook.kicker.size)}
            fill={style.kicker_colour}
            style={{ whiteSpace: "pre", ...grown }}
          >
            {hook.kicker.text}
          </text>
        </g>
      )}
      {style.shadow > 0 &&
        hook.lines.map((_, i) => (
          <g key={i} transform={`translate(${style.shadow} ${style.shadow})`}>
            {text(i, style.shadow_colour, style.shadow_colour, {
              stroke: style.outline > 0 ? style.shadow_colour : undefined,
              strokeWidth: 2 * style.outline,
            })}
          </g>
        ))}
      {hook.lines.map((_, i) => (
        <g key={i}>{text(i, style.colour, style.emphasis_colour, outline)}</g>
      ))}
    </g>
  );
}

// A line cut into its plain and emphasised parts.
function runs(line: string, spans: [number, number][]): [string, boolean][] {
  const parts: [string, boolean][] = [];
  let at = 0;
  for (const [start, end] of spans) {
    if (start > at) parts.push([line.slice(at, start), false]);
    parts.push([line.slice(start, end), true]);
    at = end;
  }
  if (at < line.length) parts.push([line.slice(at), false]);
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
