import { Check, ChevronDown, Italic, Search } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import type { FontImported, FontInfo } from "../../../api";
import { Hint, InfoTip } from "../../../components/InfoTip";
import { Select } from "../../../components/Select";
import { cx } from "../../../format";
import { fontFamily } from "../../../fonts";
import { ImportFont } from "./ImportFont";
import { faceAt, families, familyOf, italicOffered, searchFamilies, weightName, weightsOf, type Family } from "./faces";

// The list's distance from its button, and from the window's edges; below the button unless there is
// less room than this there and more above.
const GAP_PX = 6;
const EDGE_PX = 8;
const ROOM_PX = 320;
const WIDTH_PX = 352;

const keyOf = (family: Family) => `${family.imported ? "imported" : "bundled"}:${family.name}`;

/**
 * The font of a style: a button showing its family, which opens a list of the families that can be
 * searched by name, each drawn in its own face, with Import font under it; and the family's weights
 * and italic beside it. Each choice is a Face of its own, so each changes the Face id. An imported
 * family says so, with its licence, and warns when its font says it may not be embedded.
 */
export function FacePicker({
  label = "Font",
  value,
  fonts,
  onChange,
  marker,
  className,
}: {
  label?: string;
  // A Face id.
  value: string;
  fonts: FontInfo[] | null;
  onChange: (id: string) => void;
  marker?: ReactNode;
  className?: string;
}) {
  const id = useId();
  const listed = useMemo(() => families(fonts ?? []), [fonts]);
  const family = familyOf(listed, value);
  const font = family?.faces.find((face) => face.id === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  // The family the arrow keys are on; null: the picked one, or the first found.
  const [active, setActive] = useState<string | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  const found = searchFamilies(listed, query);
  const activeIndex = Math.max(0, found.findIndex((other) => keyOf(other) === (active ?? (family && keyOf(family)))));
  const weight = font?.weight ?? 400;
  const italic = font?.italic ?? false;
  const optionId = (index: number) => `${id}-option-${index}`;

  // Opened (by its button) or closed (by a pick, Escape or a click elsewhere).
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const toggled = (event: Event) => {
      const opened = (event as ToggleEvent).newState === "open";
      setOpen(opened);
      setQuery("");
      setActive(null);
    };
    element.addEventListener("toggle", toggled);
    return () => element.removeEventListener("toggle", toggled);
  }, []);

  useEffect(() => {
    if (!open) return;
    place();
    // Not on a touch screen, where the keyboard would cover the list.
    if (matchMedia("(pointer: fine)").matches) input.current?.focus();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open]);

  useEffect(() => {
    if (open) document.getElementById(optionId(activeIndex))?.scrollIntoView({ block: "nearest" });
  });

  // Under the button (over it where there is more room there), as wide as it or WIDTH_PX, in the window.
  function place() {
    const anchor = button.current?.getBoundingClientRect();
    const element = panel.current;
    if (!anchor || !element) return;
    const width = Math.min(Math.max(anchor.width, WIDTH_PX), window.innerWidth - 2 * EDGE_PX);
    const below = window.innerHeight - anchor.bottom - GAP_PX - EDGE_PX;
    const above = anchor.top - GAP_PX - EDGE_PX;
    const down = below >= ROOM_PX || below >= above;
    element.style.width = `${width}px`;
    element.style.left = `${Math.min(Math.max(anchor.left, EDGE_PX), window.innerWidth - width - EDGE_PX)}px`;
    element.style.maxHeight = `${Math.max(down ? below : above, 0)}px`;
    element.style.top = down ? `${anchor.bottom + GAP_PX}px` : "auto";
    element.style.bottom = down ? "auto" : `${window.innerHeight - anchor.top + GAP_PX}px`;
  }

  function pick(next: Family) {
    onChange(faceAt(next, weight, italic).id);
    panel.current?.hidePopover();
    button.current?.focus();
  }

  function imported(result: FontImported) {
    const face = result.faces[0] ?? result.existing[0];
    if (face) onChange(face.id);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const step = { ArrowDown: 1, ArrowUp: -1 }[event.key];
    if (step !== undefined && found.length) {
      event.preventDefault();
      setActive(keyOf(found[Math.min(Math.max(activeIndex + step, 0), found.length - 1)]));
    } else if (event.key === "Enter" && found[activeIndex]) {
      event.preventDefault();
      pick(found[activeIndex]);
    }
  }

  const weights = family ? weightsOf(family) : [];
  return (
    <div className={cx("flex min-w-0 flex-col gap-2", className)}>
      <div className="flex min-w-0 flex-col gap-1">
        <span id={`${id}-label`} className="flex items-center gap-1.5 text-sm font-medium">
          {label}
          {marker}
        </span>
        <button
          ref={button}
          type="button"
          id={`${id}-button`}
          aria-labelledby={`${id}-label ${id}-button`}
          {...{ popovertarget: `${id}-panel` }}
          className="relative min-h-10 w-full cursor-pointer truncate rounded-[10px] border border-border bg-fill py-2 pr-9 pl-3 text-left text-base"
          style={font ? { fontFamily: fontFamily(font.id) } : undefined}
        >
          {family?.name ?? value}
          <ChevronDown aria-hidden size={16} className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-muted" />
        </button>
      </div>
      {family && font && (
        <div className="flex items-end gap-2">
          <Select
            label="Weight"
            value={String(font.weight)}
            options={weights.map((other) => ({ value: String(other), label: weightName(other) }))}
            onChange={(other) => onChange(faceAt(family, Number(other), font.italic).id)}
            disabled={weights.length < 2}
            className="flex-1"
          />
          {family.faces.some((face) => face.italic) && (
            <button
              type="button"
              aria-pressed={font.italic}
              aria-label="Italic"
              title={italicOffered(family, font) ? "Italic" : `No ${font.italic ? "upright" : "italic"} ${weightName(font.weight)} in ${family.name}`}
              disabled={!italicOffered(family, font)}
              onClick={() => onChange(faceAt(family, font.weight, !font.italic).id)}
              className="inline-flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-border bg-fill enabled:cursor-pointer disabled:opacity-50 aria-pressed:text-accent-text aria-pressed:ring-2 aria-pressed:ring-accent aria-pressed:ring-inset"
            >
              <Italic aria-hidden size={16} />
            </button>
          )}
        </div>
      )}
      {font && !font.bundled && (
        <div className="flex items-center gap-1 text-sm text-muted">
          <span>Imported font</span>
          <InfoTip label={`About ${font.label}'s licence`}>
            <span className="flex max-h-48 flex-col gap-2 overflow-y-auto">
              <span>{font.copyright || "Its font names no copyright."}</span>
              {font.licence && <span className="whitespace-pre-line">{font.licence}</span>}
              {font.licence_url && (
                <a href={font.licence_url} target="_blank" rel="noreferrer" className="break-all text-accent-text underline">
                  {font.licence_url}
                </a>
              )}
            </span>
          </InfoTip>
        </div>
      )}
      {font?.restricted && (
        <p className="text-sm text-pretty text-danger">Its licence says it may not be embedded. Check that you may use it in your videos.</p>
      )}

      <div
        ref={panel}
        id={`${id}-panel`}
        role="dialog"
        aria-label={`Choose the ${label.toLowerCase()}`}
        // Light dismiss (a click elsewhere) and Escape close it.
        {...{ popover: "auto" }}
        className="glass fixed inset-auto m-0 flex-col overflow-hidden rounded-[14px] bg-bg/90! p-0 text-text [&:popover-open]:flex"
      >
        <div className="relative shrink-0 border-b border-border p-2">
          <Search aria-hidden size={16} className="pointer-events-none absolute top-1/2 left-5 -translate-y-1/2 text-muted" />
          <input
            ref={input}
            type="search"
            role="combobox"
            aria-label="Search fonts"
            aria-expanded={open}
            aria-controls={`${id}-list`}
            aria-autocomplete="list"
            aria-activedescendant={found.length ? optionId(activeIndex) : undefined}
            placeholder="Search fonts"
            autoComplete="off"
            spellCheck={false}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActive(null);
            }}
            onKeyDown={onKeyDown}
            className="min-h-10 w-full rounded-[10px] border border-border bg-fill pr-3 pl-9 text-base"
          />
        </div>
        <div role="listbox" id={`${id}-list`} aria-label="Fonts" className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-1">
          {found.map((other, index) => {
            const shown = faceAt(other, weight, italic);
            const picked = other === family;
            return (
              <div
                key={keyOf(other)}
                id={optionId(index)}
                role="option"
                aria-selected={picked}
                onClick={() => pick(other)}
                onMouseMove={() => index !== activeIndex && setActive(keyOf(other))}
                className={cx(
                  "flex min-h-11 cursor-pointer items-center gap-2 rounded-[10px] px-3 py-1.5",
                  index === activeIndex && "bg-fill",
                )}
              >
                <Check aria-hidden size={16} className={cx("shrink-0 text-accent-text", !picked && "invisible")} />
                <span className="min-w-0 flex-1 truncate text-lg leading-tight" style={{ fontFamily: fontFamily(shown.id) }}>
                  {other.name}
                </span>
                {other.imported && <span className="shrink-0 rounded-full bg-fill px-2 py-0.5 text-xs text-muted">Imported</span>}
                {other.faces.length > 1 && <span className="shrink-0 text-xs text-muted">{other.faces.length} styles</span>}
              </div>
            );
          })}
        </div>
        {!found.length && <p className="px-4 py-3 text-sm text-muted">{listed.length ? "No font has that in its name." : "Loading the fonts…"}</p>}
        <div className="flex shrink-0 flex-col gap-2 border-t border-border p-3">
          <Hint>Your own font file (TTF, OTF or TTC) joins the list for every Job.</Hint>
          <ImportFont onImported={imported} />
        </div>
      </div>
    </div>
  );
}
