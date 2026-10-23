import { Pause, Play, Repeat } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "../../../components/Button";
import { cx, formatPrecise } from "../../../format";
import type { LoopControl } from "./ClipPreview";
import { RATES, usePlayback, type Playback } from "./playback";

// The player's transport parts shared beyond the clip editor's slider Transport (ClipPreview.tsx):
// the Advanced Edit's deck Transport, the Loop button and the rate menu.

/**
 * The Advanced Edit's deck Transport (ADR 0025), as Concat's: the timecode (the time over the Clip's
 * length) in a box on the left; `before`, Play and `after` centred; `tools` on the right. No position
 * slider: the Timeline is where you scrub. In a narrow player the buttons take a row of their own
 * above the timecode and the tools. While `hidden`, faded out, but shown again for the keyboard's focus.
 */
export function DeckTransport({
  playback,
  before,
  after,
  tools,
  hidden = false,
  onPlay,
}: {
  playback: Playback;
  before?: ReactNode;
  after?: ReactNode;
  tools?: ReactNode;
  hidden?: boolean;
  onPlay?: () => void;
}) {
  const playing = usePlayback(playback, (_, p) => p.playing);
  const tenths = usePlayback(playback, (time) => Math.round(time * 10));
  return (
    <div
      className={cx(
        "@container motion-safe:transition-opacity motion-safe:duration-300",
        hidden && "not-has-focus-visible:pointer-events-none not-has-focus-visible:opacity-0",
      )}
    >
      <div role="group" aria-label="Transport" className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 @[44rem]:grid-cols-[minmax(max-content,1fr)_auto_minmax(max-content,1fr)]">
        <span
          className="col-start-1 row-start-2 justify-self-start rounded-md border border-border bg-fill px-2 py-1 text-xs whitespace-nowrap text-text tabular-nums @[44rem]:row-start-1"
        >
          {formatPrecise(Math.max(0, tenths / 10))}
          <span className="text-muted"> / {formatPrecise(playback.duration)}</span>
        </span>
        <div className="col-span-2 row-start-1 flex items-center justify-center gap-1 @[44rem]:col-span-1 @[44rem]:col-start-2">
          {before}
          <Button variant="secondary" size="icon" onClick={() => (onPlay ? onPlay() : playback.toggle())} aria-label={playing ? "Pause" : "Play"} title={playing ? "Pause (Space)" : "Play (Space)"}>
            {playing ? <Pause aria-hidden size={18} /> : <Play aria-hidden size={18} />}
          </Button>
          {after}
        </div>
        <div className="col-start-2 row-start-2 flex min-w-0 items-center justify-end gap-1 @[44rem]:col-start-3 @[44rem]:row-start-1">{tools}</div>
      </div>
    </div>
  );
}

/** The Loop button: Loop on or off (L), lit while on. */
export function LoopButton({ loop }: { loop: LoopControl }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={loop.onToggle}
      aria-pressed={loop.on}
      aria-label="Loop"
      aria-keyshortcuts="L"
      title={loop.on ? "Loop on (L): playing repeats from In to Out" : "Loop (L): repeat from In to Out, or with no marks, the whole Clip"}
      className="aria-pressed:text-accent-text"
    >
      <Repeat aria-hidden size={18} />
    </Button>
  );
}

// The playback rate, picked from RATES; marked in the accent whenever it isn't 1×, so that a fast
// preview isn't taken for a fast Clip.
export function RateMenu({ playback }: { playback: Playback }) {
  const rate = usePlayback(playback, (_, p) => p.rate);
  return (
    <select
      value={rate}
      // Let go once a rate is picked, so that Space plays; the Advanced Edit's keys go on meanwhile.
      onChange={(event) => {
        playback.setRate(Number(event.target.value));
        event.currentTarget.blur();
      }}
      aria-label="Playback rate"
      data-shortcuts
      className={cx(
        "min-h-9 shrink-0 cursor-pointer appearance-none rounded-[10px] px-2 text-center text-sm font-medium tabular-nums hover:bg-fill",
        rate === 1 ? "text-muted hover:text-text" : "text-accent-text",
      )}
    >
      {RATES.map((each) => (
        <option key={each} value={each}>
          {each}×
        </option>
      ))}
    </select>
  );
}
