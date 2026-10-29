import { ArrowUp, Bot, ChevronDown, FileText, Plus, Settings2, Square } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { AgentAttachment, AgentProviderListing } from "../../../../api";
import { Button, buttonClass } from "../../../../components/Button";
import { Menu, MenuItem, useMenu } from "../../../../components/Menu";
import { Select } from "../../../../components/Select";
import { cx } from "../../../../format";
import { keepEscape } from "../AudioEffectsFields";
import { AttachmentChips } from "./AttachmentChips";
import { attachTextFiles, TEXT_FILE_TYPES } from "./attachments";
import { ThinkingOrb } from "./ThinkingOrb";

// The message box grows with its text up to this, then scrolls.
const MAX_HEIGHT_PX = 160;

/**
 * The chat's framed message box: Enter sends, Shift+Enter breaks the line, Esc (or ⌘. anywhere)
 * stops a running turn. Above its text, the Agent Attachments going with it as chips (the first ones
 * `defaultAttachments`); under it a toolbar with the + that attaches them,
 * the Provider pill, then the Model pill (each opening its picker), the provider's setup and Send, or Stop
 * while a turn runs. Its text and attachments are its own state, emptied once `onSend` says they went. While the provider is being set up (`setup`) it is
 * only the toolbar, so that another provider can still be picked.
 */
export function Composer({
  providers,
  listing,
  models,
  model,
  onChoose,
  setup,
  setupOpen,
  onSetup,
  busy,
  running,
  onSend,
  onStop,
  defaultAttachments = NO_ATTACHMENTS,
}: {
  providers: AgentProviderListing[];
  listing: AgentProviderListing;
  models: string[];
  model: string | null;
  onChoose: (provider: string, model: string | null) => void;
  setup: boolean;
  setupOpen: boolean;
  onSetup: () => void;
  busy: boolean;
  running: boolean;
  onSend: (prompt: string, attachments: AgentAttachment[]) => Promise<boolean>;
  onStop: () => void;
  defaultAttachments?: AgentAttachment[];
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState(defaultAttachments);
  // Why the last files chosen weren't all attached.
  const [attachError, setAttachError] = useState<string | null>(null);
  const prompt = text.trim();
  const area = useRef<HTMLTextAreaElement>(null);

  // Autosize: as tall as its text, up to MAX_HEIGHT_PX.
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text, setup]);

  const send = async () => {
    if (!prompt || busy || !(await onSend(prompt, attachments))) return;
    setText("");
    setAttachments(NO_ATTACHMENTS);
    setAttachError(null);
  };

  const attachText = async (files: File[]) => {
    const added = await attachTextFiles(attachments, files);
    setAttachments(added.attached);
    setAttachError(added.error);
    area.current?.focus();
  };

  const remove = (index: number) => {
    setAttachments((all) => all.filter((_, i) => i !== index));
    setAttachError(null);
    area.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    // Esc in the message box stops a running turn.
    if (event.key === "Escape" && running) {
      event.preventDefault();
      onStop();
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    void send();
  };

  // ⌘. (Ctrl+. elsewhere) stops a running turn from anywhere in the editor.
  useEffect(() => {
    if (!running) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "." || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      onStop();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [running, onStop]);

  return (
    <div data-composer={setup ? undefined : ""} className="shrink-0 px-3 pt-1 pb-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="rounded-2xl border border-border bg-fill shadow-sm transition-colors focus-within:border-text/50"
      >
        {!setup && <AttachmentChips attachments={attachments} onRemove={remove} className="px-3 pt-3" />}
        {!setup && attachError && (
          <p role="alert" className="px-4 pt-2 text-xs text-danger">
            {attachError}
          </p>
        )}
        {!setup && (
          <textarea
            ref={area}
            aria-label="Message the Agent"
            rows={1}
            value={text}
            placeholder="Describe a change…"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            className="block w-full resize-none overflow-y-auto bg-transparent px-4 pt-3.5 pb-2 text-base caret-text outline-none placeholder:text-muted"
          />
        )}
        <div className={cx("box-content flex h-8 items-center gap-1 px-2.5 pb-2.5", setup && "pt-2.5")}>
          {!setup && <AddMenu onTextFiles={(files) => void attachText(files)} />}
          <Pill title="Provider" icon={<Bot aria-hidden size={15} className="shrink-0" />} text={listing.provider.label}>
            <Select
              label="Provider"
              value={listing.provider.id}
              options={providers.map(({ provider, status }) => ({ value: provider.id, label: status.ready ? provider.label : `${provider.label} (set up)` }))}
              onChange={(provider) => onChoose(provider, null)}
            />
          </Pill>
          <span className="ml-auto" />
          {models.length > 0 && model && (
            <Pill title="Model" text={model} muted>
              <Select label="Model" value={model} options={models.map((name) => ({ value: name, label: name }))} onChange={(name) => onChoose(listing.provider.id, name)} />
            </Pill>
          )}
          {listing.status.ready && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="aria-pressed:bg-fill aria-pressed:text-text"
              aria-label={`Set up ${listing.provider.label}`}
              aria-pressed={setupOpen}
              title={`Set up ${listing.provider.label}`}
              onClick={onSetup}
            >
              <Settings2 aria-hidden size={15} />
            </Button>
          )}
          {setup ? null : running ? (
            // The square says what a click does; the orb turns small behind it while the Agent works.
            <Button variant="secondary" size="icon-round" aria-label="Stop" title="Stop (Esc)" onClick={onStop}>
              <span className="grid place-items-center *:[grid-area:1/1]">
                <ThinkingOrb size={20} className="opacity-70" />
                <Square aria-hidden size={9} className="relative fill-current" />
              </span>
            </Button>
          ) : (
            <Button type="submit" variant="solid" size="icon-round" aria-label="Send" title="Send (Enter)" disabled={!prompt || busy}>
              <ArrowUp aria-hidden size={16} />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

const NO_ATTACHMENTS: AgentAttachment[] = [];

/** The toolbar's +: a menu of what can go with the message, each kind's file picker hidden behind its item. */
function AddMenu({ onTextFiles }: { onTextFiles: (files: File[]) => void }) {
  const { buttonRef, menuRef, open, hide, toggle } = useMenu({ align: "start" });
  const textFiles = useRef<HTMLInputElement>(null);
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={buttonClass("ghost", "icon-sm")}
        aria-label="Add to message"
        title="Add to message"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <Plus aria-hidden size={16} />
      </button>
      <Menu ref={menuRef} label="Add to message">
        <MenuItem
          onClick={() => {
            hide();
            textFiles.current?.click();
          }}
        >
          <FileText aria-hidden size={15} className="text-muted" />
          Add text file
        </MenuItem>
      </Menu>
      <input
        ref={textFiles}
        type="file"
        accept={TEXT_FILE_TYPES.join(",")}
        multiple
        hidden
        tabIndex={-1}
        onChange={(event) => {
          const files = Array.from(event.target.files ?? []);
          // Emptied, so that choosing the same file again (after removing it) attaches it again.
          event.target.value = "";
          if (files.length > 0) onTextFiles(files);
        }}
      />
    </>
  );
}

/** A toolbar pill naming the chat's provider or model; a click opens its picker above the composer. */
function Pill({ title, icon, text, muted, children }: { title: string; icon?: ReactNode; text: string; muted?: boolean; children: ReactNode }) {
  const { buttonRef, menuRef, open, toggle } = useMenu();
  const id = useId();
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        title={title}
        className={cx(
          "flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-sm hover:bg-fill hover:text-text focus-visible:outline-2 focus-visible:outline-focus motion-safe:transition-colors",
          muted ? "text-muted" : "text-text/80",
        )}
      >
        {icon}
        <span className="min-w-0 truncate">{text}</span>
        <ChevronDown aria-hidden size={13} className="shrink-0 opacity-60" />
      </button>
      <div
        ref={menuRef}
        id={id}
        role="dialog"
        aria-label={title}
        {...{ popover: "auto" }}
        onKeyDown={keepEscape}
        className="glass fixed inset-auto m-0 w-64 max-w-[calc(100vw-1rem)] flex-col gap-3 rounded-[10px] bg-bg/90! p-3 text-text [&:popover-open]:flex"
      >
        {children}
      </div>
    </>
  );
}
