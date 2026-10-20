import { ChevronDown, RotateCcw, X } from "lucide-react";
import { useId } from "react";
import type { Adjust, Grade, Look } from "../../../api";
import { Button } from "../../../components/Button";
import { Slider } from "../../../components/Slider";
import { shelvesOf, useLooks } from "../../../looks";
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

// The value of the Look picker's "no Look".
const NO_LOOK = "";

/**
 * The Color section (ADR 0013): the Grades of the picked Segments and Overlays, `grades`, by their Look
 * and its intensity, then their Adjust dials in groups (Color, Lightness, Effects), each shown as the
 * first one's, a field the Grades differ in marked Mixed. Picking a Look, or moving its intensity,
 * sets it on every one (`onLook`); Remove takes the Look away and keeps the dials. Moving a dial sets
 * it on every one (`onDial`, a change of its group); a double-click puts it back at neutral, and Reset
 * makes every dial neutral and takes the Look away (`onReset`). `looks` is the catalogue's by default.
 */
export function ColorFields({
  grades,
  onDial,
  onReset,
  onLook,
  looks: given,
}: {
  grades: (Grade | null | undefined)[];
  onDial: (change: Partial<Adjust>, group: string) => void;
  onReset: () => void;
  onLook: (change: { look?: string | null; intensity?: number }, group?: string) => void;
  looks?: Look[] | null;
}) {
  const listed = useLooks();
  const looks = given ?? listed ?? [];
  const whole = grades.map(gradeOf);
  const adjusts = whole.map((grade) => grade.adjust);
  const [first = NEUTRAL_ADJUST] = adjusts;
  const [firstGrade] = whole;
  const look = firstGrade?.look ?? null;
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
      <LookPicker
        looks={looks}
        value={look}
        mixed={whole.some((grade) => grade.look !== look)}
        onChange={(picked) => onLook({ look: picked })}
      />
      {look !== null && (
        <>
          <Slider
            label="Intensity"
            value={firstGrade.intensity}
            min={0}
            max={100}
            step={1}
            format={(value) => `${Math.round(value)}%`}
            marker={whole.some((grade) => grade.intensity !== firstGrade.intensity) ? <Mixed /> : undefined}
            onChange={(intensity) => onLook({ intensity }, "grade:intensity")}
          />
          <Button size="sm" variant="ghost" className="self-start" onClick={() => onLook({ look: null })} title="Take the Look away, keeping the dials">
            <X aria-hidden size={15} />
            Remove look
          </Button>
        </>
      )}
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

// The Look picker: None, then the Looks by category. A Look not in the catalogue (yet) is listed by its id.
function LookPicker({ looks, value, mixed, onChange }: { looks: Look[]; value: string | null; mixed: boolean; onChange: (look: string | null) => void }) {
  const id = useId();
  const known = value === null || looks.some((look) => look.id === value);
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="flex items-center gap-1.5 text-sm font-medium">
        Look
        {mixed && <Mixed />}
      </label>
      <div className="relative">
        <select
          id={id}
          value={value ?? NO_LOOK}
          onChange={(event) => onChange(event.target.value === NO_LOOK ? null : event.target.value)}
          className="min-h-10 w-full cursor-pointer appearance-none truncate rounded-[10px] border border-border bg-fill py-2 pr-9 pl-3 text-base"
        >
          <option value={NO_LOOK}>None</option>
          {!known && <option value={value!}>{value}</option>}
          {shelvesOf(looks).map(({ category, looks: shelf }) => (
            <optgroup key={category} label={category}>
              {shelf.map((look) => (
                <option key={look.id} value={look.id}>
                  {look.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <ChevronDown aria-hidden size={16} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
      </div>
    </div>
  );
}
