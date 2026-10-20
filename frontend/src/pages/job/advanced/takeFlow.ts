import type { MediaItem } from "../../../api";
import type { TakeRecorder } from "./takeRecorder";
import { landing, takeName } from "./voiceover";

/**
 * The take flow (.scratch/voiceover/spec.md, ADR 0018): from the mic button, or Shift+R, to a Music
 * Clip marked Speech on the Timeline. A pure state machine (`takeStep`), and `TakeFlow`, which runs
 * its effects on what it is given: the microphone, the playback, the master bus, the upload and the
 * edit that lands the Take. No React.
 *
 *   idle → opening → countdown (3, 2, 1) → recording → uploading → idle (landed)
 *                                                          ↕ (Try again)
 *                                                       waiting → idle (Discard)
 *
 * Cancelled (Esc, or the button pressed again) while opening or counting down, it goes back to idle
 * with nothing kept; and back to idle (dropped) when the microphone can't be opened, with what is
 * wrong and how to fix it told, or when the editor lets go of it. A Take that fails to upload, or
 * whose landing is refused (the Music Track locked), is kept in the tab (waiting): Try again uploads
 * it (unless it already is) and lands it where it was recorded, Save WAV downloads it, Discard lets it
 * go. One waits at a time: Record is refused until it is landed or discarded.
 */
export type TakeState =
  | { phase: "idle" }
  // Asking for the microphone.
  | { phase: "opening" }
  // The microphone open, its meter moving, the playhead still: `left` seconds before the picture rolls.
  | { phase: "countdown"; left: number }
  // The picture rolled from `playhead` at `rolledAt` on the recorder's clock, at `began` local time.
  | { phase: "recording"; playhead: number; rolledAt: number; began: Date }
  // The Take, stopped, on its way to the Media Library, to land at `start` for `secs`.
  | ({ phase: "uploading" } & TakeLanding)
  // The Take kept in the tab after its upload or its landing failed (`why`), waiting for Try again,
  // Save WAV or Discard. Editing isn't locked meanwhile (the Music Track may need unlocking).
  | { phase: "waiting"; take: WaitingTake; why: string };

/** The Music Clip a Take lands as: `media` its item, at `start` for `secs`. */
export interface LandedTake {
  media: string;
  start: number;
  secs: number;
}

/** Where a Take lands and for how long, before its item is known. */
export type TakeLanding = Omit<LandedTake, "media">;

/** A Take kept in the tab: its WAV and file name, where it lands, and its item once uploaded. */
export interface WaitingTake extends TakeLanding {
  wav: Uint8Array<ArrayBuffer>;
  name: string;
  // The Media Library item, once the upload got through (only the landing failed): not uploaded again.
  media: string | null;
}

export type TakeEvent =
  | { type: "open" }
  | { type: "opened" }
  | { type: "tick" }
  | { type: "cancel" }
  | { type: "rolled"; playhead: number; at: number; began: Date }
  // The roll timed again, by the first frame the picture was seen to move on.
  | { type: "timed"; rolledAt: number }
  // Stopped: `secs` long, its first sample captured at `firstSample`, heard `latency` before that.
  | { type: "stopped"; secs: number; firstSample: number | null; latency?: number }
  | { type: "landed" }
  // Back to idle with nothing kept: the microphone wouldn't open, or the editor let go.
  | { type: "dropped" }
  // The upload or the landing failed: the Take kept, waiting.
  | { type: "kept"; take: WaitingTake; why: string }
  | { type: "retry" }
  | { type: "discard" };

/** How long the countdown runs before the picture rolls. */
export const COUNTDOWN_SECS = 3;

export const IDLE: TakeState = { phase: "idle" };

/** The state after `event`; an event that doesn't belong to the state leaves it as it is. */
export function takeStep(state: TakeState, event: TakeEvent): TakeState {
  switch (event.type) {
    case "open":
      return state.phase === "idle" ? { phase: "opening" } : state;
    case "opened":
      return state.phase === "opening" ? { phase: "countdown", left: COUNTDOWN_SECS } : state;
    case "tick":
      return state.phase === "countdown" && state.left > 1 ? { phase: "countdown", left: state.left - 1 } : state;
    case "cancel":
      return counting(state) ? IDLE : state;
    case "rolled":
      return state.phase === "countdown" ? { phase: "recording", playhead: event.playhead, rolledAt: event.at, began: event.began } : state;
    case "timed":
      return state.phase === "recording" ? { ...state, rolledAt: event.rolledAt } : state;
    case "stopped":
      return state.phase === "recording"
        ? { phase: "uploading", start: landing(state.playhead, state.rolledAt, event.firstSample, event.latency), secs: event.secs }
        : state;
    case "landed":
      return state.phase === "uploading" ? IDLE : state;
    case "dropped":
      return IDLE;
    case "kept":
      return state.phase === "uploading" ? { phase: "waiting", take: event.take, why: event.why } : state;
    case "retry":
      return state.phase === "waiting" ? { phase: "uploading", start: state.take.start, secs: state.take.secs } : state;
    case "discard":
      return state.phase === "waiting" ? IDLE : state;
  }
}

/** Whether a Take is under way: Space and Shift+R stop it, and the button reads Stop. */
export const recording = (state: TakeState) => state.phase === "recording";

/** Whether the countdown runs (or the microphone is being asked for): Esc cancels it. */
export const counting = (state: TakeState) => state.phase === "opening" || state.phase === "countdown";

/** Whether the mic button starts a Take now: from idle only. */
export const canStart = (state: TakeState) => state.phase === "idle";

/**
 * Whether a Take holds the microphone: while it is being opened, counting down or recording. The
 * recording settings are off then, and no test meter opens; once the Take has stopped (uploading, or
 * waiting in the tab) the microphone is free again, and the test meter works.
 */
export const holdsMicrophone = (state: TakeState) => counting(state) || recording(state);

/**
 * Whether hand edits are locked (the Timeline, the inspector and the editing shortcuts): from the
 * press until the Take has landed, the microphone's opening and the upload included, though not while
 * a Take merely waits. Edits from elsewhere still arrive (edit-sync).
 */
export const locksEditing = (state: TakeState) => state.phase !== "idle" && state.phase !== "waiting";

/**
 * Whether leaving the page asks first: while the countdown runs, the Take records or uploads (it isn't
 * safe in the Media Library yet), and while a Take waits in the tab; not otherwise, nor while the
 * microphone is only being asked for.
 */
export const asksBeforeLeaving = (state: TakeState) =>
  state.phase === "countdown" || state.phase === "recording" || state.phase === "uploading" || state.phase === "waiting";

/** What the mic button and Shift+R tell while the playhead is at the Clip's end. */
export const AT_END_HINT = "Move the playhead into the Clip to record a Voiceover: a Take from its end would never be heard";

/** What the microphone refused (NotAllowedError, SecurityError) tells. */
export const MIC_REFUSED =
  "The microphone is blocked for this page. Allow it in the browser's site settings (the icon beside the address), then record again.";
/** What a missing microphone (NotFoundError, or the chosen one gone and no default) tells. */
export const MIC_MISSING = "No microphone was found. Plug one in, or choose another in the recording settings, then record again.";
/** What a busy microphone (NotReadableError, AbortError) tells. */
export const MIC_BUSY =
  "The microphone is in use and couldn't start. Close the other app using it (a call or another recorder), then record again.";
/** What Record says while a Take waits. */
export const TAKE_WAITING = "Save or discard the waiting Take first: Try again, Save WAV or Discard, in its notice.";

/** What a microphone that wouldn't open tells: refused, missing or busy, with how to fix it. */
export function microphoneTrouble(reason: unknown): string {
  const name = (reason as Error | null)?.name;
  if (name === "NotAllowedError" || name === "SecurityError") return MIC_REFUSED;
  if (name === "NotFoundError" || name === "OverconstrainedError") return MIC_MISSING;
  if (name === "NotReadableError" || name === "AbortError") return MIC_BUSY;
  return `Couldn't open the microphone: ${(reason as Error | null)?.message ?? reason}`;
}

/** The playback as the take flow drives it. */
export interface TakePlayback {
  readonly time: number;
  readonly playing: boolean;
  play: (from?: number) => void;
  pause: () => void;
  seek: (time: number) => void;
  setLoop: (region: null) => void;
  // Told on every frame it plays (and on every change): the roll is timed by the first frame it moves.
  subscribe?: (listener: () => void) => () => void;
}

export interface TakeDeps {
  // The microphone opened for a Take (openTake with the browser's recorder); `capped` at eight minutes.
  open: (capped: () => void) => Promise<TakeRecorder>;
  playback: TakePlayback;
  // The master bus held silent, or heard again.
  silence: (silent: boolean) => void;
  // Whether "Hear the Clip (headphones)" is on: then the bus isn't held silent while recording.
  hearClip?: () => boolean;
  // The Take's WAV into the Media Library: the item it made, normalized with its Peaks.
  upload: (file: File) => Promise<MediaItem>;
  // The Music Clip added (one edit) and Picked: where it starts, or null when it was refused.
  land: (take: LandedTake) => number | null;
  // A notice: what went wrong, or that the cap stopped it.
  tell: (text: string) => void;
  // A waiting Take's WAV downloaded under its name (Save WAV).
  save?: (wav: Blob, name: string) => void;
  // Local time, for the Take's name.
  now?: () => Date;
  // Whether the playhead is at the Clip's end, where no Take starts (it would never be heard).
  atEnd?: () => boolean;
}

/**
 * The take flow as it runs: `press` starts a Take, cancels its countdown or stops the one recording;
 * `cancel` is Esc's; `subscribe` and `state` are for the button (useSyncExternalStore).
 */
export class TakeFlow {
  state: TakeState = IDLE;
  private recorder: TakeRecorder | null = null;
  private listeners = new Set<() => void>();
  // Counted up when a Take is cancelled or the editor lets go of the flow: a Take begun before then
  // neither rolls, uploads into a landing, nor lands. The flow itself can run again (React lets go of
  // it and takes it back in development).
  private run = 0;
  // The countdown's next second.
  private timer: ReturnType<typeof setTimeout> | undefined;
  // What stops watching the picture for its first moving frame.
  private untime: (() => void) | null = null;

  constructor(private readonly deps: TakeDeps) {}

  /** The microphone's recorder while a Take holds it (counting down or recording): the meter reads it. */
  get mic(): TakeRecorder | null {
    return this.recorder;
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private go(event: TakeEvent) {
    const next = takeStep(this.state, event);
    if (next === this.state) return;
    this.state = next;
    for (const listener of this.listeners) listener();
  }

  /**
   * The mic button, Space or Shift+R: a Take started from idle (at the Clip's end, the hint told
   * instead), its countdown cancelled, or the one recording stopped. While a Take waits, it says to
   * settle that one first.
   */
  press(): Promise<void> {
    const { state } = this;
    if (state.phase === "waiting") this.deps.tell(TAKE_WAITING);
    else if (canStart(state)) {
      if (!this.deps.atEnd?.()) return this.start();
      this.deps.tell(AT_END_HINT);
    } else if (counting(state)) this.cancel();
    else if (recording(state)) return this.stop();
    return Promise.resolve();
  }

  // The microphone opened (the picture paused where it is), then three seconds counted with the
  // playhead still and the meter moving, then the roll.
  private async start() {
    this.go({ type: "open" });
    const run = this.run;
    const { playback } = this.deps;
    if (playback.playing) playback.pause();
    let recorder: TakeRecorder;
    try {
      recorder = await this.deps.open(() => void this.stop("The Take stopped at eight minutes, the longest a Take can be."));
    } catch (reason) {
      if (run !== this.run) return;
      this.go({ type: "dropped" });
      this.deps.tell(microphoneTrouble(reason));
      return;
    }
    if (run !== this.run) return recorder.close();
    this.recorder = recorder;
    this.go({ type: "opened" });
    this.count(run);
  }

  // A second of the countdown gone: the next one, or the roll.
  private count(run: number) {
    this.timer = setTimeout(() => {
      if (run !== this.run || this.state.phase !== "countdown") return;
      if (this.state.left > 1) {
        this.go({ type: "tick" });
        this.count(run);
      } else {
        this.roll(run);
      }
    }, 1000);
  }

  // The picture rolled from the playhead, ignoring the Loop, with the bus silent (unless "Hear the
  // Clip" is on), and the Take recorded from that moment.
  private roll(run: number) {
    const recorder = this.recorder;
    if (!recorder) return;
    const { playback } = this.deps;
    const playhead = playback.time;
    if (!this.deps.hearClip?.()) this.deps.silence(true);
    playback.setLoop(null);
    const at = recorder.now();
    recorder.record();
    // From where it is: the Loop is off, so nothing moves it to In.
    playback.play();
    this.go({ type: "rolled", playhead, at, began: this.deps.now?.() ?? new Date() });
    this.timeRoll(run, recorder, playhead);
  }

  // The roll timed again by the picture itself: a video may take a moment to start after Play, and
  // the picture plays on the page's clock, not the recorder's. On the first frame it is seen to have
  // moved from the playhead, its time and the recorder's clock are read together, and the moment it
  // left the playhead is reckoned back from them, on the recorder's clock. Until then (or with no
  // frames to watch), the moment Play was asked stands.
  private timeRoll(run: number, recorder: TakeRecorder, playhead: number) {
    const { playback } = this.deps;
    if (!playback.subscribe) return;
    const unsubscribe = playback.subscribe(() => {
      if (run !== this.run || !recording(this.state)) return this.stopTiming();
      if (!playback.playing || playback.time <= playhead) return;
      this.stopTiming();
      this.go({ type: "timed", rolledAt: recorder.now() - (playback.time - playhead) });
    });
    this.untime = unsubscribe;
  }

  private stopTiming() {
    this.untime?.();
    this.untime = null;
  }

  /**
   * Esc while the microphone is asked for or the countdown runs: the microphone closed, nothing
   * recorded, uploaded or added. Nothing otherwise.
   */
  cancel(): boolean {
    if (!counting(this.state)) return false;
    this.run += 1;
    clearTimeout(this.timer);
    this.recorder?.close();
    this.recorder = null;
    this.go({ type: "cancel" });
    return true;
  }

  // The Take stopped (with `told` when it stopped itself): the picture paused and the bus heard, then
  // the Take uploaded and landed, Picked, with the playhead at its start.
  async stop(told?: string) {
    const state = this.state;
    const recorder = this.recorder;
    if (state.phase !== "recording" || !recorder) return;
    const run = this.run;
    this.recorder = null;
    this.stopTiming();
    const take = recorder.stop();
    const { playback } = this.deps;
    if (playback.playing) playback.pause();
    this.deps.silence(false);
    this.go({ type: "stopped", secs: take.secs, firstSample: take.firstSample, latency: recorder.latency });
    if (told) this.deps.tell(told);
    const uploading = this.state;
    if (uploading.phase !== "uploading" || take.secs <= 0) {
      this.go({ type: "dropped" });
      this.deps.tell("Nothing was recorded.");
      return;
    }
    await this.deliver(run, { wav: take.wav, name: takeName(state.began), start: uploading.start, secs: uploading.secs, media: null });
  }

  // The Take uploaded (unless it already is) and landed, Picked, with the playhead at its start; kept
  // in the tab when either fails. Once the editor has let go of the flow (`run` is over), nothing of
  // it goes on: no landing, no Pick, no seek and no Take kept, though an upload under way still
  // reaches the Media Library.
  private async deliver(run: number, take: WaitingTake) {
    const over = () => run !== this.run;
    let media = take.media;
    if (media === null) {
      try {
        media = (await this.deps.upload(new File([take.wav], take.name, { type: "audio/wav" }))).id;
      } catch (reason) {
        if (!over()) this.go({ type: "kept", take, why: `Couldn't upload the Take: ${(reason as Error).message}` });
        return;
      }
    }
    if (over()) return;
    const start = this.deps.land({ media, start: take.start, secs: take.secs });
    if (over()) return;
    if (start === null) {
      this.go({ type: "kept", take: { ...take, media }, why: "The Take is uploaded, but it couldn't be laid on the Timeline." });
      return;
    }
    this.deps.playback.seek(start);
    this.go({ type: "landed" });
  }

  /** Try again: the waiting Take uploaded (unless it already is) and landed where it was recorded. */
  retry(): Promise<void> {
    const state = this.state;
    if (state.phase !== "waiting") return Promise.resolve();
    this.go({ type: "retry" });
    return this.deliver(this.run, state.take);
  }

  /** Save WAV: the waiting Take downloaded under its name; it keeps waiting. */
  save() {
    const state = this.state;
    if (state.phase !== "waiting") return;
    this.deps.save?.(new Blob([state.take.wav], { type: "audio/wav" }), state.take.name);
  }

  /** Discard: the waiting Take let go. */
  discard() {
    this.go({ type: "discard" });
  }

  /**
   * The editor let go of it (closed, remounted, or the page left): the microphone released, the bus
   * heard again, and the Take under way neither rolled nor landed (an upload under way still reaches
   * the Media Library, but lands nothing).
   */
  dispose() {
    this.run += 1;
    clearTimeout(this.timer);
    this.stopTiming();
    if (this.recorder) {
      const rolled = recording(this.state);
      this.recorder.close();
      this.recorder = null;
      if (rolled) {
        if (this.deps.playback.playing) this.deps.playback.pause();
        this.deps.silence(false);
      }
    }
    this.go({ type: "dropped" });
  }
}

/**
 * While leaving would lose a Take (asksBeforeLeaving: counting down, recording, uploading, or
 * waiting in the tab), leaving or closing the tab asks first (`beforeunload` on `target`, the window);
 * and once the page is left (`pagehide`), a Take holding the microphone is cancelled. Returns what
 * takes both away.
 */
export function guardLeaving(target: Pick<EventTarget, "addEventListener" | "removeEventListener">, flow: TakeFlow): () => void {
  const ask = (event: Event) => {
    if (!asksBeforeLeaving(flow.state)) return;
    event.preventDefault();
  };
  // A Take uploading or waiting isn't let go: there is no microphone to release, and the tab may come
  // back (the browser's back-forward cache), its upload answered.
  const left = () => {
    if (holdsMicrophone(flow.state)) flow.dispose();
  };
  target.addEventListener("beforeunload", ask);
  target.addEventListener("pagehide", left);
  return () => {
    target.removeEventListener("beforeunload", ask);
    target.removeEventListener("pagehide", left);
  };
}
