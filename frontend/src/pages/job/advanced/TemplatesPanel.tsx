import { Ban, Ellipsis, LayoutTemplate, LoaderCircle, Star } from "lucide-react";
import { useState } from "react";
import { api, templatePosterUrl, type TemplateInfo } from "../../../api";
import { Button, buttonClass } from "../../../components/Button";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { Hint } from "../../../components/InfoTip";
import { Menu, MenuItem, useMenu } from "../../../components/Menu";
import { cx } from "../../../format";
import { changeTemplates, useTemplates } from "../../../templates";
import { partsLabel } from "./templating";

// What is being applied: a Template's id, or NONE for "No Template".
const NONE = "";

/**
 * The Templates tab (desktop) or sheet (phone): the owner's Templates as cards, a click applying one
 * to this clip (`onApply`, one draft change, one step of undo), and "No Template" taking a Template's
 * items off. On a desktop, each card's menu renames, deletes or makes it the default; a phone offers
 * Apply and "No Template" only.
 */
export function TemplatesPanel({ phone = false, onApply }: { phone?: boolean; onApply: (template: TemplateInfo | null) => Promise<void> }) {
  const templates = useTemplates();
  const [applying, setApplying] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<TemplateInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function apply(template: TemplateInfo | null) {
    setApplying(template?.id ?? NONE);
    setError(null);
    try {
      await onApply(template);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setApplying(null);
    }
  }

  async function act(change: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await changeTemplates(change);
      return true;
    } catch (reason) {
      setError((reason as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <TemplateCards
        templates={templates}
        phone={phone}
        applying={applying}
        renaming={renaming}
        busy={busy}
        error={error}
        onApply={(template) => void apply(template)}
        onRename={setRenaming}
        onRenamed={async (template, name) => {
          if (await act(() => api.renameTemplate(template.id, name))) setRenaming(null);
        }}
        onDelete={setDeleting}
        onDefault={(template) => void act(() => api.useTemplateAsDefault(template.default ? null : template.id))}
      />
      {!phone && (
        <ConfirmDialog
          open={deleting !== null}
          title={`Delete the Template “${deleting?.name ?? ""}”?`}
          confirmLabel="Delete Template"
          busyLabel="Deleting…"
          busy={busy}
          error={error}
          onConfirm={async () => {
            if (deleting && (await act(() => api.deleteTemplate(deleting.id)))) setDeleting(null);
          }}
          onCancel={() => setDeleting(null)}
        >
          {deleting?.default ? "New Jobs then get no Template. " : ""}
          The clips it was applied to keep its items.
        </ConfirmDialog>
      )}
    </>
  );
}

/**
 * The Templates' cards: each its poster, its name, its intro's and outro's lengths and a star on the
 * default; a click applies it (`onApply`). "No Template" heads them. With `phone`, that is all; on a
 * desktop, each card's menu offers Rename (its name then edited in place, `onRenamed`), Make default
 * (or No default) and Delete.
 */
export function TemplateCards({
  templates,
  phone,
  applying,
  renaming,
  busy,
  error,
  onApply,
  onRename,
  onRenamed,
  onDelete,
  onDefault,
}: {
  templates: TemplateInfo[] | null;
  phone: boolean;
  // The Template being applied (its id, "" for "No Template"), or null.
  applying: string | null;
  // The Template whose name is being changed, on a desktop.
  renaming: string | null;
  busy: boolean;
  error: string | null;
  onApply: (template: TemplateInfo | null) => void;
  onRename: (id: string | null) => void;
  onRenamed: (template: TemplateInfo, name: string) => void;
  onDelete: (template: TemplateInfo) => void;
  onDefault: (template: TemplateInfo) => void;
}) {
  if (!templates) return <Hint>Loading the Templates…</Hint>;
  const working = applying !== null;
  return (
    <div className="flex flex-col gap-4">
      {templates.length ? (
        <Hint more="It replaces the items a Template put on this clip before, and moves your own layers with the clip's start. Its notices say what was cut or left out.">
          {phone ? "Tap" : "Click"} a Template to apply it to this clip; undo takes it back.
        </Hint>
      ) : (
        <Hint>{phone ? "No Templates yet: save one from the Advanced Edit on a computer." : "No Templates yet: save this clip's edit as one with “Save as Template…” at the top."}</Hint>
      )}
      <Button size="sm" className="self-start" disabled={working} onClick={() => onApply(null)}>
        {applying === NONE ? <LoaderCircle aria-hidden size={16} className="motion-safe:animate-spin" /> : <Ban aria-hidden size={16} />}
        No Template
      </Button>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            phone={phone}
            applying={applying === template.id}
            disabled={working || busy}
            renaming={renaming === template.id}
            onApply={() => onApply(template)}
            onRename={onRename}
            onRenamed={(name) => onRenamed(template, name)}
            onDelete={() => onDelete(template)}
            onDefault={() => onDefault(template)}
          />
        ))}
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  phone,
  applying,
  disabled,
  renaming,
  onApply,
  onRename,
  onRenamed,
  onDelete,
  onDefault,
}: {
  template: TemplateInfo;
  phone: boolean;
  applying: boolean;
  disabled: boolean;
  renaming: boolean;
  onApply: () => void;
  onRename: (id: string | null) => void;
  onRenamed: (name: string) => void;
  onDelete: () => void;
  onDefault: () => void;
}) {
  const [poster, setPoster] = useState(true);
  return (
    <div className="group relative flex min-w-0 flex-col" data-template={template.id}>
      <button
        type="button"
        onClick={onApply}
        disabled={disabled || renaming}
        aria-label={`Apply ${template.name}`}
        className={cx(
          "raised flex min-h-11 w-full flex-col gap-1.5 rounded-[10px] p-1.5 text-left text-xs font-medium hover:bg-fill disabled:opacity-60",
          "focus-visible:outline-2 focus-visible:outline-focus",
        )}
      >
        <div aria-hidden className="relative grid aspect-[9/16] w-full place-items-center overflow-hidden rounded-md bg-black text-white/50">
          {poster ? (
            <img src={templatePosterUrl(template)} alt="" loading="lazy" onError={() => setPoster(false)} className="absolute inset-0 size-full object-cover" />
          ) : (
            <LayoutTemplate size={24} />
          )}
          {applying && (
            <span className="absolute inset-0 grid place-items-center bg-black/50 text-white">
              <LoaderCircle size={20} className="motion-safe:animate-spin" />
            </span>
          )}
          {template.default && (
            <span className="absolute top-1.5 left-1.5 grid size-6 place-items-center rounded-md bg-black/60 text-white">
              <Star size={13} fill="currentColor" />
            </span>
          )}
        </div>
        {!renaming && (
          <span className="flex min-w-0 flex-col gap-0.5 px-0.5">
            <span className="truncate">{template.name}</span>
            <span className="truncate font-normal text-muted tabular-nums">{partsLabel(template)}</span>
            {template.default && <span className="sr-only">Default for new Jobs</span>}
          </span>
        )}
      </button>
      {renaming && <RenameField name={template.name} disabled={disabled} onSave={onRenamed} onCancel={() => onRename(null)} />}
      {!phone && !renaming && (
        <CardMenu template={template} disabled={disabled} onRename={() => onRename(template.id)} onDelete={onDelete} onDefault={onDefault} />
      )}
    </div>
  );
}

// A desktop card's menu: Rename, Make default (or No default) and Delete.
function CardMenu({
  template,
  disabled,
  onRename,
  onDelete,
  onDefault,
}: {
  template: TemplateInfo;
  disabled: boolean;
  onRename: () => void;
  onDelete: () => void;
  onDefault: () => void;
}) {
  const { buttonRef, menuRef, open, hide, toggle } = useMenu();
  const run = (action: () => void) => () => {
    hide();
    action();
  };
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        aria-label={`More for ${template.name}`}
        title="More"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
        className={cx(
          "absolute top-2.5 right-2.5 grid size-7 place-items-center rounded-md bg-black/60 text-white hover:bg-black/80",
          "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-focus aria-expanded:opacity-100 [@media(hover:none)]:opacity-100",
        )}
      >
        <Ellipsis aria-hidden size={14} />
      </button>
      <Menu ref={menuRef} label={`${template.name} actions`}>
        <MenuItem onClick={run(onRename)}>Rename</MenuItem>
        <MenuItem onClick={run(onDefault)}>{template.default ? "No default" : "Make default"}</MenuItem>
        <MenuItem danger onClick={run(onDelete)}>
          Delete
        </MenuItem>
      </Menu>
    </>
  );
}

// A card's name changed in place: Enter or Save keeps it, Esc or Cancel leaves it.
function RenameField({ name, disabled, onSave, onCancel }: { name: string; disabled: boolean; onSave: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(name);
  const trimmed = value.trim();
  return (
    <form
      className="flex flex-col gap-1.5 pt-1.5"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed && trimmed !== name) onSave(trimmed);
        else onCancel();
      }}
    >
      <input
        aria-label="Template name"
        value={value}
        maxLength={60}
        autoFocus
        disabled={disabled}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Escape") onCancel();
        }}
        className="min-h-9 w-full min-w-0 rounded-[10px] border border-border bg-fill px-2 text-base sm:text-sm"
      />
      <div className="flex gap-1">
        <button type="submit" disabled={disabled || !trimmed} className={buttonClass("primary", "sm", "flex-1")}>
          Save
        </button>
        <button type="button" onClick={onCancel} disabled={disabled} className={buttonClass("ghost", "sm", "flex-1")}>
          Cancel
        </button>
      </div>
    </form>
  );
}
