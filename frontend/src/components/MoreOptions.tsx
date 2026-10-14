import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

// A disclosure for the controls used less often: a native <details>, so it opens from the keyboard
// with nothing added. `contents` names what is inside; `changed` counts the fields in it that differ
// from their defaults, so a change is seen while it is closed.
export function MoreOptions({
  open,
  onToggle,
  contents,
  changed = 0,
  children,
}: {
  open: boolean;
  onToggle: (open: boolean) => void;
  contents: string;
  changed?: number;
  children: ReactNode;
}) {
  return (
    <details open={open} onToggle={(event) => onToggle(event.currentTarget.open)} className="group border-t border-border pt-2">
      <summary
        className={
          "-mx-2 flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-[10px] px-2 select-none hover:bg-fill " +
          "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden"
        }
      >
        <ChevronRight
          aria-hidden
          size={16}
          className="shrink-0 text-muted group-open:rotate-90 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out"
        />
        <span className="shrink-0 font-semibold whitespace-nowrap">More options</span>
        <span className="min-w-0 truncate text-sm text-muted">{contents}</span>
        {changed > 0 && (
          <span className="ml-auto shrink-0 rounded-full bg-fill px-2 py-0.5 text-xs font-medium text-accent-text tabular-nums">
            {changed} changed
          </span>
        )}
      </summary>
      <div className="flex flex-col gap-5 pt-3 pb-1">{children}</div>
    </details>
  );
}
