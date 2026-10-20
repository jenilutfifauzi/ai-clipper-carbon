import { rememberedValue } from "../../../remembered";
import { FLOOR_DB } from "./ballistics";
import { openTake, type RecorderDeps, type TakeRecorder } from "./takeRecorder";

/**
 * The recording settings (.scratch/voiceover/spec.md, Settings; ADR 0018): the popover beside the mic
 * button holds the choice of microphone, "Hear the Clip (headphones)" and a test meter. The choice
 * and the switch are remembered per browser, every read and write of localStorage wrapped (as the
 * workspace layout is): broken storage leaves the defaults, and a change lasts for the page's life.
 * No React: the popover (TakeSettingsButton) and the take flow read it.
 */

/** What is remembered: the input chosen (null: the browser's default) and "Hear the Clip". */
export interface TakeSettings {
  deviceId: string | null;
  hearClip: boolean;
}

export const DEFAULT_TAKE_SETTINGS: TakeSettings = { deviceId: null, hearClip: false };

export const SETTINGS_KEY = "ai-clipper-take-settings";

/** One of the browser's inputs, as the popover lists it. */
export interface Input {
  deviceId: string;
  label: string;
}

/** A stored blob as settings: anything stale or bad reads as the defaults. */
export function parseTakeSettings(value: unknown): TakeSettings {
  if (!value || typeof value !== "object") return DEFAULT_TAKE_SETTINGS;
  const { deviceId, hearClip } = value as Record<string, unknown>;
  return {
    deviceId: typeof deviceId === "string" && deviceId ? deviceId : null,
    hearClip: hearClip === true,
  };
}

// The browser's own entries for its default input ("default", and Windows' "communications"): the
// popover's Default stands for them.
const ALIASES = new Set(["default", "communications"]);

/**
 * The audio inputs of `enumerateDevices`, in its order, without the default's own entries. Until the
 * microphone is allowed the browser gives no labels: they are named by number.
 */
export function audioInputs(devices: readonly MediaDeviceInfo[]): Input[] {
  return devices
    .filter((device) => device.kind === "audioinput" && !ALIASES.has(device.deviceId))
    .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `Microphone ${index + 1}` }));
}

/**
 * The input a Take opens: the remembered one while it is among `inputs`, else the default (null). Not
 * yet listed, or listed before permission (the browser hides the ids), the remembered one is tried:
 * the opener falls back to the default if it is gone.
 */
export function resolveInput(chosen: string | null, inputs: readonly Input[] | null): string | null {
  if (!chosen) return null;
  if (!inputs || !inputs.some((input) => input.deviceId)) return chosen;
  return inputs.some((input) => input.deviceId === chosen) ? chosen : null;
}

/** What getUserMedia rejects with when the input asked for is gone. */
const GONE = new Set(["OverconstrainedError", "NotFoundError"]);

/** The browser's devices, as the settings list and watch them. */
export type SettingsDevices = Pick<MediaDevices, "enumerateDevices" | "addEventListener" | "removeEventListener">;

export interface SettingsDeps {
  devices: SettingsDevices;
  recorder: RecorderDeps;
  // Whether a Take holds the microphone (the take flow's holdsMicrophone: being opened, counting down
  // or recording): no test meter opens then. A Take uploading or waiting in the tab doesn't hold it.
  busy?: () => boolean;
}

/** The settings as the popover shows them. */
export interface SettingsState {
  // The inputs listed, null before the browser has answered.
  inputs: Input[] | null;
  // The input chosen (remembered), which may be gone.
  chosen: string | null;
  hearClip: boolean;
  // Whether the test meter reads the microphone.
  testing: boolean;
  // Why the test meter couldn't open the microphone.
  error: string | null;
}

export class RecordingSettings {
  state: SettingsState;
  private readonly store = rememberedValue<unknown>(SETTINGS_KEY, DEFAULT_TAKE_SETTINGS);
  private listeners = new Set<() => void>();
  private recorder: TakeRecorder | null = null;
  // Counted up when the test meter is closed (or moved): an open asked for before then is let go.
  private run = 0;

  constructor(private readonly deps: SettingsDeps) {
    const remembered = parseTakeSettings(this.store.read());
    this.state = { inputs: null, chosen: remembered.deviceId, hearClip: remembered.hearClip, testing: false, error: null };
    void this.refresh();
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  private change(patch: Partial<SettingsState>) {
    this.state = { ...this.state, ...patch };
    for (const listener of this.listeners) listener();
  }

  private remember() {
    this.store.set({ deviceId: this.state.chosen, hearClip: this.state.hearClip } satisfies TakeSettings);
  }

  /** The input the next Take records from: null for the default. */
  get deviceId(): string | null {
    return resolveInput(this.state.chosen, this.state.inputs);
  }

  /** Whether the master bus stays audible while recording (for headphones). */
  get hearClip(): boolean {
    return this.state.hearClip;
  }

  /** The test meter's recorder while it reads the microphone. */
  get test(): TakeRecorder | null {
    return this.recorder;
  }

  /** The test meter's level now, in dB (FLOOR_DB while closed). */
  testLevel(): number {
    return this.recorder?.meter.left.level ?? FLOOR_DB;
  }

  /** The inputs listed again (labels come once the microphone is allowed). */
  async refresh(): Promise<void> {
    let devices: MediaDeviceInfo[];
    try {
      devices = await this.deps.devices.enumerateDevices();
    } catch {
      return;
    }
    const before = this.deviceId;
    this.change({ inputs: audioInputs(devices) });
    // The input the test meter read was pulled: it reads the default now.
    if (this.recorder && this.deviceId !== before) void this.openTest();
  }

  /** Listening for inputs plugged in or pulled; returns what stops it. */
  watch(): () => void {
    const changed = () => void this.refresh();
    this.deps.devices.addEventListener("devicechange", changed);
    return () => this.deps.devices.removeEventListener("devicechange", changed);
  }

  /** The input chosen (null: the default), remembered; the test meter, if open, reads it. */
  choose(deviceId: string | null) {
    this.change({ chosen: deviceId || null });
    this.remember();
    if (this.recorder) void this.openTest();
  }

  setHearClip(on: boolean) {
    this.change({ hearClip: on });
    this.remember();
  }

  /**
   * The test meter opened on the chosen input (or moved to it), while the popover is open; not while a
   * Take holds the microphone. What went wrong is kept in `error`.
   */
  async openTest(): Promise<void> {
    this.release();
    if (this.deps.busy?.()) return;
    const run = this.run;
    let recorder: TakeRecorder;
    try {
      recorder = await this.open(this.deviceId);
    } catch (reason) {
      if (run === this.run) this.change({ testing: false, error: (reason as Error).message || "The microphone couldn't be opened." });
      return;
    }
    if (run !== this.run) return recorder.close();
    this.recorder = recorder;
    this.change({ testing: true, error: null });
    // Allowed now: the inputs' labels.
    void this.refresh();
  }

  /** The test meter closed with the popover: the microphone let go. */
  closeTest() {
    this.release();
    if (this.state.testing || this.state.error) this.change({ testing: false, error: null });
  }

  private release() {
    this.run += 1;
    this.recorder?.close();
    this.recorder = null;
  }

  /**
   * The microphone opened for a Take on the chosen input (the take flow's `open`): the test meter
   * closed first, so that only one is open, and the default taken if the chosen one is gone.
   */
  async openTake(capped: () => void): Promise<TakeRecorder> {
    this.closeTest();
    await this.refresh();
    return this.open(this.deviceId, capped);
  }

  private async open(deviceId: string | null, capped?: () => void): Promise<TakeRecorder> {
    try {
      return await openTake(this.deps.recorder, { deviceId, capped });
    } catch (reason) {
      if (!deviceId || !GONE.has((reason as Error).name)) throw reason;
      return openTake(this.deps.recorder, { capped });
    }
  }
}

/** The settings as the browser makes them. */
export const browserSettings = (recorder: RecorderDeps, busy: () => boolean) =>
  new RecordingSettings({ devices: navigator.mediaDevices, recorder, busy });
