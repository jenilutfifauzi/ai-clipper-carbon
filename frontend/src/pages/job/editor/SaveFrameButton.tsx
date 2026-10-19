import { Camera, ImagePlus, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { uploadMedia, type CandidateChange } from "../../../api";
import { buttonClass } from "../../../components/Button";
import { frameFileName, saveFrame } from "./saveFrame";

// The menu's distance from its button, and from the window's edges.
const GAP_PX = 4;
const EDGE_PX = 8;
// How long "Added to the Media Library" shows.
const NOTE_MS = 4000;

/**
 * "Save frame": a menu that saves the frame at the playhead (`at()`) as the render draws it, of the
 * Candidate as `draft` shows it, and downloads it named after `title` and the time; or also adds it
 * to the Media Library as an image, by `toLibrary` (the upload path's, the Media Library's own upload
 * by default). A spinner shows while it is made.
 */
export function SaveFrameButton({
  jobId,
  candidateId,
  title,
  draft,
  at,
  fps,
  duration,
  toLibrary = (file) => uploadMedia(file, () => {}).done,
  compact = false,
}: {
  jobId: string;
  candidateId: string;
  title: string;
  draft: CandidateChange;
  at: () => number;
  fps: number;
  duration: number;
  toLibrary?: (file: File) => Promise<unknown> | void;
  // An icon only, for a toolbar.
  compact?: boolean;
}) {
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ text: string; error: boolean } | null>(null);
  const id = useId();

  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    const toggled = (event: Event) => setOpen((event as ToggleEvent).newState === "open");
    element.addEventListener("toggle", toggled);
    return () => element.removeEventListener("toggle", toggled);
  }, []);

  useEffect(() => {
    if (!note || note.error) return;
    const timer = setTimeout(() => setNote(null), NOTE_MS);
    return () => clearTimeout(timer);
  }, [note]);

  function show() {
    const anchor = toggle.current?.getBoundingClientRect();
    const element = menu.current;
    if (!anchor || !element) return;
    element.showPopover();
    const left = Math.min(Math.max(anchor.right - element.offsetWidth, EDGE_PX), window.innerWidth - element.offsetWidth - EDGE_PX);
    const below = anchor.bottom + GAP_PX;
    const top = below + element.offsetHeight > window.innerHeight - EDGE_PX ? anchor.top - GAP_PX - element.offsetHeight : below;
    element.style.left = `${left}px`;
    element.style.top = `${Math.max(EDGE_PX, top)}px`;
  }
  const hide = () => {
    if (menu.current?.matches(":popover-open")) menu.current.hidePopover();
  };

  async function save(library: boolean) {
    hide();
    const time = at();
    setBusy(true);
    setNote(null);
    try {
      const file = await saveFrame(jobId, candidateId, draft, time, frameFileName(title, time, fps, duration));
      if (library) {
        // The Advanced Edit's Media Library shows its upload under way itself, and gives nothing to wait for.
        const adding = toLibrary(file);
        setNote({ text: "Adding to the Media Library…", error: false });
        await adding;
        if (adding) setNote({ text: "Added to the Media Library", error: false });
      }
    } catch (reason) {
      setNote({ text: `Couldn't save the frame: ${(reason as Error).message}`, error: true });
    } finally {
      setBusy(false);
    }
  }

  const Icon = busy ? Loader2 : Camera;
  return (
    <div className="inline-flex min-w-0 items-center gap-2">
      <button
        ref={toggle}
        type="button"
        disabled={busy}
        aria-label={compact ? "Save frame" : undefined}
        title="Save the frame at the playhead as a PNG"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => (open ? hide() : show())}
        className={compact ? buttonClass("ghost", "icon") : buttonClass("secondary", "xs")}
      >
        <Icon aria-hidden size={compact ? 18 : 15} className={busy ? "motion-safe:animate-spin" : undefined} />
        {!compact && (busy ? "Saving frame…" : "Save frame")}
      </button>
      <div
        ref={menu}
        id={id}
        role="menu"
        aria-label="Save frame"
        {...{ popover: "auto" }}
        className="glass fixed inset-auto m-0 min-w-56 flex-col rounded-[10px] bg-bg/90! p-1 text-text [&:popover-open]:flex"
      >
        <button
          type="button"
          role="menuitem"
          onClick={() => void save(false)}
          className="flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-fill"
        >
          <Camera aria-hidden size={14} className="shrink-0 text-muted" />
          Save frame
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={() => void save(true)}
          className="flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-fill"
        >
          <ImagePlus aria-hidden size={14} className="shrink-0 text-muted" />
          Save frame to Media Library
        </button>
      </div>
      <span role="status" className={note?.error ? "min-w-0 truncate text-xs text-danger" : "min-w-0 truncate text-xs text-muted"} title={note?.text}>
        {note?.text}
      </span>
    </div>
  );
}
