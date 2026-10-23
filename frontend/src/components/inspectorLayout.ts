import { createContext, useContext } from "react";

// .scratch/workspace-polish/issues/05: the Advanced Edit's Inspector lays its fields out inline,
// label left and value right, in groups that fold. The Inspector provides this; `Group`, `Slider`,
// `Switch`, `Select` and `ColorField` read it. Without it (the clip editor) they render as before.
export type InspectorLayout = {
  // The titles of the groups folded shut, remembered by the browser (workspaceLayout.ts).
  folded: readonly string[];
  onFold: (title: string, folded: boolean) => void;
};

export const InspectorLayout = createContext<InspectorLayout | null>(null);

/** Whether the fields are the Inspector's inline rows. */
export const useInline = () => useContext(InspectorLayout) !== null;

// An inline row's label column: a fixed share of the row, so the values line up.
export const INLINE_LABEL = "flex w-[38%] shrink-0 items-center gap-1.5 text-sm font-medium";
