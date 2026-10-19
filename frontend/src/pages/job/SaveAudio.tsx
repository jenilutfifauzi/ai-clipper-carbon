import { AudioLines, ChevronDown, Loader2 } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { api, type AudioFormat } from "../../api";
import { buttonClass } from "../../components/Button";
import { downloadName } from "../../format";

// The menu's distance from its button, and from the window's edges.
const GAP_PX = 4;
const EDGE_PX = 8;

export const AUDIO_FORMATS: { format: AudioFormat; label: string; hint: string }[] = [
  { format: "wav", label: "WAV", hint: "Lossless, 48 kHz 16-bit" },
  { format: "m4a", label: "M4A", hint: "AAC, small" },
];

/** Save the Candidate's sound alone as `format`, at the Export Preset's loudness, and download it named after its title. */
export async function saveAudio(
  jobId: string,
  candidate: { id: string; title?: string },
  format: AudioFormat,
  exportPresetId?: string,
): Promise<void> {
  const saved = await api.saveAudio(jobId, candidate.id, format, exportPresetId);
  const link = document.createElement("a");
  link.href = saved.url;
  link.download = downloadName(candidate.title, candidate.id, format);
  link.click();
}

/**
 * "Save audio": a menu of the formats the Candidate's sound is saved alone in (its saved edit's mix,
 * an Export file of its Job), at the Export Preset `exportPresetId`'s loudness (the default's when
 * left out); the browser downloads it named after the Candidate's title.
 */
export function SaveAudioButton({
  jobId,
  candidate,
  exportPresetId,
}: {
  jobId: string;
  candidate: { id: string; title?: string };
  exportPresetId?: string | null;
}) {
  const toggle = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  // The menu is a popover in the top layer, as the Render button's is; light dismiss and Escape close it.
  useEffect(() => {
    const element = menu.current;
    if (!element) return;
    const toggled = (event: Event) => setOpen((event as ToggleEvent).newState === "open");
    element.addEventListener("toggle", toggled);
    return () => element.removeEventListener("toggle", toggled);
  }, []);

  function show() {
    const anchor = toggle.current?.getBoundingClientRect();
    const element = menu.current;
    if (!anchor || !element) return;
    element.showPopover();
    const left = Math.min(Math.max(anchor.left, EDGE_PX), window.innerWidth - element.offsetWidth - EDGE_PX);
    const below = anchor.bottom + GAP_PX;
    const top = below + element.offsetHeight > window.innerHeight - EDGE_PX ? anchor.top - GAP_PX - element.offsetHeight : below;
    element.style.left = `${left}px`;
    element.style.top = `${Math.max(EDGE_PX, top)}px`;
  }
  const hide = () => {
    if (menu.current?.matches(":popover-open")) menu.current.hidePopover();
  };

  async function save(format: AudioFormat) {
    hide();
    setSaving(true);
    setError(null);
    try {
      await saveAudio(jobId, candidate, format, exportPresetId ?? undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="inline-flex flex-col gap-1">
      <button
        ref={toggle}
        type="button"
        className={buttonClass("secondary", "sm")}
        disabled={saving}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => (open ? hide() : show())}
      >
        {saving ? <Loader2 aria-hidden size={16} className="motion-safe:animate-spin" /> : <AudioLines aria-hidden size={16} />}
        {saving ? "Saving audio…" : "Save audio"}
        <ChevronDown aria-hidden size={14} />
      </button>
      <div
        ref={menu}
        id={id}
        role="menu"
        aria-label="Save audio as"
        {...{ popover: "auto" }}
        className="glass fixed inset-auto m-0 min-w-48 flex-col rounded-[10px] bg-bg/90! p-1 text-text [&:popover-open]:flex"
      >
        {AUDIO_FORMATS.map(({ format, label, hint }) => (
          <button
            key={format}
            type="button"
            role="menuitem"
            onClick={() => void save(format)}
            className="flex min-h-9 items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-fill"
          >
            <span className="flex-1">{label}</span>
            <span className="shrink-0 text-xs text-muted">{hint}</span>
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          Couldn't save the audio: {error}
        </p>
      )}
    </div>
  );
}
