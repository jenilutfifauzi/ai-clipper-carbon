import {
  api,
  type AnchorKind,
  type AnchorOverride,
  type CandidateChange,
  type CapturedTemplate,
  type SavedTemplate,
  type TemplateAnchor,
  type TemplateInfo,
  type TemplateLayerKind,
} from "../../../api";
import type { AdvancedEdits } from "./edits";
import { listOf, onlyItem, type Pick } from "./pick";

// The Templates (GLOSSARY.md; docs/adr/0023) in the Advanced Edit: applied from the Templates tab or
// sheet as one draft change, saved from the "Save as Template…" dialog, and named in the Inspector.

/**
 * `edits` with what applying a Template made of the Candidate (`applied`, a PATCH body: the fields it
 * sets) put in: each field the Advanced Edit edits that it sets replaces the edits' own. One draft
 * change, one step of undo, saved as any edit is.
 */
export function withApplied(edits: AdvancedEdits, applied: CandidateChange): AdvancedEdits {
  const next = { ...edits } as Record<string, unknown>;
  for (const key of Object.keys(edits) as (keyof AdvancedEdits)[]) {
    const value = (applied as Record<string, unknown>)[key];
    if (value !== undefined) next[key] = value;
  }
  return next as AdvancedEdits;
}

/**
 * The Template `templateId` (or "No Template", null) as applied to the Candidate as it is saved now:
 * the dry run's edits and notices for it, nothing saved. The editor puts them in as one draft change.
 */
export async function appliedTo(jobId: string, candidateId: string, templateId: string | null): Promise<{ edits: CandidateChange; notices: string[] }> {
  const { candidates } = await api.applyTemplate(jobId, { template_id: templateId, candidate_ids: [candidateId], dry_run: true });
  const [result] = candidates;
  return { edits: result.edits, notices: result.notices };
}

/** What the toast says once a Template (named; null for "No Template") is applied, with its notices. */
export function appliedNotice(name: string | null, notices: string[]): string {
  const done = name === null ? "Template items taken off." : `Applied “${name}”.`;
  return [done, ...notices].join(" ");
}

const START_SIDE = new Set(["clip_start", "main_start"]);
const END_SIDE = new Set(["main_end", "clip_end"]);

/** An Anchor's name: Start (both edges from a start-side boundary), End (both from an end-side one), or Span. */
export function anchorKind(anchor: TemplateAnchor): AnchorKind {
  if (START_SIDE.has(anchor.end.boundary)) return "start";
  return END_SIDE.has(anchor.start.boundary) ? "end" : "span";
}

/** Each kind of a Template's layers, by name, in the order a Template lists them. */
export const LAYER_NAMES: Record<TemplateLayerKind, string> = {
  text_layers: "Text",
  shapes: "Shape",
  music: "Music",
  overlays: "Overlay",
  adjustment_layers: "Adjustment Layer",
};

/** One of the layers a Template would hold, as the save dialog lists it, with its guessed Anchor. */
export interface LayerRow {
  kind: TemplateLayerKind;
  id: string;
  // Its kind's name, and a Text Layer's words.
  label: string;
  start: number;
  secs: number;
  guessed: AnchorKind;
}

/** The save dialog's layer list: each layer the capture preview gives, with the Anchor guessed for it. */
export function layerRows(captured: CapturedTemplate): LayerRow[] {
  return (Object.keys(LAYER_NAMES) as TemplateLayerKind[]).flatMap((kind) =>
    (captured.layers[kind] ?? []).map(({ item, anchor }) => ({
      kind,
      id: item.id,
      label: kind === "text_layers" && item.text ? `${LAYER_NAMES[kind]} “${item.text}”` : LAYER_NAMES[kind],
      start: item.start,
      secs: item.secs,
      guessed: anchorKind(anchor),
    })),
  );
}

/** A layer row's key in the dialog's choices. */
export const rowKey = (row: { kind: TemplateLayerKind; id: string }) => `${row.kind}:${row.id}`;

/** The Anchors the owner chose that differ from the guess, as the save sends them. */
export function anchorOverrides(rows: LayerRow[], chosen: Record<string, AnchorKind>): AnchorOverride[] {
  return rows.flatMap((row) => {
    const anchor = chosen[rowKey(row)];
    return anchor && anchor !== row.guessed ? [{ kind: row.kind, id: row.id, anchor }] : [];
  });
}

/**
 * Save as Template: the Candidate as its draft edits make it, with the Anchors chosen and its poster
 * the frame of the draft at the playhead `at`; a new Template, or over `over`, which keeps its id.
 */
export function saveAsTemplate(
  save: { name: string; jobId: string; candidateId: string; draft: CandidateChange; anchors: AnchorOverride[]; at: number },
  over: string | null,
): Promise<SavedTemplate> {
  const body = {
    name: save.name.trim(),
    job_id: save.jobId,
    candidate_id: save.candidateId,
    edits: save.draft,
    anchors: save.anchors,
    poster_at: Math.max(0, save.at),
  };
  return api.saveTemplate(body, over);
}

/** The Template that put the one picked item there (its mark), if it is a Template item. */
export function pickedTemplate(edits: AdvancedEdits, pick: Pick): string | null {
  const only = onlyItem(pick);
  if (only) return (listOf(edits, only.kind) as { id: string; template?: string | null }[]).find((item) => item.id === only.id)?.template ?? null;
  if (pick?.kind === "join") return edits.transitions.find((transition) => transition.after === pick.after)?.template ?? null;
  return null;
}

/** What the Inspector says of a Template item: the Template that put it there, by name, or that it was deleted. */
export function templateNote(templateId: string, templates: TemplateInfo[] | null): string {
  if (templates === null) return "From a Template";
  const template = templates.find((each) => each.id === templateId);
  return template ? `From Template “${template.name}”` : "From a deleted Template";
}

/** A Template card's lengths: what its intro and outro add to a Clip. */
export function partsLabel(template: { intro?: { secs: number }; outro?: { secs: number } }): string {
  const intro = template.intro?.secs ?? 0;
  const outro = template.outro?.secs ?? 0;
  if (!intro && !outro) return "No intro or outro";
  const secs = (value: number) => `${value.toFixed(1)} s`;
  return [intro ? `Intro ${secs(intro)}` : "No intro", outro ? `Outro ${secs(outro)}` : "no outro"].join(" · ");
}
