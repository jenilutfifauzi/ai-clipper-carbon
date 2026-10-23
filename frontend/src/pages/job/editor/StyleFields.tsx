import { ChevronRight, RotateCcw } from "lucide-react";
import { useContext } from "react";
import { InspectorLayout } from "../../../components/inspectorLayout";
import { Skeleton } from "../../../components/Skeleton";
import type { StyleControls, StylePart } from "./useStyleDraft";

/** The reset button of an overridden style field, after its label; nothing when it is the Preset's. */
export function StyleMarker({ style, part, field, label }: { style: StyleControls; part: StylePart; field: string; label: string }) {
  if (!(field in style.overrides[part])) return null;
  return (
    <button
      type="button"
      onClick={() => style.reset(part, field)}
      aria-label={`Reset ${label} to the preset`}
      title="Changed from the preset: reset"
      className="-my-2 inline-flex size-7 items-center justify-center rounded-full text-accent-text hover:bg-fill"
    >
      <RotateCcw aria-hidden size={13} />
    </button>
  );
}

// How many of `fields` the Candidate overrides in `part`.
export function countChanged(style: StyleControls, part: StylePart, fields: readonly string[]) {
  return fields.filter((field) => field in style.overrides[part]).length;
}

// A titled group of fields. In the Inspector, a disclosure that folds, its state remembered per title.
export function Group({ title, children }: { title: string; children: React.ReactNode }) {
  const inspector = useContext(InspectorLayout);
  if (inspector) {
    return (
      <details
        open={!inspector.folded.includes(title)}
        onToggle={(event) => inspector.onFold(title, !event.currentTarget.open)}
        className="group/fold min-w-0 border-t border-border pt-1"
      >
        <summary
          className={
            "-mx-2 flex min-h-10 cursor-pointer list-none items-center gap-1.5 rounded-[10px] px-2 select-none hover:bg-fill " +
            "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus [&::-webkit-details-marker]:hidden"
          }
        >
          <ChevronRight
            aria-hidden
            size={15}
            className="shrink-0 text-muted group-open/fold:rotate-90 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out"
          />
          <span className="min-w-0 truncate text-sm font-semibold text-muted">{title}</span>
        </summary>
        <div className="flex min-w-0 flex-col gap-2.5 pt-1 pb-3">{children}</div>
      </details>
    );
  }
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 border-t border-border pt-4">
      <legend className="float-left mb-1 text-sm font-semibold text-muted">{title}</legend>
      {children}
    </fieldset>
  );
}

// A field the picked Text Layers differ in.
export function Mixed() {
  return <span className="rounded-md bg-fill px-1.5 py-0.5 text-xs font-normal text-muted">Mixed</span>;
}

// A section of fields, while the Presets load.
export function StyleFieldsSkeleton() {
  return (
    <div className="flex flex-col gap-3">
      <p role="status" className="sr-only">
        Loading the presets
      </p>
      <div aria-hidden className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((field) => (
          <Skeleton key={field} className="h-11" />
        ))}
      </div>
    </div>
  );
}
