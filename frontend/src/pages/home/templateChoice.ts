import { DEFAULT_TEMPLATE, type JobOptions, type TemplateInfo } from "../../api";

// The New Job form's Template choice (.scratch/templates/issues/08): the default Template, another
// of the owner's, or none.
export const NO_TEMPLATE = "";

// DEFAULT_TEMPLATE, NO_TEMPLATE or a Template's id.
export type TemplateChoice = string;

// The choices, the default first and named. With no default, choosing it is choosing none, so it is
// the one "No Template".
export function templateChoices(templates: readonly TemplateInfo[]): { value: TemplateChoice; label: string }[] {
  const named = templates.find((template) => template.default);
  const others = templates.filter((template) => template !== named).map((template) => ({ value: template.id, label: template.name }));
  if (!named) return [{ value: DEFAULT_TEMPLATE, label: "No Template" }, ...others];
  return [{ value: DEFAULT_TEMPLATE, label: `${named.name} (default)` }, ...others, { value: NO_TEMPLATE, label: "No Template" }];
}

// What the Job is asked for: the default is left to the backend, which knows it as the Job is made.
export function templateOption(choice: TemplateChoice): Partial<JobOptions> {
  if (choice === DEFAULT_TEMPLATE) return {};
  return { template: choice === NO_TEMPLATE ? null : choice };
}

// The chosen Template's name, for the options' summary; none when no Template applies.
export function chosenName(choice: TemplateChoice, templates: readonly TemplateInfo[]): string | null {
  const chosen = choice === DEFAULT_TEMPLATE ? templates.find((template) => template.default) : templates.find((template) => template.id === choice);
  return chosen?.name ?? null;
}
