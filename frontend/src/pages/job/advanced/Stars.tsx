import { Star } from "lucide-react";
import { cx } from "../../../format";
import { toggleStar } from "../../../starredEffects";

/**
 * An effect's star in a library (ADR 0014): filled when starred; a click stars or unstars it on the
 * server. `onPicture`: drawn over a card's picture, light on a dark disc.
 */
export function StarButton({
  id,
  name,
  starred,
  onPicture = false,
  className,
}: {
  id: string;
  name: string;
  starred: boolean;
  onPicture?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      data-star={id}
      aria-pressed={starred}
      aria-label={`Star ${name}`}
      title={starred ? "Unstar" : "Star"}
      onClick={(event) => {
        event.stopPropagation();
        void toggleStar(id);
      }}
      className={cx(
        "grid size-8 shrink-0 place-items-center rounded-md in-data-sheet:min-h-11 in-data-sheet:min-w-11 focus-visible:outline-2 focus-visible:outline-focus",
        onPicture ? "bg-black/55 text-white hover:bg-black/70" : starred ? "text-accent-text" : "text-muted hover:text-text",
        className,
      )}
    >
      <Star aria-hidden size={15} className={cx(starred && "fill-current")} />
    </button>
  );
}

/** A library's Starred chip: on, the library shows only its starred effects. */
export function StarredChip({ on, onChange }: { on: boolean; onChange: (on: boolean) => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={() => onChange(!on)}
      className={cx(
        "flex min-h-8 items-center gap-1.5 self-start rounded-full border px-3 text-xs font-medium in-data-sheet:min-h-11",
        "focus-visible:outline-2 focus-visible:outline-focus",
        on ? "border-transparent bg-fill text-accent-text" : "border-border text-muted hover:text-text",
      )}
    >
      <Star aria-hidden size={13} className={cx(on && "fill-current")} />
      Starred
    </button>
  );
}

/** What a library says when its Starred chip is on and it has none to show. */
export const NO_STARRED = "No starred effects yet: star one to find it here.";
