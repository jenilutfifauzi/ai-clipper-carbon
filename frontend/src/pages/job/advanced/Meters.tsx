import { useEffect, useRef, useState } from "react";
import { cx } from "../../../format";
import type { Playback } from "../editor/playback";
import { FLOOR_DB, heldPeak, type Meter, type MeterSide } from "./ballistics";
import { MeterFeed } from "./meterFeed";

// The ruler's numbers, in dB: every 6 to −24, every 12 below, where the odd dB matters less.
const RULER = [0, -6, -12, -18, -24, -36, -48, -60];

// How far up its bar `db` is, from 0 at FLOOR_DB to 1 at 0 dBFS.
const height = (db: number) => (db - FLOOR_DB) / -FLOOR_DB;

// A level as the ruler and the held peak show it, with a true minus sign.
const decibelText = (db: number) => (db < 0 ? `−${-db}` : `${db}`);

// Green to −12 dB, orange to −3 dB, red above: the bar shows as much of it as its level.
const BAR_FILL = "bg-[linear-gradient(to_top,var(--success)_80%,var(--accent)_80%_95%,var(--danger)_95%)]";

/**
 * The Meters (GLOSSARY.md): the preview's peak level, left and right, from −60 to 0 dB, while it
 * plays, with each side's held peak as a line, the louder held peak in whole dB under the bars, and a
 * clip light that stays red once a sample reached 0 dBFS, until it is clicked. A slim column beside
 * the desktop's bottom panel, for `workspace-layout` to take into its own. The bars are drawn straight
 * onto their elements on each frame (MeterFeed); only the number and the light re-render.
 */
export function Meters({ playback }: { playback: Playback }) {
  const bars = useRef<(HTMLDivElement | null)[]>([]);
  const holds = useRef<(HTMLDivElement | null)[]>([]);
  const feed = useRef<MeterFeed | null>(null);
  const [clipped, setClipped] = useState(false);
  const [peak, setPeak] = useState<number | null>(null);

  useEffect(() => {
    const paint = (side: MeterSide, i: number) => {
      const bar = bars.current[i];
      const hold = holds.current[i];
      if (bar) bar.style.clipPath = `inset(${(1 - height(side.level)) * 100}% 0 0 0)`;
      if (hold) {
        // Kept inside the bar at the top.
        hold.style.bottom = `calc(${height(side.held) * 100}% - ${height(side.held) * 2}px)`;
        hold.style.opacity = side.held > FLOOR_DB ? "1" : "0";
      }
    };
    const draw = (meter: Meter) => {
      [meter.left, meter.right].forEach(paint);
      setClipped(meter.clipped);
      setPeak(heldPeak(meter));
    };
    const made = new MeterFeed(playback, draw);
    feed.current = made;
    draw(made.meter);
    return made.start();
  }, [playback]);

  const light = clipped ? "Clipped: a sample reached 0 dBFS. Click to clear" : "Clip light: turns red when a sample reaches 0 dBFS";

  return (
    <aside
      aria-label="Meters"
      title="The preview's peak level, left and right. The render is normalized to −14 LUFS afterwards, so its level will differ."
      className="panel grid shrink-0 grid-cols-[1.5rem_0.625rem_0.625rem] grid-rows-[auto_minmax(0,1fr)_auto_auto] gap-x-1 gap-y-1.5 px-2.5 py-3"
    >
      <button
        type="button"
        onClick={() => feed.current?.clearClip()}
        aria-label={light}
        title={light}
        className="col-span-2 col-start-2 flex h-5 items-center rounded focus-visible:outline-2 focus-visible:outline-focus"
      >
        <span className={cx("h-1.5 w-full rounded-full", clipped ? "bg-danger" : "bg-fill")} />
      </button>

      <div aria-hidden className="relative col-start-1 row-start-2 border-r border-border">
        {RULER.map((db) => (
          <span
            key={db}
            className="absolute right-0 flex items-center gap-0.5 text-[10px] leading-none text-muted tabular-nums"
            // Held inside the ruler at both ends: 0 hangs from the top and −60 sits on the foot.
            style={{ top: `${(1 - height(db)) * 100}%`, transform: `translateY(-${(1 - height(db)) * 100}%)` }}
          >
            {decibelText(db)}
            <span className="h-px w-1 bg-border" />
          </span>
        ))}
      </div>
      {[0, 1].map((i) => (
        <div key={i} aria-hidden className="relative row-start-2 overflow-hidden rounded-sm bg-fill">
          <div
            ref={(element) => {
              bars.current[i] = element;
            }}
            className={cx("absolute inset-0", BAR_FILL)}
            style={{ clipPath: "inset(100% 0 0 0)" }}
          />
          <div
            ref={(element) => {
              holds.current[i] = element;
            }}
            className="absolute inset-x-0 h-0.5 bg-text opacity-0"
          />
        </div>
      ))}

      <span aria-hidden className="text-right text-[10px] leading-none text-muted">dB</span>
      <span aria-hidden className="text-center text-[10px] leading-none font-semibold text-muted">L</span>
      <span aria-hidden className="text-center text-[10px] leading-none font-semibold text-muted">R</span>

      <span
        title="The held peak, in dB"
        className={cx("col-span-2 col-start-2 rounded-md bg-fill py-0.5 text-center text-[10px] leading-4 tabular-nums", clipped ? "text-danger" : "text-text")}
      >
        {peak === null ? "–" : decibelText(peak)}
      </span>
    </aside>
  );
}
