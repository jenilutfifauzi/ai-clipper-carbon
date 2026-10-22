import type { Aspect, Candidate } from "../../../api";
import { cx } from "../../../format";

// The Canvas Aspects a Candidate can have (docs/adr/0022), in the picker's order, each with what its
// button tells a screen reader and a hover.
export const ASPECTS: readonly { value: Aspect; name: string }[] = [
  { value: "9:16", name: "Vertical 9:16 (Shorts, Reels, TikTok)" },
  { value: "4:5", name: "Portrait 4:5 (feed)" },
  { value: "1:1", name: "Square 1:1" },
  { value: "16:9", name: "Landscape 16:9 (YouTube, X)" },
];

/**
 * A change of the Candidate's aspect from `current` to `picked`, as the picker makes it: nothing when
 * it is the same; otherwise the edits waiting here are saved first (`flush`), so that none is lost or
 * rescaled half-way, then the aspect alone is sent (`send`), and the backend rescales the rest. Gives
 * the Revision the change made, or null when nothing was sent.
 */
export async function changeAspect(
  current: Aspect,
  picked: Aspect,
  steps: { flush: () => Promise<void>; send: (aspect: Aspect) => Promise<Candidate> },
): Promise<Candidate | null> {
  if (picked === current) return null;
  await steps.flush();
  return steps.send(picked);
}

/**
 * The aspect picker above the Advanced Edit's player: a button per aspect, its shape drawn as a small
 * box beside its label, the Candidate's own pressed. Buttons rather than radios, so that moving
 * along them with the keyboard changes nothing until one is chosen.
 */
export function AspectPicker({ value, onPick, busy = false, className }: { value: Aspect; onPick: (aspect: Aspect) => void; busy?: boolean; className?: string }) {
  return (
    <div role="group" aria-label="Canvas aspect" aria-busy={busy || undefined} className={cx("flex rounded-control bg-fill p-1", className)}>
      {ASPECTS.map(({ value: aspect, name }) => {
        const on = aspect === value;
        return (
          <button
            key={aspect}
            type="button"
            aria-pressed={on}
            aria-label={name}
            title={name}
            aria-disabled={busy || undefined}
            onClick={() => !busy && onPick(aspect)}
            className={cx(
              "flex min-h-9 min-w-0 items-center justify-center gap-1.5 rounded-[10px] px-2.5 text-xs font-medium whitespace-nowrap tabular-nums select-none",
              "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus",
              "motion-safe:transition-colors aria-disabled:cursor-wait",
              on ? "raised text-text" : "text-muted hover:text-text",
            )}
          >
            <Shape aspect={aspect} />
            {aspect}
          </button>
        );
      })}
    </div>
  );
}

// The aspect's shape, its longer side 14 px.
function Shape({ aspect }: { aspect: Aspect }) {
  const [across, down] = aspect.split(":").map(Number);
  const longer = Math.max(across, down);
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-[2px] border-[1.5px] border-current"
      style={{ width: `${(14 * across) / longer}px`, height: `${(14 * down) / longer}px` }}
    />
  );
}
