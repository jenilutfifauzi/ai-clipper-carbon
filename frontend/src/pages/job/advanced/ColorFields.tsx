import { RotateCcw } from "lucide-react";
import type { Adjust, Grade } from "../../../api";
import { Button } from "../../../components/Button";
import { Slider } from "../../../components/Slider";
import { gradeOf, isNeutral, NEUTRAL_ADJUST } from "../editor/grading";
import { Group, Mixed } from "../editor/StyleFields";

type Dial = keyof Adjust;

interface DialSpec {
  dial: Dial;
  label: string;
  min: number;
  max: number;
  step: number;
  format: (value: number) => string;
}

const signed = (value: number) => `${value > 0 ? "+" : ""}${Math.round(value)}`;
const percent = (dial: Dial, label: string, min = -100): DialSpec => ({ dial, label, min, max: 100, step: 1, format: signed });

// The Adjust dials in Concat's groups and ranges (backend/app/candidates.py's Adjust).
const GROUPS: { title: string; dials: DialSpec[] }[] = [
  {
    title: "Color",
    dials: [
      { dial: "temperature", label: "Temperature", min: 2000, max: 11000, step: 50, format: (value) => `${Math.round(value)} K` },
      percent("tint", "Tint"),
      percent("saturation", "Saturation"),
    ],
  },
  {
    title: "Lightness",
    dials: [
      { dial: "exposure", label: "Exposure", min: -3, max: 3, step: 0.05, format: (value) => `${value > 0 ? "+" : ""}${value.toFixed(2)} EV` },
      percent("brightness", "Brightness"),
      percent("contrast", "Contrast"),
      percent("highlights", "Highlights"),
      percent("shadows", "Shadows"),
      percent("whites", "Whites"),
      percent("blacks", "Blacks"),
    ],
  },
  { title: "Effects", dials: [percent("sharpen", "Sharpen", 0), percent("fade", "Fade", 0), percent("vignette", "Vignette", 0)] },
];

/**
 * The Color section (ADR 0013): the Grades of the picked Segments, `grades`, by their Adjust dials in
 * groups (Color, Lightness, Effects), shown as the first one's, a dial the Grades differ in marked
 * Mixed. Moving a dial sets it on every one (`onDial`, a change of its group); a double-click puts it
 * back at neutral, and Reset makes every dial neutral (`onReset`).
 */
export function ColorFields({
  grades,
  onDial,
  onReset,
}: {
  grades: (Grade | null | undefined)[];
  onDial: (change: Partial<Adjust>, group: string) => void;
  onReset: () => void;
}) {
  const adjusts = grades.map((grade) => gradeOf(grade).adjust);
  const [first = NEUTRAL_ADJUST] = adjusts;
  return (
    <section aria-labelledby="color-heading" className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <h3 id="color-heading" className="font-semibold">
          Color
        </h3>
        <Button size="sm" variant="ghost" onClick={onReset} disabled={grades.every(isNeutral)} title="Every dial back at neutral">
          <RotateCcw aria-hidden size={15} />
          Reset
        </Button>
      </div>
      {GROUPS.map(({ title, dials }) => (
        <Group key={title} title={title}>
          {dials.map(({ dial, label, min, max, step, format }) => (
            // A double-click puts the dial back at neutral.
            <div key={dial} onDoubleClick={() => onDial({ [dial]: NEUTRAL_ADJUST[dial] }, `grade:${dial}:reset`)} title="Double-click to reset">
              <Slider
                label={label}
                value={first[dial]}
                min={min}
                max={max}
                step={step}
                format={format}
                marker={adjusts.some((adjust) => adjust[dial] !== first[dial]) ? <Mixed /> : undefined}
                onChange={(value) => onDial({ [dial]: value }, `grade:${dial}`)}
              />
            </div>
          ))}
        </Group>
      ))}
    </section>
  );
}
