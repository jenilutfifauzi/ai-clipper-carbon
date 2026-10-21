import { narrationEventsUrl, type MediaItem, type NarrationProgress, type NarrationRequest, type Voice, type VoiceEngine, type VoicesList } from "../../../api";
import { formatClock } from "../../../format";
import { rememberedValue } from "../../../remembered";
import type { LandedTake } from "./takeFlow";

/**
 * The Narrate tab's flow (.scratch/text-to-speech/spec.md, ADR 0019): from Generate to a Music Clip
 * marked Speech on the Timeline. The backend reads the script (app/narration.py); `NarrateFlow` starts
 * it, follows its progress and lands the item through the same action that lands a Take, at the start
 * fixed when Generate was pressed (the playhead then). It keeps the tab's draft (script, engine, Voice,
 * Speed, pause and Style),
 * so that a failure, a cancel or a tab switch never loses it. No React.
 *
 *   idle → making (progress; Cancel → idle) → idle (landed, or kept in the Media tab when refused)
 *             ↘ failed (its message; the draft stays) → making (Generate again)
 */
export type NarrateState =
  | { phase: "idle" }
  // The backend reading the script, as far as `progress` (null until it first tells); it lands at `start`.
  | { phase: "making"; start: number; progress: NarrationProgress | null }
  | { phase: "failed"; message: string };

// What the owner has set in the tab: the script, the engine and Voice (null: the remembered or the
// default one, chosenVoice), the Speed, the pause stop and the Style line (sent only to an engine that
// takes one).
export interface NarrateDraft {
  script: string;
  engine: string | null;
  voice: string | null;
  speed: number;
  pause: number;
  style: string;
}

// The last engine and Voice chosen, remembered by the browser for every Job.
export interface RememberedVoice {
  engine: string;
  voice: string | null;
}
export const rememberedVoice = rememberedValue<RememberedVoice | null>("narrate.voice", null);

/** Remembers the engine and Voice of a change to the draft that chose one (one that names its engine). */
export function rememberChoice(change: Partial<NarrateDraft>) {
  if (change.engine) rememberedVoice.set({ engine: change.engine, voice: change.voice ?? null });
}

// The longest script the backend reads (app/narration.py's MAX_CHARS).
export const MAX_SCRIPT_CHARS = 5000;

// The pause slider's stops: the silence between two sentences, in seconds (0–1.5).
export const PAUSE_STOPS = [
  { label: "None", secs: 0 },
  { label: "Natural", secs: 0.3 },
  { label: "Long", secs: 0.8 },
  { label: "Longer", secs: 1.5 },
] as const;
export const DEFAULT_PAUSE = 1;

// The Speed a Narration is read at (app/narration.py's MIN_SPEED and MAX_SPEED), and its slider's step.
export const NARRATION_SPEEDS = [0.5, 2] as const;
export const NARRATION_SPEED_STEP = 0.05;
export const DEFAULT_SPEED = 1;

export const EMPTY_DRAFT: NarrateDraft = { script: "", engine: null, voice: null, speed: DEFAULT_SPEED, pause: DEFAULT_PAUSE, style: "" };

// How many characters a Voice reads a second at 1×, by the Job's language; others read at the default.
// Indonesian's longer words take a little longer to say than English's.
export const CHARS_PER_SECOND: Record<string, number> = { en: 15, id: 14 };
export const DEFAULT_CHARS_PER_SECOND = 14;

/** What the script will take to read, for the line under it: "About 0:42 · 590 characters", from the
 * characters of the trimmed script at the language's pace (CHARS_PER_SECOND) times `speed`. Null for
 * an empty script. The pauses aren't counted. */
export function narrationEstimate(script: string, language: string, speed: number): string | null {
  const chars = script.trim().length;
  if (!chars) return null;
  const secs = Math.round(chars / (CHARS_PER_SECOND[language] ?? DEFAULT_CHARS_PER_SECOND) / speed);
  return `About ${formatClock(secs)} · ${chars.toLocaleString("en")} ${chars === 1 ? "character" : "characters"}`;
}

/** What Generate asks the backend for, of the draft read by `voice` of `engine`: the trimmed script, the
 * Speed, the pause stop's seconds, and the trimmed Style only when the engine takes one and it isn't blank. */
export function narrationBody(engine: VoiceEngine, voice: string, draft: NarrateDraft): NarrationRequest {
  const style = engine.takes_style ? draft.style.trim() : "";
  const body: NarrationRequest = { text: draft.script.trim(), engine: engine.id, voice, speed: draft.speed, pauses: PAUSE_STOPS[draft.pause].secs };
  return style ? { ...body, style } : body;
}

/** Why a script can't be read for its length, in the estimate's place: null within MAX_SCRIPT_CHARS. */
export function scriptTooLong(script: string): string | null {
  const chars = script.trim().length;
  if (chars <= MAX_SCRIPT_CHARS) return null;
  return `A script can be ${MAX_SCRIPT_CHARS.toLocaleString("en")} characters at most: this one has ${chars.toLocaleString("en")}`;
}

// Told when the Narration is made but can't land (a locked Music Track): it waits in the Media tab.
export const NARRATION_IN_LIBRARY = "The Narration is in the Media tab: the Music Track is locked";
// Told when a cancel came too late: the Narration was made, and waits in the Media tab, unlaid.
export const NARRATION_MADE_BEFORE_CANCEL = "The Narration was made before the cancel: it is in the Media tab";
// Why Generate is off with the playhead at the Clip's end.
export const NARRATE_AT_END_HINT = "Move the playhead into the Clip to narrate: a Narration from its end would never be heard";

// What a Narration's events stream tells (listenNarration).
export interface NarrationListener {
  progress: (progress: NarrationProgress) => void;
  done: (item: MediaItem) => void;
  failed: (message: string) => void;
  cancelled: () => void;
}

/** How an engine is labelled in the tab: where its words go. */
export const engineLabel = (engine: VoiceEngine) => (engine.local ? "On this Mac" : `${engine.service ?? engine.label} · cloud`);

/** An engine in the engine picker: a cloud one by its service ("Gemini · cloud"), a local one by its
 * name too ("Kokoro · On this Mac"). */
export const engineOption = (engine: VoiceEngine) => (engine.local ? `${engine.label} · ${engineLabel(engine)}` : engineLabel(engine));

/**
 * The engine and Voice the tab reads with, of the ready engines: the draft's choice, else the one the
 * browser remembers, else the default for the Job's language (VoicesList.default), else the first ready.
 * The Voice is the draft's or the remembered one when that engine has it, else the engine's first.
 * Null when no engine is ready.
 */
export function chosenVoice(
  voices: VoicesList,
  draft: Pick<NarrateDraft, "engine" | "voice">,
  remembered: RememberedVoice | null,
): { engine: VoiceEngine; voice: Voice | null } | null {
  const ready = voices.engines.filter((engine) => engine.ready);
  const find = (id: string | null | undefined) => (id ? ready.find((engine) => engine.id === id) : undefined);
  const engine = find(draft.engine) ?? find(remembered?.engine) ?? find(voices.default) ?? ready[0];
  if (!engine) return null;
  const has = (id: string | null | undefined) => (id ? engine.voices.find((voice) => voice.id === id) : undefined);
  const voice = has(draft.voice) ?? (remembered?.engine === engine.id ? has(remembered.voice) : undefined) ?? engine.voices[0] ?? null;
  return { engine, voice };
}

/** What the flow runs on: the backend, the edit that lands the item, and the Media Library's list. */
export interface NarrateDeps {
  // Starts a Narration: its id, or rejects (busy, a script that can't be narrated) with the reason.
  start: (body: NarrationRequest) => Promise<string>;
  // Follows Narration `id` until its outcome; returns what stops following it.
  listen: (id: string, on: NarrationListener) => () => void;
  // Cancels Narration `id`; rejects when it has ended already.
  cancel: (id: string) => Promise<void>;
  // Where the playhead is: the start Generate fixes.
  playhead: () => number;
  // Lands the item as a Music Clip marked Speech (actions.ts' `landTake`); null when refused.
  land: (landed: LandedTake) => number | null;
  // The new item, listed in the Media Library's tabs.
  added: (item: MediaItem) => void;
  tell: (text: string) => void;
}

// A Narration asked for: its id once the backend answers, and whether the owner cancelled it.
interface Run {
  id: string | null;
  cancelled: boolean;
}

/** The Narrate tab's Generate and Cancel, and its draft: `subscribe`, `state` and `draft` are for the
 * tab (useSyncExternalStore). */
export class NarrateFlow {
  state: NarrateState = { phase: "idle" };
  draft: NarrateDraft = EMPTY_DRAFT;
  private listeners = new Set<() => void>();
  // The run being made (null once it ends or is cancelled), and what stops following each run still
  // followed: a cancelled one is followed to its end, for a cancel that came too late.
  private run: Run | null = null;
  private following = new Set<() => void>();

  constructor(private deps: NarrateDeps) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** The owner changed the tab's script, engine, Voice, Speed, pause or Style. */
  edit = (change: Partial<NarrateDraft>) => {
    this.draft = { ...this.draft, ...change };
    this.notify();
  };

  /** Reads `body` aloud, to land at `start`: the playhead now, whatever it does meanwhile. */
  async generate(body: NarrationRequest, start = this.deps.playhead()): Promise<void> {
    if (this.state.phase === "making") return;
    const run: Run = { id: null, cancelled: false };
    this.run = run;
    this.set({ phase: "making", start, progress: null });
    try {
      run.id = await this.deps.start(body);
    } catch (reason) {
      if (this.run !== run) return;
      this.run = null;
      this.set({ phase: "failed", message: reason instanceof Error ? reason.message : String(reason) });
      return;
    }
    const id = run.id;
    if (run.cancelled) void this.deps.cancel(id).catch(() => {});
    const current = () => this.run === run;
    // Its stream is let go of at its end, which may come before `listen` returns (a replayed outcome).
    let stop: (() => void) | null = null;
    let ended = false;
    const end = () => {
      ended = true;
      if (stop) {
        stop();
        this.following.delete(stop);
      }
      if (current()) this.run = null;
    };
    stop = this.deps.listen(id, {
      progress: (progress) => {
        if (current()) this.set({ phase: "making", start, progress });
      },
      done: (item) => {
        const landing = current();
        end();
        this.deps.added(item);
        if (!landing) this.deps.tell(NARRATION_MADE_BEFORE_CANCEL);
        else {
          if (this.deps.land({ media: item.id, start, secs: item.duration ?? 0 }) === null) this.deps.tell(NARRATION_IN_LIBRARY);
          this.set({ phase: "idle" });
        }
      },
      failed: (message) => {
        const failing = current();
        end();
        if (failing) this.set({ phase: "failed", message });
      },
      cancelled: end,
    });
    if (ended) stop();
    else this.following.add(stop);
  }

  /** Stops the Narration being made: the backend discards it before its next sentence; the draft stays. */
  cancel = () => {
    const run = this.run;
    if (!run || this.state.phase !== "making") return;
    run.cancelled = true;
    this.run = null;
    if (run.id) void this.deps.cancel(run.id).catch(() => {});
    this.set({ phase: "idle" });
  };

  /** The editor lets go of the flow: a Narration being made is still added, unlaid. */
  dispose() {
    for (const stop of this.following) stop();
    this.following.clear();
    this.run = null;
  }

  private set(state: NarrateState) {
    this.state = state;
    this.notify();
  }

  private notify() {
    for (const listener of this.listeners) listener();
  }
}

/** Follows a Narration's events from the backend; EventSource reconnects by itself, and is told again. */
export function listenNarration(id: string, on: NarrationListener): () => void {
  const source = new EventSource(narrationEventsUrl(id));
  source.addEventListener("progress", (event) => on.progress(JSON.parse((event as MessageEvent).data)));
  source.addEventListener("cancelled", () => {
    source.close();
    on.cancelled();
  });
  source.addEventListener("done", (event) => {
    source.close();
    on.done(JSON.parse((event as MessageEvent).data));
  });
  source.addEventListener("failed", (event) => {
    source.close();
    on.failed(JSON.parse((event as MessageEvent).data).message);
  });
  return () => source.close();
}
