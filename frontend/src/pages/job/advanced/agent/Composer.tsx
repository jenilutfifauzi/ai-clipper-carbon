import { ArrowUp, Bot, ChevronDown, ChevronLeft, Clapperboard, FileText, ImageUp, Plus, Settings2, Square, UserRound } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type DragEvent, type KeyboardEvent, type ReactNode, type RefObject } from "react";
import type { AgentProviderListing } from "../../../../api";
import { Button, buttonClass } from "../../../../components/Button";
import { Menu, MenuItem, useMenu } from "../../../../components/Menu";
import { Select } from "../../../../components/Select";
import { cx } from "../../../../format";
import { keepEscape } from "../AudioEffectsFields";
import { AttachmentChips } from "./AttachmentChips";
import {
  attach,
  attachImages,
  attachmentName,
  attachTextFiles,
  clipChoices,
  IMAGE_TYPES,
  isImageFile,
  TEXT_FILE_TYPES,
  type DraftAttachment,
  type ReferableClip,
} from "./attachments";
import { ThinkingOrb } from "./ThinkingOrb";

// The message box grows with its text up to this, then scrolls.
const MAX_HEIGHT_PX = 160;

/**
 * The chat's framed message box: Enter sends, Shift+Enter breaks the line, Esc (or ⌘. anywhere)
 * stops a running turn. Above its text, the Agent Attachments going with it as chips (the first ones
 * `defaultAttachments`); under it a toolbar with the + that attaches them (images, a text file, one of
 * `candidates`, the Job's other Candidates, or the Channel Profile),
 * the Provider pill, then the Model pill (each opening its picker), the provider's setup and Send, or Stop
 * while a turn runs. Images are also pasted into the message box, and images or text files dropped onto
 * it; an image is held as its file, its thumbnail an object URL let go of once it is removed, sent or
 * the composer goes. Its text and attachments are its own state, emptied once `onSend` says they went. While the provider is being set up (`setup`) it is
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
  candidates = NO_CLIPS,
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
  onSend: (prompt: string, attachments: DraftAttachment[]) => Promise<boolean>;
  onStop: () => void;
  defaultAttachments?: DraftAttachment[];
  candidates?: ReferableClip[];
}) {
  const [text, setText] = useState("");
  const [attachments, setAttachments] = useState(defaultAttachments);
  // Why the last files chosen weren't all attached.
  const [attachError, setAttachError] = useState<string | null>(null);
  // Whether files are dragged over the message box.
  const [dragging, setDragging] = useState(false);
  const prompt = text.trim();
  const area = useRef<HTMLTextAreaElement>(null);

  // The thumbnails still held when the composer goes are let go of.
  const held = useRef(attachments);
  useEffect(() => {
    held.current = attachments;
  });
  useEffect(() => () => revokePreviews(held.current), []);

  // Autosize: as tall as its text, up to MAX_HEIGHT_PX.
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text, setup]);

  const send = async () => {
    if (!prompt || busy || !(await onSend(prompt, attachments))) return;
    revokePreviews(attachments);
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

  const attachImageFiles = (files: File[]) => {
    const added = attachImages(attachments, files);
    setAttachments(added.attached);
    setAttachError(added.error);
    area.current?.focus();
  };

  // Dropped files: the images as images, the others as text files.
  const attachDropped = async (files: File[]) => {
    const images = attachImages(attachments, files.filter(isImageFile));
    const texts = await attachTextFiles(images.attached, files.filter((file) => !isImageFile(file)));
    setAttachments(texts.attached);
    setAttachError(images.error ?? texts.error);
    area.current?.focus();
  };

  // Only a drag carrying files is taken: dragged text still goes into the message box.
  const takesDrag = (event: DragEvent) => !setup && event.dataTransfer.types.includes("Files");

  const add = (attachment: DraftAttachment) => {
    const added = attach(attachments, attachment);
    setAttachments(added.attached);
    setAttachError(added.error);
    area.current?.focus();
  };

  const remove = (index: number) => {
    revokePreviews(attachments.slice(index, index + 1));
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
        onDragOver={(event) => {
          if (!takesDrag(event)) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setDragging(true);
        }}
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false);
        }}
        onDrop={(event) => {
          setDragging(false);
          if (!takesDrag(event)) return;
          event.preventDefault();
          void attachDropped(Array.from(event.dataTransfer.files));
        }}
        className={cx(
          "rounded-2xl border bg-fill shadow-sm motion-safe:transition-colors",
          dragging ? "border-focus" : "border-border focus-within:border-text/50",
        )}
      >
        {!setup && (
          <AttachmentChips
            attachments={attachments.map((attachment) => ({
              kind: attachment.kind,
              name: attachmentName(attachment, candidates),
              preview: attachment.kind === "image" ? attachment.preview : null,
            }))}
            onRemove={remove}
            className="px-3 pt-3"
          />
        )}
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
            onPaste={(event) => {
              // A pasted picture is attached; pasted text goes in as ever.
              const images = Array.from(event.clipboardData.files).filter(isImageFile);
              if (images.length === 0) return;
              event.preventDefault();
              attachImageFiles(images);
            }}
            className="block w-full resize-none overflow-y-auto bg-transparent px-4 pt-3.5 pb-2 text-base caret-text outline-none placeholder:text-muted"
          />
        )}
        <div className={cx("box-content flex h-8 items-center gap-1 px-2.5 pb-2.5", setup && "pt-2.5")}>
          {!setup && (
            <AddMenu
              clips={clipChoices(candidates, attachments)}
              profileAttached={attachments.some((attachment) => attachment.kind === "channel_profile")}
              onImages={attachImageFiles}
              onTextFiles={(files) => void attachText(files)}
              onAttach={add}
            />
          )}
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

const NO_ATTACHMENTS: DraftAttachment[] = [];
const NO_CLIPS: ReferableClip[] = [];

function revokePreviews(attachments: DraftAttachment[]) {
  for (const attachment of attachments) if (attachment.kind === "image") URL.revokeObjectURL(attachment.preview);
}

/**
 * The toolbar's +: a menu of what can go with the message, each kind's file picker hidden behind its
 * item. Reference a clip turns it into the list of `clips`, those attached already off; the Channel
 * Profile is off while it is attached.
 */
function AddMenu({
  clips,
  profileAttached,
  onImages,
  onTextFiles,
  onAttach,
}: {
  clips: ReturnType<typeof clipChoices>;
  profileAttached: boolean;
  onImages: (files: File[]) => void;
  onTextFiles: (files: File[]) => void;
  onAttach: (attachment: DraftAttachment) => void;
}) {
  const { buttonRef, menuRef, open, show, hide, toggle } = useMenu({ align: "start" });
  const images = useRef<HTMLInputElement>(null);
  const textFiles = useRef<HTMLInputElement>(null);
  // The kinds of attachment, or the clips to reference.
  const [view, setView] = useState<"kinds" | "clips">("kinds");
  const list = useRef<HTMLDivElement>(null);

  // Switched lists, the menu is placed again for its new size, and as the item clicked is gone, the
  // new list's first item takes the focus.
  useLayoutEffect(() => {
    if (!list.current?.closest(":popover-open")) return;
    hide();
    show();
    list.current.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [view, hide, show]);

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
        onClick={() => {
          setView("kinds");
          toggle();
        }}
      >
        <Plus aria-hidden size={16} />
      </button>
      <Menu ref={menuRef} label={view === "clips" ? "Reference a clip" : "Add to message"}>
        <div ref={list} className="flex flex-col">
          {view === "clips" ? (
            <>
              <MenuItem onClick={() => setView("kinds")}>
                <ChevronLeft aria-hidden size={15} className="text-muted" />
                Back
              </MenuItem>
              <div className="flex max-h-72 w-72 max-w-[calc(100vw-1rem)] flex-col overflow-y-auto">
                {clips.map((clip) => (
                  <MenuItem
                    key={clip.id}
                    disabled={clip.attached}
                    onClick={() => {
                      hide();
                      onAttach({ kind: "candidate", candidate_id: clip.id });
                    }}
                  >
                    <span className="flex min-w-0 flex-1 flex-col py-1.5">
                      <span className="truncate">{clip.name}</span>
                      <span className="text-xs text-muted tabular-nums">
                        {clip.range}
                        {clip.attached && " · attached"}
                      </span>
                    </span>
                  </MenuItem>
                ))}
              </div>
            </>
          ) : (
            <>
              <MenuItem
                onClick={() => {
                  hide();
                  images.current?.click();
                }}
              >
                <ImageUp aria-hidden size={15} className="text-muted" />
                Upload image
              </MenuItem>
              <MenuItem
                onClick={() => {
                  hide();
                  textFiles.current?.click();
                }}
              >
                <FileText aria-hidden size={15} className="text-muted" />
                Add text file
              </MenuItem>
              <MenuItem disabled={clips.length === 0} onClick={() => setView("clips")}>
                <Clapperboard aria-hidden size={15} className="text-muted" />
                Reference a clip
              </MenuItem>
              <MenuItem
                disabled={profileAttached}
                onClick={() => {
                  hide();
                  onAttach({ kind: "channel_profile" });
                }}
              >
                <UserRound aria-hidden size={15} className="text-muted" />
                Channel Profile
              </MenuItem>
            </>
          )}
        </div>
      </Menu>
      <FileInput inputRef={images} accept={IMAGE_TYPES.join(",")} onFiles={onImages} />
      <FileInput inputRef={textFiles} accept={TEXT_FILE_TYPES.join(",")} onFiles={onTextFiles} />
    </>
  );
}

/** A hidden picker of several files, behind a menu item. */
function FileInput({ inputRef, accept, onFiles }: { inputRef: RefObject<HTMLInputElement>; accept: string; onFiles: (files: File[]) => void }) {
  return (
    <input
      ref={inputRef}
      type="file"
      accept={accept}
      multiple
      hidden
      tabIndex={-1}
      onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        // Emptied, so that choosing the same file again (after removing it) attaches it again.
        event.target.value = "";
        if (files.length > 0) onFiles(files);
      }}
    />
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
