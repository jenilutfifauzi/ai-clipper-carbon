import { RotateCcw } from "lucide-react";
import type { FontInfo } from "../../../api";
import { Skeleton } from "../../../components/Skeleton";
import { fontFamily } from "../../../fonts";
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

// The font Select's options, each shown in its own font once it is loaded.
export function fontChoices(fonts: FontInfo[] | null) {
  return {
    options: (fonts ?? []).map((font) => ({ value: font.id, label: font.label })),
    optionStyle: (id: string) => (fonts?.some((font) => font.id === id) ? { fontFamily: fontFamily(id) } : undefined),
  };
}

// A titled group of fields.
export function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-3 border-t border-border pt-4">
      <legend className="float-left mb-1 text-sm font-semibold text-muted">{title}</legend>
      {children}
    </fieldset>
  );
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
