import { useEffect, useLayoutEffect, useRef, useSyncExternalStore, type CSSProperties, type ReactNode, type RefObject } from "react";
import type { Background, MattePiece, Panel, RenderPlan } from "../../../api";
import { BLUR_BRIGHTNESS, BLUR_SIGMA } from "./ClipPreview";
import { MAX_DRIFT_SECS } from "./follow";
import { filledStyle } from "./picture";
import { copyFrame, matteAt, matteFrame, matteSeek, MATTE_PIECE_SECS, SOURCE_CLOCK, type MatteClock, type MatteFrame } from "./matteTime";
import type { Playback } from "./playback";

/*
 * The preview's cut (docs/adr/0015-background-removal-reads-a-cached-matte.md): a cut-out Segment of the
 * Source is drawn on a canvas in place of each of its pictures' videos, the picture masked by its
 * Matte, over its Background. The Matte's pieces (the Preview Plan's `mattes`) play on hidden videos
 * that follow a deck's master (`DeckMatte`); on each frame of a picture's video, its canvas draws the
 * picture, turns the Matte frame of the same Source frame (matteTime.ts) from luminance into alpha,
 * blurs it by the feather and masks the picture with it (`cutSlot`). The canvas stands where the video
 * stood, styled as it is, so it is cropped, scaled and placed as the video is in every Layout, and the
 * Grade's and Video Effects' SVG filters on the frame still apply to it. Where no piece is served yet,
 * the picture shows whole, and the cut appears once it is. The cut is shown by a flag on `CutGroup`
 * (`data-cut`), which the videos, canvases, fills and the Background read.
 */

// The longest side of the canvases a picture is cut on: the Matte's own (the backend's MATTE_SIDE).
const MATTE_SIDE = 1280;
// The next piece is loaded this long before its time comes, so that it is ready.
const LOOKAHEAD_SECS = 2;
// A piece not served yet (or that failed to load) is asked for again after this long.
const RETRY_MS = 2000;
// While playing, a Matte frame this many frames off the picture's is drawn with it until the right
// one comes; while paused (or scrubbing) only the right one is.
const PLAYING_FRAMES = 3;
// The Background's canvas, shrunk this many times (it is blurred).
const BACKDROP_SHRINK = 8;
// The rates a browser plays a video at.
const RATES = { min: 0.0625, max: 16 };

const hasFrameCallback = typeof HTMLVideoElement !== "undefined" && "requestVideoFrameCallback" in HTMLVideoElement.prototype;

/**
 * Calls `onFrame` with the media time of each frame `video` shows (or, without
 * requestVideoFrameCallback, at each seek and time update); returns what stops it.
 */
function eachFrame(video: HTMLVideoElement, onFrame: (mediaTime: number | null) => void): () => void {
  let stopped = false;
  let handle = 0;
  const seeked = () => onFrame(null);
  video.addEventListener("seeked", seeked);
  video.addEventListener("loadeddata", seeked);
  if (!hasFrameCallback) {
    video.addEventListener("timeupdate", seeked);
    return () => {
      video.removeEventListener("seeked", seeked);
      video.removeEventListener("loadeddata", seeked);
      video.removeEventListener("timeupdate", seeked);
    };
  }
  const next = (_: number, metadata: VideoFrameCallbackMetadata) => {
    if (stopped) return;
    onFrame(metadata.mediaTime);
    handle = video.requestVideoFrameCallback(next);
  };
  handle = video.requestVideoFrameCallback(next);
  return () => {
    stopped = true;
    video.cancelVideoFrameCallback(handle);
    video.removeEventListener("seeked", seeked);
    video.removeEventListener("loadeddata", seeked);
  };
}

// The start of the frame a video at `time` shows (the last one starting at or before it).
const frameStart = (time: number, fps: number) => Math.floor(time * fps + 0.01) / fps;

/** A Matte frame on show: its piece's video, and which of its frames it shows. */
interface ShownMatte {
  video: HTMLVideoElement;
  frame: number;
}

/**
 * The Matte of one deck (or a Transition's ghost): the hidden videos of the pieces its master's time
 * needs (the piece holding it, and the next one when it is near), following the master: paused at
 * the same Source frame while it is paused, playing at its rate while it plays, moved back when it
 * drifts. Nothing is held where the plan has no pieces, nor far from them. `good` is whether its
 * pictures were last cut (not shown whole). A master playing a Retimed copy (a Segment's own, ADR
 * 0009) is followed through its `clock` (matteTime.ts's `copyClock`): its time mapped to the Source's,
 * at its rate times the copy's Speed, or to a reversed Matte copy's, played as one piece.
 */
export class DeckMatte {
  fps = 30;
  good = false;
  // The plan's pieces, and those read now: they, or the clock's reversed copy (as the piece at 0).
  private planned = new Map<number, string>();
  private pieces = new Map<number, string>();
  private clock: MatteClock | null = SOURCE_CLOCK;
  private master: HTMLVideoElement | null = null;
  private stopMaster: () => void = () => {};
  private videos = new Map<number, HTMLVideoElement>();
  // Each piece video's frame on show, by its media time, until its next seek; and those that have shown one.
  private shown = new WeakMap<HTMLVideoElement, number>();
  private loaded = new WeakSet<HTMLVideoElement>();
  // Pieces that failed to load, and how many times each has (its URL carries it, so it loads afresh).
  private broken = new Set<number>();
  private tries = new Map<number, number>();
  private retries = new Map<number, number>();
  private mounted: { piece: number; src: string }[] = [];
  private listeners = new Set<() => void>();
  private framed = new Set<() => void>();
  private goodListeners = new Set<() => void>();

  /** The plan's pieces (none: nothing is cut) and the Source's frame rate. */
  setPieces(pieces: MattePiece[] | undefined, fps: number) {
    this.planned = new Map((pieces ?? []).map(({ start, url }) => [start, url]));
    this.fps = fps > 0 ? fps : 30;
    this.read();
  }

  /** How its master's time maps to the Matte's (null: there is nothing to cut it by yet). */
  setClock(clock: MatteClock | null) {
    this.clock = clock;
    this.read();
  }

  private read() {
    const copy = this.clock?.copy;
    this.pieces = !this.clock ? new Map() : copy ? new Map([[0, copy]]) : this.planned;
    this.follow();
  }

  // The Matte frame its master's time `time` shows, in the pieces read now.
  private locate(time: number): MatteFrame | null {
    if (!this.clock) return null;
    const at = this.clock.at(time);
    if (!this.clock.copy) return matteAt(at, this.fps, this.pieces.keys());
    return this.pieces.size ? copyFrame(at, this.fps) : null;
  }

  get cutting(): boolean {
    return this.pieces.size > 0;
  }

  /** The deck's master, which it follows (null: none). */
  attachMaster(master: HTMLVideoElement | null) {
    this.stopMaster();
    this.stopMaster = () => {};
    this.master = master;
    if (!master) return this.follow();
    const follow = () => this.follow();
    const events = ["play", "pause", "ratechange", "seeking"] as const;
    for (const event of events) master.addEventListener(event, follow);
    const stop = eachFrame(master, follow);
    this.stopMaster = () => {
      stop();
      for (const event of events) master.removeEventListener(event, follow);
    };
    this.follow();
  }

  /** The pieces' videos to mount (for MatteVideos). */
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };
  videosToMount = () => this.mounted;

  /** Calls `listener` when a piece's video shows a new frame. */
  onFrame(listener: () => void): () => void {
    this.framed.add(listener);
    return () => void this.framed.delete(listener);
  }

  /** Calls `listener` when `good` changes. */
  onGood(listener: () => void): () => void {
    this.goodListeners.add(listener);
    return () => void this.goodListeners.delete(listener);
  }

  setGood(good: boolean) {
    if (good === this.good) return;
    this.good = good;
    for (const listener of this.goodListeners) listener();
  }

  /** Piece `piece`'s video, mounted (or gone, with null). */
  register(piece: number, video: HTMLVideoElement | null, was?: HTMLVideoElement) {
    if (video) {
      this.videos.set(piece, video);
      this.broken.delete(piece);
    } else if (this.videos.get(piece) === was) {
      this.videos.delete(piece);
    }
    this.follow();
  }

  /** A piece's video failed to load (not served yet): shown whole, and asked for again shortly. */
  failed(piece: number) {
    this.broken.add(piece);
    this.notifyFrame();
    if (this.retries.has(piece)) return;
    this.retries.set(
      piece,
      window.setTimeout(() => {
        this.retries.delete(piece);
        this.tries.set(piece, (this.tries.get(piece) ?? 0) + 1);
        this.mount(this.mounted.map(({ piece }) => piece));
      }, RETRY_MS),
    );
  }

  /** A piece's video showed a frame (`mediaTime`; null: it was sought, its frame not known yet). */
  showed(video: HTMLVideoElement, mediaTime: number | null) {
    if (mediaTime === null) this.shown.delete(video);
    else this.shown.set(video, mediaTime);
    if (video.readyState >= 2) this.loaded.add(video);
    // Loaded (or sought): brought to the master's frame, if it isn't there.
    if (mediaTime === null) this.follow();
    this.notifyFrame();
  }

  /**
   * The Matte frame for the picture's Source frame starting at `source` seconds: its video when it
   * shows it (within PLAYING_FRAMES while `playing`), "waiting" while it is on its way (the last cut
   * kept meanwhile), or null where there is none to show (the picture shown whole).
   */
  frameFor(source: number, playing: boolean): ShownMatte | "waiting" | null {
    const at = this.locate(source);
    if (!at) return null;
    const video = this.videos.get(at.piece);
    if (!video || this.broken.has(at.piece) || !this.loaded.has(video)) return null;
    // Loaded once, it may wait for data while playing: the last cut is kept meanwhile.
    if (video.seeking || video.readyState < 2) return "waiting";
    const time = this.shown.get(video) ?? video.currentTime;
    // A media time is a frame's start; a time sought is a frame's middle (`matteSeek`).
    const frame = Math.floor(time * this.fps + 0.01);
    return Math.abs(frame - at.frame) <= (playing ? PLAYING_FRAMES : 0) ? { video, frame } : "waiting";
  }

  dispose() {
    this.attachMaster(null);
    for (const timer of this.retries.values()) window.clearTimeout(timer);
    this.retries.clear();
  }

  // The pieces' videos brought to the master's time.
  private follow() {
    const master = this.master;
    if (!master || !this.pieces.size) return this.mount([]);
    const time = frameStart(master.currentTime, this.fps);
    const at = this.locate(time);
    // The next piece, in the Source's pieces (a reversed copy is one).
    const source = this.clock && !this.clock.copy ? this.clock.at(time) : null;
    const next = source === null ? null : matteFrame(source, this.fps).piece + MATTE_PIECE_SECS;
    const ahead = next !== null && source !== null && this.pieces.has(next) && (next - source) / (this.clock?.rate ?? 1) < LOOKAHEAD_SECS;
    this.mount([...(at ? [at.piece] : []), ...(ahead && next !== null ? [next] : [])]);
    if (at) this.keep(this.videos.get(at.piece), matteSeek(at.frame, this.fps), master);
    // The next waits on its first frame.
    const waiting = ahead && next !== null ? this.videos.get(next) : undefined;
    if (waiting && waiting.readyState >= 1) {
      if (!waiting.paused) waiting.pause();
      const first = matteSeek(0, this.fps);
      if (Math.abs(waiting.currentTime - first) > 0.25 / this.fps) waiting.currentTime = first;
    }
  }

  // A piece's video at `target` seconds into it, in step with `master`.
  private keep(video: HTMLVideoElement | undefined, target: number, master: HTMLVideoElement) {
    if (!video || video.readyState < 1) return;
    const rate = Math.min(RATES.max, Math.max(RATES.min, master.playbackRate * (this.clock?.rate ?? 1)));
    if (video.playbackRate !== rate) video.playbackRate = rate;
    if (master.paused) {
      if (!video.paused) video.pause();
      if (Math.abs(video.currentTime - target) > 0.25 / this.fps) video.currentTime = target;
      return;
    }
    if (Math.abs(video.currentTime - target) > MAX_DRIFT_SECS) video.currentTime = target;
    if (video.paused) void video.play().catch(() => {});
  }

  private mount(pieces: number[]) {
    const mounted = pieces.flatMap((piece) => {
      const url = this.pieces.get(piece);
      const tries = this.tries.get(piece) ?? 0;
      return url ? [{ piece, src: tries ? `${url}?try=${tries}` : url }] : [];
    });
    if (JSON.stringify(mounted) === JSON.stringify(this.mounted)) return;
    this.mounted = mounted;
    for (const listener of this.listeners) listener();
  }

  private notifyFrame() {
    for (const listener of this.framed) listener();
  }
}

/** The hidden videos of the pieces `matte` holds now. */
export function MatteVideos({ matte }: { matte: DeckMatte }) {
  const mounted = useSyncExternalStore(matte.subscribe, matte.videosToMount);
  return (
    <>
      {mounted.map(({ piece, src }) => (
        <MatteVideo key={src} matte={matte} piece={piece} src={src} />
      ))}
    </>
  );
}

function MatteVideo({ matte, piece, src }: { matte: DeckMatte; piece: number; src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const failed = () => matte.failed(piece);
    video.addEventListener("error", failed);
    const stop = eachFrame(video, (time) => matte.showed(video, time));
    matte.register(piece, video);
    return () => {
      stop();
      video.removeEventListener("error", failed);
      matte.register(piece, null, video);
    };
  }, [matte, piece]);
  return <video ref={ref} src={src} muted playsInline preload="auto" aria-hidden className="pointer-events-none absolute size-px opacity-0" />;
}

/**
 * Cuts `video` (a deck's or ghost's slot) onto `canvas` by `matte`, on each frame of either, its
 * edge blurred by `feather()` output pixels; returns what stops it.
 */
export function cutSlot(matte: DeckMatte, video: HTMLVideoElement, canvas: HTMLCanvasElement, feather: () => number): () => void {
  const mask = document.createElement("canvas");
  let pictureTime: number | null = null;
  let last = "";
  const draw = () => {
    if (!matte.cutting || video.readyState < 2) return;
    // The picture's Source frame on show, by its start.
    const source = pictureTime ?? frameStart(video.currentTime, matte.fps);
    const shown = matte.frameFor(source, !video.paused);
    if (shown === "waiting") return;
    if (shown === null) {
      last = "";
      return matte.setGood(false);
    }
    const drawn = `${source}:${shown.video.currentSrc}:${shown.frame}`;
    if (drawn !== last && cut(video, shown.video, canvas, mask, feather())) last = drawn;
    matte.setGood(true);
  };
  const stopPicture = eachFrame(video, (time) => {
    pictureTime = time;
    draw();
  });
  const stopMatte = matte.onFrame(draw);
  draw();
  return () => {
    stopPicture();
    stopMatte();
  };
}

/**
 * Draws `picture` onto `canvas` (at the Matte's size), keeping only where `matte` is light: its
 * luminance made alpha on `mask`, blurred by `feather` output pixels, masks it. False when it can't yet.
 */
function cut(picture: HTMLVideoElement, matte: HTMLVideoElement, canvas: HTMLCanvasElement, mask: HTMLCanvasElement, feather: number): boolean {
  const width = Math.min(matte.videoWidth, MATTE_SIDE);
  const height = Math.round((matte.videoHeight * width) / Math.max(1, matte.videoWidth));
  if (!width || !height) return false;
  if (canvas.width !== width || canvas.height !== height) Object.assign(canvas, { width, height });
  if (mask.width !== width || mask.height !== height) Object.assign(mask, { width, height });
  const alpha = mask.getContext("2d", { willReadFrequently: true });
  const context = canvas.getContext("2d");
  if (!alpha || !context) return false;
  alpha.drawImage(matte, 0, 0, width, height);
  const pixels = alpha.getImageData(0, 0, width, height);
  // Grey: its red is its luminance, which becomes the alpha of white.
  const words = new Uint32Array(pixels.data.buffer);
  for (let i = 0; i < words.length; i++) words[i] = ((words[i] & 0xff) << 24) | 0xffffff;
  alpha.putImageData(pixels, 0, 0);
  context.globalCompositeOperation = "copy";
  context.filter = "none";
  context.drawImage(picture, 0, 0, width, height);
  // The feather is in output pixels: the canvas's own are as many as it is wide over its width in the frame.
  const scale = parseFloat(getComputedStyle(canvas).getPropertyValue("--scale")) || 1;
  const sigma = canvas.offsetWidth > 0 ? (feather * width * scale) / canvas.offsetWidth : 0;
  context.globalCompositeOperation = "destination-in";
  context.filter = sigma >= 0.1 ? `blur(${sigma.toFixed(2)}px)` : "none";
  context.drawImage(mask, 0, 0);
  context.globalCompositeOperation = "source-over";
  context.filter = "none";
  return true;
}

/**
 * Where the cut is shown: its children (a deck's panels or a ghost's, and the Background under them)
 * read its `data-cut` flag, set while the Segment shown (`cutNow`) is cut out and its deck's pictures
 * (`shownMatte`) are cut, not shown whole. Its Matte videos are kept inside it, hidden.
 */
export function CutGroup({
  mattes,
  playback,
  cutNow,
  shownMatte,
  children,
}: {
  mattes: DeckMatte[];
  playback: Playback;
  cutNow: () => boolean;
  shownMatte: () => DeckMatte | undefined;
  children: ReactNode;
}) {
  const group = useRef<HTMLDivElement>(null);
  const read = useRef({ cutNow, shownMatte });
  read.current = { cutNow, shownMatte };
  useLayoutEffect(() => {
    const update = () => {
      const element = group.current;
      if (!element) return;
      const on = read.current.cutNow() && !!read.current.shownMatte()?.good;
      if (on !== element.hasAttribute("data-cut")) element.toggleAttribute("data-cut", on);
    };
    update();
    const stops = [playback.subscribe(update), ...mattes.map((matte) => matte.onGood(update))];
    return () => stops.forEach((stop) => stop());
  });
  return (
    <div ref={group} className="group/cut absolute inset-0">
      {children}
      {mattes.map((matte, i) => (
        <MatteVideos key={i} matte={matte} />
      ))}
    </div>
  );
}

/** What a cut-out Segment's Background is drawn as: a crop of the picture, blurred, filling `panel`'s area; or a colour, or a Media Library image covering the frame. */
export type BackdropView = { panel: Panel; colour: string | null; image?: null } | { panel: null; colour: string; image?: string | null };

/**
 * A cut-out Scene's Background, as the render's `_backdrop_scene` draws it: a Manual Scene's
 * Framing's (its blurred cover panel, its colour or its image, `manual`); any other's the Segment's
 * `background` (a colour, or an image covering the frame), by default the picture blurred over the
 * whole frame (the largest 9:16 crop from its middle), which in Blur replaces the Layout's fill.
 */
export function backdropView(
  plan: RenderPlan,
  manual: { panel: Panel | null; colour: string | null; image?: string | null } | null,
  background?: Background | null,
): BackdropView {
  if (manual) return manual.panel ? { panel: manual.panel, colour: manual.colour } : { panel: null, colour: manual.colour ?? "#000000", image: manual.image ?? null };
  if (background?.kind === "colour") return { panel: null, colour: background.colour };
  if (background?.kind === "image" && background.image) return { panel: null, colour: "#000000", image: background.image };
  return { panel: filledPanel(plan), colour: null };
}

const even = (value: number) => 2 * Math.round(value / 2);
const evenFloor = (value: number) => 2 * Math.floor(value / 2);
const centred = (outer: number, inner: number) => Math.min(even((outer - inner) / 2), evenFloor(outer - inner));

// The largest 9:16 crop from the middle of the Source, filling the frame (the planner's `filled`).
function filledPanel(plan: RenderPlan): Panel {
  const { source_width: width, source_height: height } = plan;
  let cropWidth: number, cropHeight: number;
  if (width * plan.height >= height * plan.width) {
    cropHeight = evenFloor(height);
    cropWidth = Math.min(even((cropHeight * plan.width) / plan.height), evenFloor(width));
  } else {
    cropWidth = evenFloor(width);
    cropHeight = Math.min(even((cropWidth * plan.height) / plan.width), evenFloor(height));
  }
  const point = { at: 0, x: centred(width, cropWidth), y: centred(height, cropHeight) };
  return { area: { x: 0, y: 0, width: plan.width, height: plan.height }, crop_width: cropWidth, crop_height: cropHeight, path: [point], blur: true };
}

/**
 * The Background under a cut-out Segment's picture, shown with the cut (`CutGroup`): its colour, its
 * image covering the frame, or its crop of the picture drawn from the shown deck's master
 * (`master()`) on each of its frames,
 * shrunk and blurred as Blur's fill is.
 */
export function CutBackdrop({
  plan,
  view,
  masters,
  master,
  playback,
}: {
  plan: RenderPlan;
  view: BackdropView;
  // Every master it may be drawn from, and the one shown now.
  masters: RefObject<HTMLVideoElement>[];
  master: () => HTMLVideoElement | null;
  playback: Playback;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const shown = useRef({ view, master, plan });
  shown.current = { view, master, plan };
  const panel = view.panel;
  useEffect(() => {
    const element = canvas.current;
    if (!element || !panel) return;
    const draw = () => {
      const video = shown.current.master();
      const context = element.getContext("2d");
      if (!video || video.readyState < 2 || !context) return;
      const point = panel.path[0];
      // In the video's own pixels: a Retimed copy may be smaller than the Source.
      const k = video.videoWidth / shown.current.plan.source_width || 1;
      context.drawImage(video, point.x * k, point.y * k, panel.crop_width * k, panel.crop_height * k, 0, 0, element.width, element.height);
    };
    const stops = masters.flatMap(({ current: video }) => (video ? [eachFrame(video, () => video === shown.current.master() && draw())] : []));
    stops.push(playback.subscribe(draw));
    draw();
    return () => stops.forEach((stop) => stop());
  }, [panel, masters, playback]);
  const box: CSSProperties = panel
    ? {
        left: `${(panel.area.x / plan.width) * 100}%`,
        top: `${(panel.area.y / plan.height) * 100}%`,
        width: `${(panel.area.width / plan.width) * 100}%`,
        height: `${(panel.area.height / plan.height) * 100}%`,
      }
    : { inset: 0 };
  return (
    <div aria-hidden className="invisible absolute inset-0 overflow-hidden group-data-[cut]/cut:visible" style={filledStyle(view.colour, view.image)}>
      {panel && (
        <canvas
          ref={canvas}
          width={Math.max(2, Math.round(panel.area.width / BACKDROP_SHRINK))}
          height={Math.max(2, Math.round(panel.area.height / BACKDROP_SHRINK))}
          className="absolute"
          style={{ ...box, filter: `blur(calc(${BLUR_SIGMA}px * var(--scale))) brightness(${BLUR_BRIGHTNESS})` }}
        />
      )}
    </div>
  );
}
