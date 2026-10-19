import { Download } from "lucide-react";
import { useState } from "react";
import { api, type CaptionFormat } from "../../../api";
import { buttonClass } from "../../../components/Button";
import { Menu, MenuItem, useMenu } from "../../../components/Menu";
import { clipFileName, saveText } from "../downloads";

// Each caption file's type, as the API serves it.
const TYPES: Record<CaptionFormat, string> = { srt: "application/x-subrip", vtt: "text/vtt" };

/**
 * The Advanced Edit's downloads menu: the Candidate's captions as SRT or VTT, made from what is saved
 * of it, without a render. Its items wait while an edit is being saved, so that the file has it; the
 * API refuses while a captioned Segment's Words are still being transcribed, and the menu says so.
 */
export function Downloads({ jobId, candidateId, title, saving }: { jobId: string; candidateId: string; title: string; saving: boolean }) {
  const { buttonRef, menuRef, open, hide, toggle } = useMenu();
  const [busy, setBusy] = useState<CaptionFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(format: CaptionFormat) {
    setBusy(format);
    setError(null);
    try {
      saveText(await api.captionFile(jobId, candidateId, format), `${clipFileName(title, candidateId)}.${format}`, TYPES[format]);
      hide();
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={buttonClass("ghost", "icon")}
        aria-label="Downloads"
        title="Downloads"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (setError(null), toggle())}
      >
        <Download aria-hidden size={18} />
      </button>
      <Menu ref={menuRef} label="Downloads">
        {(["srt", "vtt"] as const).map((format) => (
          <MenuItem key={format} disabled={busy !== null || saving} onClick={() => void download(format)}>
            {busy === format ? "Preparing…" : `Captions (.${format})`}
          </MenuItem>
        ))}
        {saving && <p className="px-2 py-1 text-sm text-muted">Saving your latest edit first…</p>}
        {error && <p className="max-w-64 px-2 py-1 text-sm text-danger">{error}</p>}
      </Menu>
    </>
  );
}
