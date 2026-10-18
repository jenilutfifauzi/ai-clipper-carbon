/**
 * The Meters' ballistics (GLOSSARY.md): what a bar shows of the preview's peaks over time. A bar rises
 * at once to a louder peak and falls FALL_DB_PER_SEC; the loudest of the last moment is held as a line
 * for HOLD_SECS, then falls too; and a sample at full scale latches the clip light until it is clicked.
 * All in dB, from FLOOR_DB to 0.
 */

/** The Meters' foot, in dB: anything quieter sits on it. Their top is 0 dBFS. */
export const FLOOR_DB = -60;
/** How fast a bar, and a held peak past its hold, falls. */
export const FALL_DB_PER_SEC = 24;
/** How long a held peak stays before it falls. */
export const HOLD_SECS = 1.5;

/** One side's bar and its held peak, in dB, and how long the peak has been held. */
export type MeterSide = { level: number; held: number; heldFor: number };

export type Meter = { left: MeterSide; right: MeterSide; clipped: boolean };

const SILENT: MeterSide = { level: FLOOR_DB, held: FLOOR_DB, heldFor: 0 };

/** The Meters before anything is heard. */
export const QUIET: Meter = { left: SILENT, right: SILENT, clipped: false };

/** A peak sample level (1 is full scale) in dB, from FLOOR_DB to 0. */
export function decibels(peak: number): number {
  if (!(peak > 0)) return FLOOR_DB;
  return Math.min(0, Math.max(FLOOR_DB, 20 * Math.log10(peak)));
}

function sideStep(side: MeterSide, peak: number, seconds: number): MeterSide {
  const now = decibels(peak);
  const level = Math.max(now, side.level - FALL_DB_PER_SEC * seconds, FLOOR_DB);
  if (now >= side.held) return { level, held: now, heldFor: 0 };
  const heldFor = side.heldFor + seconds;
  // Only the time past the hold lets it fall.
  const falling = Math.min(seconds, Math.max(0, heldFor - HOLD_SECS));
  return { level, held: Math.max(side.held - FALL_DB_PER_SEC * falling, level), heldFor };
}

/** The Meters `seconds` after `meter`, when the loudest samples since were `peaks`, left and right. */
export function meterStep(meter: Meter, [left, right]: readonly [number, number], seconds: number): Meter {
  return {
    left: sideStep(meter.left, left, seconds),
    right: sideStep(meter.right, right, seconds),
    clipped: meter.clipped || left >= 1 || right >= 1,
  };
}

/** The clip light clicked: off until the next sample at full scale. */
export const clearClip = (meter: Meter): Meter => ({ ...meter, clipped: false });

/** The held peak shown under the bars, the louder side's in whole dB; null when neither holds one. */
export function heldPeak(meter: Meter): number | null {
  const held = Math.max(meter.left.held, meter.right.held);
  return held > FLOOR_DB ? Math.round(held) : null;
}

/** Whether the bars and their held peaks are all down: nothing is left to draw while paused. */
export const settled = (meter: Meter) => [meter.left, meter.right].every((side) => side.level <= FLOOR_DB && side.held <= FLOOR_DB);
