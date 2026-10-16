import { useContext, useId } from "react";
import type { Ease, KeyProperty, MediaItem } from "../../../api";
import { EASE_PRESETS, easedKey, easeName, keyAt, setEase, type EaseName } from "../editor/keyframes";
import { KeyingContext, useKeyTime, type Keying } from "./KeyCluster";
import { activeKey, keyedItem, keyRows, keyTime, pickedKeyed, setItemKeys } from "./keying";

/** Each keyable property's name, its unit, and how many of them make one of its value. */
export const KEY_FIELDS: Record<KeyProperty, { label: string; unit: string; scale: number }> = {
  x: { label: "X", unit: "px", scale: 1 },
  y: { label: "Y", unit: "px", scale: 1 },
  scale: { label: "Scale", unit: "%", scale: 100 },
  rotation: { label: "Rotation", unit: "°", scale: 1 },
  opacity: { label: "Opacity", unit: "%", scale: 100 },
  volume: { label: "Volume", unit: "%", scale: 100 },
};

// The Ease select's choices: the presets, and Custom, which a handle's drag makes (not picked here).
const EASE_CHOICES: { value: EaseName; label: string }[] = [...EASE_PRESETS.map(({ name, label }) => ({ value: name, label })), { value: "custom", label: "Custom" }];

/**
 * How a Keyframe is eased into (`value`; null when there is none to ease): one of the presets picked.
 * Custom is shown, not picked. In a phone's sheet, as large as its other fields.
 */
export function EaseSelect({ label = "Ease", value, disabled, onChange }: { label?: string; value: EaseName | null; disabled: boolean; onChange: (ease: Ease) => void }) {
  const id = useId();
  return (
    <div className="flex items-center gap-1.5 in-data-sheet:justify-between in-data-sheet:gap-3">
      <label htmlFor={id} className="text-sm text-muted in-data-sheet:font-medium in-data-sheet:text-text">
        {label}
      </label>
      <select
        id={id}
        value={value ?? ""}
        disabled={disabled}
        title={value === null ? "No Keyframe at the playhead or after it eases in" : "How the Keyframe at the playhead, or the next one, is eased into"}
        onChange={(event) => {
          const preset = EASE_PRESETS.find((choice) => choice.name === event.target.value);
          if (preset) onChange(preset.ease);
        }}
        className="min-h-8 cursor-pointer rounded-lg border border-border bg-fill px-2 text-sm disabled:cursor-default disabled:opacity-50 in-data-sheet:min-h-11 in-data-sheet:min-w-40 in-data-sheet:rounded-[10px] in-data-sheet:px-3 in-data-sheet:text-base"
      >
        {value === null && <option value="">None</option>}
        {EASE_CHOICES.map((choice) => (
          <option key={choice.value} value={choice.value} disabled={choice.value === "custom"}>
            {choice.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * On a phone, where the Keyframes pane isn't, the sheet's Ease picker (ADR 0008): of the picked
 * item's Keyframe at the playhead, or of the next eased one, on its active row (activeKey) when that
 * is keyed, else on its first keyed property, as one change: of those the sheet shows (`shown`, all
 * by default). Nothing while the item has none of them keyed; off with the playhead outside it.
 */
export function SheetEase({ mediaById, shown }: { mediaById: Map<string, MediaItem>; shown?: readonly KeyProperty[] }) {
  const keying = useContext(KeyingContext);
  return keying ? <Picker keying={keying} mediaById={mediaById} shown={shown} /> : null;
}

function Picker({ keying, mediaById, shown }: { keying: Keying; mediaById: Map<string, MediaItem>; shown?: readonly KeyProperty[] }) {
  const time = useKeyTime(keying.playback);
  const ref = pickedKeyed(keying.pick);
  const item = ref && keyedItem(keying.edits, ref, keying.track);
  if (!ref || !item) return null;
  const keyed = keyRows(keying.edits, ref, mediaById).filter((prop) => item.keys[prop]?.length && (!shown || shown.includes(prop)));
  if (!keyed.length) return null;
  const prop = activeKey(keyed, item.keys, keying.touched ?? null);
  const list = item.keys[prop] ?? [];
  const at = keyTime(item, time);
  const held = at ?? Math.min(Math.max(time - item.start, 0), item.secs);
  const index = easedKey(list, held);
  const { label } = KEY_FIELDS[prop];
  const note =
    at === null
      ? "Put the playhead on it to change its Ease."
      : index < 0
        ? `No ${label} Keyframe here or after it eases in.`
        : keyAt(list, at) !== index
          ? `Of the next ${label} Keyframe.`
          : null;
  return (
    <div className="mb-4 flex flex-col gap-1 border-b border-border pb-3">
      <EaseSelect
        label={`${label} Ease`}
        value={index >= 0 ? easeName(list[index].ease) : null}
        disabled={index < 0 || at === null}
        onChange={(ease) => {
          const outcome = setItemKeys(keying, ref, prop, setEase(list, index, ease));
          if (outcome) keying.onEdits(outcome.edits);
        }}
      />
      {note && <p className="text-sm text-pretty text-muted">{note}</p>}
    </div>
  );
}
