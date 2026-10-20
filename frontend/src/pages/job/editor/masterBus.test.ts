// .scratch/audio-mixing/issues/13-meters.md: every sound the preview plays goes through one master
// bus, which feeds the speakers and the Meters' two analysers. Each element is routed once, through
// its own gain, and plays at its gain; none bypasses the bus.
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

class FakeNode {
  readonly outputs: { node: FakeNode; output: number }[] = [];
  connect<T extends FakeNode>(node: T, output = 0): T {
    this.outputs.push({ node, output });
    return node;
  }
}

class FakeGain extends FakeNode {
  readonly gain = { value: 1, cancelScheduledValues: () => {} };
}

class FakeAnalyser extends FakeNode {
  fftSize = 2048;
}

class FakeSource extends FakeNode {
  constructor(readonly element: object) {
    super();
  }
}

const made: FakeNode[] = [];
const contexts: FakeContext[] = [];

class FakeContext {
  constructor() {
    contexts.push(this);
  }
  readonly state = "running";
  readonly currentTime = 0;
  readonly destination = new FakeNode();
  resume = () => Promise.resolve();
  private make<T extends FakeNode>(node: T): T {
    made.push(node);
    return node;
  }
  createGain = () => this.make(new FakeGain());
  createAnalyser = () => this.make(new FakeAnalyser());
  createChannelSplitter = () => this.make(new FakeNode());
  createMediaElementSource = (element: object) => this.make(new FakeSource(element));
}

beforeEach(() => {
  made.length = 0;
  contexts.length = 0;
  vi.resetModules();
  vi.stubGlobal("window", { addEventListener: () => {} });
  vi.stubGlobal("AudioContext", FakeContext);
});

afterEach(() => vi.unstubAllGlobals());

const element = () => ({ volume: 1 }) as HTMLMediaElement;

describe("the preview's master bus", () => {
  test("carries every element once, at its gain, to the speakers and the Meters", async () => {
    const { setVolume } = await import("./PreviewMusic");
    const { heardBus } = await import("./masterBus");
    const [deck, song] = [element(), element()];
    setVolume(deck, 0.5);
    setVolume(song, 2);
    setVolume(deck, 0.8);

    const bus = heardBus();
    expect(bus).not.toBeNull();
    const sources = made.filter((node): node is FakeSource => node instanceof FakeSource);
    expect(sources.map((source) => source.element)).toEqual([deck, song]);
    const gains = sources.map((source) => {
      expect(source.outputs).toHaveLength(1);
      return source.outputs[0].node as FakeGain;
    });
    expect(gains.map((gain) => gain.gain.value)).toEqual([0.8, 2]);
    for (const gain of gains) expect(gain.outputs.map(({ node }) => node)).toEqual([bus!.input]);

    // The bus alone reaches the speakers; its splitter feeds an analyser per side.
    expect(contexts).toHaveLength(1);
    const [context] = contexts;
    const reaching = made.filter((node) => node.outputs.some(({ node: to }) => to === context.destination));
    expect(reaching).toEqual([bus!.input]);
    // Mixed to two channels, so that a mono sound is metered on both sides.
    expect(bus!.input.channelCount).toBe(2);
    expect(bus!.input.channelCountMode).toBe("explicit");
    const input = bus!.input as unknown as FakeNode;
    const splitter = input.outputs.find(({ node }) => node !== context.destination)!.node;
    expect(input.outputs).toHaveLength(2);
    expect(splitter.outputs).toEqual([
      { node: bus!.sides[0], output: 0 },
      { node: bus!.sides[1], output: 1 },
    ]);
  });

  // A touch grants the page user activation on its pointerup (touchend), not its pointerdown: a phone's
  // first tap on Play left the context suspended, and the preview silent, until a second tap.
  test("is resumed by a tap's pointerup, as well as by a click's pointerdown or a key", async () => {
    const listeners = new Map<string, () => void>();
    vi.stubGlobal("window", { addEventListener: (type: string, listener: () => void) => listeners.set(type, listener) });
    const { setVolume } = await import("./PreviewMusic");
    setVolume(element(), 1);
    const [context] = contexts;
    const resume = vi.spyOn(context, "resume");
    for (const type of ["pointerdown", "pointerup", "keydown"]) {
      resume.mockClear();
      listeners.get(type)?.();
      expect(resume, type).toHaveBeenCalledTimes(1);
    }
  });

  // .scratch/voiceover/issues/02-record-a-take.md: while a Take records, the speakers are silent.
  test("is held silent while a Take records, and heard again after; a bus made meanwhile starts silent", async () => {
    const { setVolume } = await import("./PreviewMusic");
    const { heardBus, holdBus } = await import("./masterBus");
    holdBus(true);
    setVolume(element(), 1);
    const input = heardBus()!.input as unknown as FakeGain;
    expect(input.gain.value).toBe(0);
    holdBus(false);
    expect(input.gain.value).toBe(1);
    holdBus(true);
    expect(input.gain.value).toBe(0);
    holdBus(false);
  });

  test("is not made before anything is heard", async () => {
    const { heardBus } = await import("./masterBus");
    expect(heardBus()).toBeNull();
  });
});
