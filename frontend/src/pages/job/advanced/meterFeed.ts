import { heardBus } from "../editor/masterBus";
import type { Playback } from "../editor/playback";
import { clearClip, meterStep, QUIET, settled, type Meter } from "./ballistics";

/** The loudest samples, left and right, that a read of the preview's sound found. */
export type Peaks = readonly [number, number];

const buffers = new WeakMap<AnalyserNode, Float32Array<ArrayBuffer>>();

// The loudest sample (1 is full scale) in the analyser's last window.
function peakOf(side: AnalyserNode): number {
  let samples = buffers.get(side);
  if (samples?.length !== side.fftSize) buffers.set(side, (samples = new Float32Array(side.fftSize)));
  side.getFloatTimeDomainData(samples);
  let peak = 0;
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  return peak;
}

/** The preview's peaks now, from the master bus's analysers; silence before anything is heard. */
export function busPeaks(): Peaks {
  const bus = heardBus();
  return bus ? [peakOf(bus.sides[0]), peakOf(bus.sides[1])] : [0, 0];
}

/**
 * What the Meters show, kept on each animation frame while the preview plays (GLOSSARY.md): the
 * peaks `read` gives (the master bus's), through the ballistics, to `draw`. Once paused, the
 * bars fall with nothing read, and the frames stop when they are down, until it plays again.
 */
export class MeterFeed {
  meter: Meter = QUIET;
  private frame = 0;
  private last = 0;

  constructor(
    private readonly playback: Playback,
    private readonly draw: (meter: Meter) => void,
    private readonly read: () => Peaks = busPeaks,
  ) {}

  /** Follows the playback; what it returns stops following it. */
  start(): () => void {
    this.wake();
    const unsubscribe = this.playback.subscribe(this.wake);
    return () => {
      unsubscribe();
      cancelAnimationFrame(this.frame);
      this.frame = 0;
    };
  }

  /** The clip light clicked. */
  clearClip() {
    this.meter = clearClip(this.meter);
    this.draw(this.meter);
  }

  private wake = () => {
    if (this.frame || !this.playback.playing) return;
    this.last = performance.now();
    this.frame = requestAnimationFrame(this.tick);
  };

  private tick = (now: number) => {
    const playing = this.playback.playing;
    this.meter = meterStep(this.meter, playing ? this.read() : [0, 0], Math.max(0, now - this.last) / 1000);
    this.last = now;
    this.draw(this.meter);
    this.frame = playing || !settled(this.meter) ? requestAnimationFrame(this.tick) : 0;
  };
}
