import { Check, ChevronDown, Clapperboard, SlidersHorizontal } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { api, type Aspect, type ExportPresetList } from "../../api";
import { Button, buttonClass } from "../../components/Button";
import { formatBytes } from "../../format";

// The menu's distance from its button, and from the window's edges.
const GAP_PX = 4;
const EDGE_PX = 8;

/**
 * A Render button split in two: the main part renders with the Export Preset `picked`, and its menu
 * lists the Presets (the default marked), where choosing one renders with it. The menu says how big
 * the `batch` comes to with the picked Preset, and ends with "Export Presets…" (`onManage`). Without
 * the Presets (still loading, or failed to), it renders with the default and has no menu.
 */
export function RenderButton({
  label,
  presets,
  picked,
  onRender,
  variant = "secondary",
  disabled,
  batch,
  onManage,
  icon = <Clapperboard aria-hidden size={16} />,
}: {
  label: string;
  presets: ExportPresetList | null;
  picked: string | null;
  onRender: (exportPresetId?: string) => void;
  variant?: "primary" | "secondary";
  disabled?: boolean;
  // The Clips it renders: how long they last in all of each Canvas Aspect (batchParts), and the Source's frame rate.
  batch?: { parts: { aspect: Aspect; secs: number }[]; fps: number } | null;
  onManage?: () => void;
  icon?: ReactNode;
}) {
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const id = useId();
  const chosen = presets?.presets.find((preset) => preset.id === picked);
  const name = chosen?.name;
  // The batch's estimated size with the picked Preset, asked for while the menu is open.
  const [total, setTotal] = useState<number | null>(null);
  const settings = chosen && JSON.stringify(chosen.settings);
  const parts = batch && JSON.stringify(batch.parts.filter((part) => part.secs > 0));
  useEffect(() => {
    setTotal(null);
    const shapes: { aspect: Aspect; secs: number }[] = parts ? JSON.parse(parts) : [];
    if (!open || !settings || !batch || shapes.length === 0) return;
    let current = true;
    // One estimate per aspect in the batch, added up.
    Promise.all(shapes.map((part) => api.estimateExport(JSON.parse(settings), part.secs, batch.fps, part.aspect))).then(
      (sizes) => current && setTotal(sizes.reduce((sum, bytes) => sum + bytes, 0)),
      () => {},
    );
    return () => void (current = false);
  }, [open, settings, parts, batch?.fps]);

  // The menu is a popover in the top layer, so that a scrolling panel doesn't clip it; light dismiss and Escape close it.
  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    const toggled = (event: Event) => setOpen((event as ToggleEvent).newState === "open");
    element.addEventListener("toggle", toggled);
    return () => element.removeEventListener("toggle", toggled);
  }, [presets !== null]);

  function show() {
    const anchor = toggle.current?.getBoundingClientRect();
    const element = menu.current;
    if (!anchor || !element) return;
    element.showPopover();
    // Under the button, its right edge at the button's, kept in the window.
    const left = Math.min(Math.max(anchor.right - element.offsetWidth, EDGE_PX), window.innerWidth - element.offsetWidth - EDGE_PX);
    const below = anchor.bottom + GAP_PX;
    const top = below + element.offsetHeight > window.innerHeight - EDGE_PX ? anchor.top - GAP_PX - element.offsetHeight : below;
    element.style.left = `${left}px`;
    element.style.top = `${Math.max(EDGE_PX, top)}px`;
  }
  const hide = () => {
    if (menu.current?.matches(":popover-open")) menu.current.hidePopover();
  };

  return (
    <div className="inline-flex">
      <Button
        variant={variant}
        size="sm"
        disabled={disabled}
        onClick={() => onRender(picked ?? undefined)}
        title={name && `Render with ${name}`}
        className={presets ? "rounded-r-none!" : undefined}
      >
        {icon}
        {label}
      </Button>
      {presets && (
        <>
          <button
            ref={toggle}
            type="button"
            disabled={disabled}
            aria-label={`Export Preset: ${name ?? "default"}`}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={id}
            onClick={() => (open ? hide() : show())}
            className={buttonClass(variant, "sm", "rounded-l-none! border-l border-black/15 px-2!")}
          >
            <ChevronDown aria-hidden size={16} />
          </button>
          <div
            ref={menu}
            id={id}
            role="menu"
            aria-label="Export Presets"
            {...{ popover: "auto" }}
            className="glass fixed inset-auto m-0 min-w-56 flex-col rounded-[10px] bg-bg/90! p-1 text-text [&:popover-open]:flex"
          >
            {total !== null && (
              <p className="px-2 pt-1 pb-1.5 text-xs text-muted tabular-nums">
                About {formatBytes(total)} with {name}
              </p>
            )}
            {presets.presets.map((preset) => (
              <button
                key={preset.id}
                type="button"
                role="menuitemradio"
                aria-checked={preset.id === picked}
                onClick={() => (hide(), onRender(preset.id))}
                className="flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-fill"
              >
                <Check aria-hidden size={14} className={preset.id === picked ? "shrink-0 text-accent-text" : "shrink-0 invisible"} />
                <span className="min-w-0 flex-1 truncate">{preset.name}</span>
                {preset.id === presets.default && <span className="shrink-0 text-xs text-muted">Default</span>}
              </button>
            ))}
            {onManage && (
              <>
                <hr className="my-1 border-border" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => (hide(), onManage())}
                  className="flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-fill"
                >
                  <SlidersHorizontal aria-hidden size={14} className="shrink-0 text-muted" />
                  <span className="min-w-0 flex-1 truncate">Export Presets…</span>
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
