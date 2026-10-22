import { api, NO_TEMPLATE, type Candidate, type TemplateInfo } from "../../api";

// The Review page's Apply Template (.scratch/templates/issues/07): a Template, or none, applied to
// the ticked Candidates of the Job in one request.

// The Templates by name, the default marked, then "No Template".
export function pickChoices(templates: readonly TemplateInfo[]): { value: string; label: string }[] {
  return [
    ...templates.map((template) => ({ value: template.id, label: template.default ? `${template.name} (default)` : template.name })),
    { value: NO_TEMPLATE, label: "No Template" },
  ];
}

// What the picker starts at: the default Template, else the first, else none.
export function firstPick(templates: readonly TemplateInfo[]): string {
  return (templates.find((template) => template.default) ?? templates[0])?.id ?? NO_TEMPLATE;
}

// The Candidates ticked at first: those selected for rendering.
export function ticksOf(candidates: readonly Candidate[]): Set<string> {
  return new Set(candidates.filter((candidate) => candidate.selected).map((candidate) => candidate.id));
}

// The ticks with one Candidate ticked or not.
export function ticked(ticks: ReadonlySet<string>, id: string, on: boolean): Set<string> {
  const next = new Set(ticks);
  if (on) next.add(id);
  else next.delete(id);
  return next;
}

// What the Review page says once it is applied: the Template's name, or none for No Template.
export function appliedText(name: string | null, count: number): string {
  const clips = count === 1 ? "1 clip" : `${count} clips`;
  return name ? `Applied ${name} to ${clips}` : `Took the Template items off ${clips}`;
}

// Applies the pick to the ticked Candidates, in the list's order, in one request; with `dryRun`,
// nothing is saved.
export function applyToTicked(jobId: string, pick: string, candidates: readonly Candidate[], ticks: ReadonlySet<string>, dryRun = false) {
  return api.applyTemplate(jobId, {
    template_id: pick === NO_TEMPLATE ? null : pick,
    candidate_ids: candidates.filter((candidate) => ticks.has(candidate.id)).map((candidate) => candidate.id),
    dry_run: dryRun,
  });
}
