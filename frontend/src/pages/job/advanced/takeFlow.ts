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
 *
 * Cancelled (Esc) while opening or counting down, it goes back to idle with nothing kept; and back to
 * idle when the microphone can't be opened or the upload fails, with what went wrong told. A failed
 * state that keeps the Take (05) goes beside uploading.
 */
export type TakeState =
  | { phase: "idle" }
  // Asking for the microphone.
  | { phase: "opening" }
  // The microphone open, its meter moving, the playhead still: `left` seconds before the picture rolls.
  | { phase: "countdown"; left: number }
  // The picture rolled from `playhead` at `rolledAt` on the recorder's clock, at `began` local time.
  | { phase: "recording"; playhead: number; rolledAt: number; began: Date }
  // The Take, stopped, on its way to the Media Library, to land at `landing` for `secs`.
  | { phase: "uploading"; landing: number; secs: number };

export type TakeEvent =
  | { type: "open" }
  | { type: "opened" }
  | { type: "tick" }
  | { type: "cancel" }
  | { type: "rolled"; playhead: number; at: number; began: Date }
  | { type: "stopped"; secs: number; firstSample: number | null }
  | { type: "landed" }
  | { type: "failed" };

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
      return state.phase === "opening" || state.phase === "countdown" ? IDLE : state;
    case "rolled":
      return state.phase === "countdown" ? { phase: "recording", playhead: event.playhead, rolledAt: event.at, began: event.began } : state;
    case "stopped":
      return state.phase === "recording" ? { phase: "uploading", landing: landing(state.playhead, state.rolledAt, event.firstSample), secs: event.secs } : state;
    case "landed":
      return state.phase === "uploading" ? IDLE : state;
    case "failed":
      return IDLE;
  }
}

/** Whether a Take is under way: Space and Shift+R stop it, and the button reads Stop. */
export const recording = (state: TakeState) => state.phase === "recording";

/** Whether the countdown runs (or the microphone is being asked for): Esc cancels it. */
export const counting = (state: TakeState) => state.phase === "opening" || state.phase === "countdown";

/** Whether the mic button starts a Take now: from idle only. */
export const canStart = (state: TakeState) => state.phase === "idle";

/**
 * Whether hand edits are locked (the Timeline, the inspector and the editing shortcuts): from the
 * press until the Take has landed. Edits from elsewhere still arrive (edit-sync).
 */
export const locksEditing = (state: TakeState) => state.phase !== "idle";

/** Whether leaving the page asks first: while the countdown runs or the Take records, not otherwise. */
export const asksBeforeLeaving = (state: TakeState) => state.phase === "countdown" || state.phase === "recording";

/** The playback as the take flow drives it. */
export interface TakePlayback {
  readonly time: number;
  readonly playing: boolean;
  play: (from?: number) => void;
  pause: () => void;
  seek: (time: number) => void;
  setLoop: (region: null) => void;
}

/** The Music Clip a Take lands as: `media` its item, at `start` for `secs`. */
export interface LandedTake {
  media: string;
  start: number;
  secs: number;
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
  // neither rolls nor lands.
  private run = 0;
  // The countdown's next second.
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly deps: TakeDeps) {}

  /** The microphone's recorder while it is open (counting down or recording): the meter reads it. */
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
   * The mic button, Space or Shift+R: a Take started from idle (not at the Clip's end), its countdown
   * cancelled, or the one recording stopped.
   */
  press(): Promise<void> {
    if (canStart(this.state)) return this.deps.atEnd?.() ? Promise.resolve() : this.start();
    if (counting(this.state)) {
      this.cancel();
      return Promise.resolve();
    }
    if (recording(this.state)) return this.stop();
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
      this.go({ type: "failed" });
      this.deps.tell(`Couldn't open the microphone: ${(reason as Error).message}`);
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
        this.roll();
      }
    }, 1000);
  }

  // The picture rolled from the playhead, ignoring the Loop, with the bus silent (unless "Hear the
  // Clip" is on), and the Take recorded from that moment.
  private roll() {
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
    const take = recorder.stop();
    const { playback } = this.deps;
    if (playback.playing) playback.pause();
    this.deps.silence(false);
    this.go({ type: "stopped", secs: take.secs, firstSample: take.firstSample });
    if (told) this.deps.tell(told);
    const uploading = this.state;
    if (uploading.phase !== "uploading" || take.secs <= 0) {
      this.go({ type: "failed" });
      this.deps.tell("Nothing was recorded.");
      return;
    }
    let item: MediaItem;
    try {
      item = await this.deps.upload(new File([take.wav], takeName(state.began), { type: "audio/wav" }));
    } catch (reason) {
      if (run !== this.run) return;
      this.go({ type: "failed" });
      this.deps.tell(`Couldn't upload the Take: ${(reason as Error).message}`);
      return;
    }
    if (run !== this.run) return;
    const start = this.deps.land({ media: item.id, start: uploading.landing, secs: uploading.secs });
    if (start !== null) playback.seek(start);
    this.go({ type: "landed" });
  }

  /**
   * The editor let go of it (closed, remounted, or the page left): the microphone released, the bus
   * heard again, and the Take under way neither rolled nor landed (an upload under way still reaches
   * the Media Library).
   */
  dispose() {
    this.run += 1;
    clearTimeout(this.timer);
    if (this.recorder) {
      const rolled = recording(this.state);
      this.recorder.close();
      this.recorder = null;
      if (rolled) {
        if (this.deps.playback.playing) this.deps.playback.pause();
        this.deps.silence(false);
      }
    }
    this.go({ type: "failed" });
  }
}

/**
 * While the countdown runs or the Take records, leaving or closing the tab asks first (`beforeunload`
 * on `target`, the window); and once the page is left (`pagehide`), the Take is cancelled. Returns
 * what takes both away.
 */
export function guardLeaving(target: Pick<EventTarget, "addEventListener" | "removeEventListener">, flow: TakeFlow): () => void {
  const ask = (event: Event) => {
    if (!asksBeforeLeaving(flow.state)) return;
    event.preventDefault();
  };
  const left = () => {
    if (asksBeforeLeaving(flow.state) || counting(flow.state)) flow.dispose();
  };
  target.addEventListener("beforeunload", ask);
  target.addEventListener("pagehide", left);
  return () => {
    target.removeEventListener("beforeunload", ask);
    target.removeEventListener("pagehide", left);
  };
}
