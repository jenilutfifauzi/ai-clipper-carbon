import type { TemplateInfo } from "../../api";
import { Select } from "../../components/Select";
import { templateChoices, type TemplateChoice } from "./templateChoice";

// The Template a new Job's Candidates arrive with: the default (named), another, or none. Nothing
// to choose while the owner has no Templates.
export function TemplateField({
  templates,
  value,
  onChange,
  className,
}: {
  templates: readonly TemplateInfo[];
  value: TemplateChoice;
  onChange: (value: TemplateChoice) => void;
  className?: string;
}) {
  if (templates.length === 0) return null;
  return <Select label="Template" value={value} options={templateChoices(templates)} onChange={onChange} className={className} />;
}
