// .scratch/voiceover/issues/04-recording-settings.md: the popover beside the mic button. The choice of
// microphone (listed from the browser's inputs), "Hear the Clip (headphones)" and a test meter; both
// settings remembered in localStorage. On fakes: `enumerateDevices`, `getUserMedia`, the capture and
// localStorage. No jsdom: the popover's markup is checked with renderToStaticMarkup.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { MediaItem } from "../../../api";
import { FLOOR_DB } from "./ballistics";
import { audioInputs, RecordingSettings, resolveInput, SETTINGS_KEY, type SettingsDevices } from "./recordingSettings";
import { TakeSettingsButton } from "./TakeButton";
import { TakeFlow, type TakePlayback } from "./takeFlow";
import type { Block, RecorderDeps } from "./takeRecorder";
import { TAKE_RATE } from "./voiceover";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const device = (deviceId: string, label: string, kind: MediaDeviceKind = "audioinput") => ({ deviceId, label, kind, groupId: "" }) as MediaDeviceInfo;

const LAPTOP = device("laptop", "MacBook Pro Microphone");
const USB = device("usb", "Shure MV7");

// A localStorage of a Map, or one that throws on every read and write.
function storage(broken = false) {
  const map = new Map<string, string>();
  const fail = () => {
    throw new Error("SecurityError");
  };
  vi.stubGlobal("localStorage", {
    getItem: broken ? fail : (key: string) => map.get(key) ?? null,
    setItem: broken ? fail : (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  });
  return map;
}

// The browser's inputs (`list`, changed and `change()`d as a plug is pulled), and a microphone that
// gives each opened input's blocks to `speak`.
function browser(list: MediaDeviceInfo[] = [device("default", "Default - MacBook Pro Microphone"), LAPTOP, USB, device("speakers", "Speakers", "audiooutput")]) {
  const devices = { list };
  const listeners = new Set<() => void>();
  const mediaDevices: SettingsDevices = {
    enumerateDevices: async () => devices.list,
    addEventListener: (_type: string, listener: () => void) => void listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => void listeners.delete(listener),
  } as unknown as SettingsDevices;
  const asked: (string | null)[] = [];
  const closed: string[] = [];
  let block: Block = () => {};
  const recorder: RecorderDeps = {
    getUserMedia: async (constraints) => {
      const wanted = (constraints.audio as MediaTrackConstraints).deviceId as { exact: string } | undefined;
      const id = wanted?.exact ?? null;
      if (id && !devices.list.some((input) => input.deviceId === id)) throw Object.assign(new Error("gone"), { name: "OverconstrainedError" });
      asked.push(id);
      return { getTracks: () => [{ stop: () => closed.push(`track ${id ?? "default"}`) }] } as unknown as MediaStream;
    },
    capture: async (_stream, onBlock) => {
      block = onBlock;
      return { now: () => 0, rate: TAKE_RATE, close: () => closed.push("capture") };
    },
  };
  const speak = (level: number) => block(0, new Float32Array(4800).fill(level));
  const change = () => listeners.forEach((listener) => listener());
  return { devices, mediaDevices, recorder, asked, closed, speak, change, listeners };
}

const settle = () => vi.advanceTimersByTimeAsync(0);

describe("the inputs", () => {
  test("listed from the browser's audio inputs, the default's own entry left to Default", () => {
    expect(audioInputs([device("default", "Default - X"), LAPTOP, USB, device("cam", "FaceTime", "videoinput")])).toEqual([
      { deviceId: "laptop", label: "MacBook Pro Microphone" },
      { deviceId: "usb", label: "Shure MV7" },
    ]);
  });

  test("named by number until permission gives their labels", () => {
    expect(audioInputs([device("a", ""), device("b", "")])).toEqual([
      { deviceId: "a", label: "Microphone 1" },
      { deviceId: "b", label: "Microphone 2" },
    ]);
  });

  test("a remembered input that is gone falls back to the default; one not yet known is tried", () => {
    const inputs = [{ deviceId: "laptop", label: "" }];
    expect(resolveInput("usb", inputs)).toBeNull();
    expect(resolveInput("laptop", inputs)).toBe("laptop");
    expect(resolveInput(null, inputs)).toBeNull();
    // Before permission the browser hides the ids: the remembered one is tried, and falls back if it fails.
    expect(resolveInput("usb", [{ deviceId: "", label: "Microphone 1" }])).toBe("usb");
  });

  test("the popover lists them, the chosen one selected, and hears a plug pulled", async () => {
    storage();
    const it = browser();
    const settings = new RecordingSettings({ devices: it.mediaDevices, recorder: it.recorder });
    const unwatch = settings.watch();
    await settle();
    settings.choose("usb");
    const html = renderToStaticMarkup(<TakeSettingsButton settings={settings} />);
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain('aria-label="Recording settings"');
    const options = [...html.matchAll(/<option value="([^"]*)"[^>]*>(.*?)<\/option>/g)].map((option) => [option[1], option[2]]);
    expect(options).toEqual([
      ["", "Default"],
      ["laptop", "MacBook Pro Microphone"],
      ["usb", "Shure MV7"],
    ]);
    expect(html).toMatch(/<option value="usb" selected="">/);
    expect(html).toContain("Hear the Clip (headphones)");

    it.devices.list = [LAPTOP];
    it.change();
    await settle();
    expect(settings.state.inputs?.map((input) => input.deviceId)).toEqual(["laptop"]);
    expect(settings.deviceId).toBeNull();
    unwatch();
    expect(it.listeners.size).toBe(0);
  });

  test("the chevron is off while a Take counts down or records", () => {
    storage();
    const it = browser();
    const settings = new RecordingSettings({ devices: it.mediaDevices, recorder: it.recorder });
    expect(renderToStaticMarkup(<TakeSettingsButton settings={settings} busy={false} />)).not.toMatch(/<button[^>]* disabled=""/);
    expect(renderToStaticMarkup(<TakeSettingsButton settings={settings} busy />)).toMatch(/<button[^>]* disabled=""[^>]*aria-haspopup/);
  });
});

// A take flow on a still playback, opened through the settings, uploading at once.
function takeFlow(settings: RecordingSettings, silent: boolean[]) {
  const playback: TakePlayback = { time: 1, playing: false, play: () => {}, pause: () => {}, seek: () => {}, setLoop: () => {} };
  return new TakeFlow({
    open: (capped) => settings.openTake(capped),
    playback,
    silence: (on) => silent.push(on),
    hearClip: () => settings.hearClip,
    upload: async () => ({ id: "item" }) as MediaItem,
    land: () => 1,
    tell: () => {},
  });
}

describe("the chosen input", () => {
  test("the next Take records from it", async () => {
    storage();
    const it = browser();
    const settings = new RecordingSettings({ devices: it.mediaDevices, recorder: it.recorder });
    settings.choose("usb");
    const flow = takeFlow(settings, []);
    await flow.press();
    await settle();
    expect(flow.state.phase).toBe("countdown");
    expect(it.asked).toEqual(["usb"]);
  });

  test("one gone by the time the Take starts falls back to the default", async () => {
    storage();
    const it = browser();
    const settings = new RecordingSettings({ devices: it.mediaDevices, recorder: it.recorder });
    await settle();
    settings.choose("usb");
    it.devices.list = [LAPTOP];
    const flow = takeFlow(settings, []);
    await flow.press();
    await settle();
    expect(flow.state.phase).toBe("countdown");
    expect(it.asked).toEqual([null]);
  });

  test("a Take closes the test meter first, so that only one microphone is open", async () => {
    storage();
    const it = browser();
    const settings = new RecordingSettings({ devices: it.mediaDevices, recorder: it.recorder });
    await settings.openTest();
    expect(settings.test).not.toBeNull();
    const flow = takeFlow(settings, []);
    await flow.press();
    await settle();
    expect(settings.test).toBeNull();
    expect(it.closed).toEqual(["capture", "track default"]);
  });

  test("the test meter isn't opened while a Take is under way", async () => {
    storage();
    const it = browser();
    let busy = true;
    const settings = new RecordingSettings({ devices: it.mediaDevices, recorder: it.recorder, busy: () => busy });
    await settings.openTest();
    expect(settings.test).toBeNull();
    expect(it.asked).toEqual([]);
    busy = false;
    await settings.openTest();
    expect(settings.test).not.toBeNull();
  });
});

describe("Hear the Clip", () => {
  async function recordWith(hear: boolean) {
    storage();
    const it = browser();
    const settings = new RecordingSettings({ devices: it.mediaDevices, recorder: it.recorder });
    settings.setHearClip(hear);
    const silent: boolean[] = [];
    const flow = takeFlow(settings, silent);
    await flow.press();
    await settle();
    vi.advanceTimersByTime(3000);
    expect(flow.state.phase).toBe("recording");
    const during = [...silent];
    it.speak(0.25);
    await flow.press();
    await settle();
    return { during, after: silent };
  }

  test("on, the bus stays audible while recording", async () => {
    const { during, after } = await recordWith(true);
    expect(during).not.toContain(true);
    expect(after.at(-1) ?? false).toBe(false);
  });

  test("off, the bus is silent while recording, and heard again after", async () => {
    const { during, after } = await recordWith(false);
    expect(during).toEqual([true]);
    expect(after).toEqual([true, false]);
  });
});

describe("remembered", () => {
  test("both settings survive a reload", () => {
    const map = storage();
    const it = browser();
    const before = new RecordingSettings({ devices: it.mediaDevices, recorder: it.recorder });
    expect(before.state).toMatchObject({ chosen: null, hearClip: false });
    before.choose("usb");
    before.setHearClip(true);
    expect(JSON.parse(map.get(SETTINGS_KEY)!)).toEqual({ deviceId: "usb", hearClip: true });
    const after = new RecordingSettings({ devices: it.mediaDevices, recorder: it.recorder });
    expect(after.state).toMatchObject({ chosen: "usb", hearClip: true });
    expect(after.hearClip).toBe(true);
  });

  test("a broken localStorage doesn't break the page: the settings still apply, for the page's life", async () => {
    storage(true);
    const it = browser();
    const settings = new RecordingSettings({ devices: it.mediaDevices, recorder: it.recorder });
    expect(settings.state).toMatchObject({ chosen: null, hearClip: false });
    settings.choose("usb");
    settings.setHearClip(true);
    expect(settings.state).toMatchObject({ chosen: "usb", hearClip: true });
    expect(() => renderToStaticMarkup(<TakeSettingsButton settings={settings} />)).not.toThrow();
  });

  test("a stale or bad blob reads as the defaults", () => {
    const map = storage();
    const it = browser();
    for (const blob of ["{not json", '"usb"', '{"deviceId":4,"hearClip":"yes"}', "null"]) {
      map.set(SETTINGS_KEY, blob);
      expect(new RecordingSettings({ devices: it.mediaDevices, recorder: it.recorder }).state).toMatchObject({ chosen: null, hearClip: false });
    }
  });

  test("no localStorage at all (node) is the defaults", () => {
    const it = browser();
    expect(new RecordingSettings({ devices: it.mediaDevices, recorder: it.recorder }).state).toMatchObject({ chosen: null, hearClip: false });
  });
});

describe("the test meter", () => {
  test("moves with the chosen input, and stops when the popover closes", async () => {
    storage();
    const it = browser();
    const settings = new RecordingSettings({ devices: it.mediaDevices, recorder: it.recorder });
    settings.choose("usb");
    expect(settings.testLevel()).toBe(FLOOR_DB);
    await settings.openTest();
    expect(it.asked).toEqual(["usb"]);
    it.speak(0.5);
    const loud = settings.testLevel();
    expect(loud).toBeGreaterThan(-7);
    settings.closeTest();
    expect(it.closed).toEqual(["capture", "track usb"]);
    expect(settings.test).toBeNull();
    expect(settings.testLevel()).toBe(FLOOR_DB);
  });

  test("choosing another input while it reads moves it to that one", async () => {
    storage();
    const it = browser();
    const settings = new RecordingSettings({ devices: it.mediaDevices, recorder: it.recorder });
    await settings.openTest();
    settings.choose("laptop");
    await settle();
    expect(it.asked).toEqual([null, "laptop"]);
    expect(it.closed).toEqual(["capture", "track default"]);
    expect(settings.test).not.toBeNull();
  });

  test("closed before the microphone answers, it is let go once it opens", async () => {
    storage();
    const it = browser();
    const settings = new RecordingSettings({ devices: it.mediaDevices, recorder: it.recorder });
    const opening = settings.openTest();
    settings.closeTest();
    await opening;
    expect(settings.test).toBeNull();
    expect(it.closed).toEqual(["capture", "track default"]);
  });

  test("once it opens, permission gives the inputs' labels", async () => {
    storage();
    const it = browser([device("a", "")]);
    const settings = new RecordingSettings({ devices: it.mediaDevices, recorder: it.recorder });
    await settle();
    expect(settings.state.inputs).toEqual([{ deviceId: "a", label: "Microphone 1" }]);
    it.devices.list = [device("a", "Shure MV7")];
    await settings.openTest();
    await settle();
    expect(settings.state.inputs).toEqual([{ deviceId: "a", label: "Shure MV7" }]);
  });

  test("a refused microphone is told in the popover, and nothing is open", async () => {
    storage();
    const it = browser();
    it.recorder.getUserMedia = async () => {
      throw Object.assign(new Error("Permission denied"), { name: "NotAllowedError" });
    };
    const settings = new RecordingSettings({ devices: it.mediaDevices, recorder: it.recorder });
    await settings.openTest();
    expect(settings.test).toBeNull();
    expect(settings.state.error).toBe("Permission denied");
    expect(renderToStaticMarkup(<TakeSettingsButton settings={settings} />)).toContain("Permission denied");
  });
});
