import { ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type DragEvent } from "react";
import { api, logoUrl, type Logo } from "../../../api";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { Skeleton } from "../../../components/Skeleton";
import { cx } from "../../../format";

// A checkerboard behind each Logo, so that its transparent parts show as such.
const CHECKERS = "bg-[repeating-conic-gradient(var(--fill)_0%_25%,transparent_0%_50%)] bg-[length:12px_12px]";

/**
 * The Logos a Watermark can show, as radio cards of their images, and a card to upload another
 * (picked, or dropped on it), which is chosen once it is in. Each Logo can be deleted; Presets and
 * Clips showing it then show no Watermark.
 */
export function LogoPicker({
  value,
  onChange,
  marker,
}: {
  value: string | null;
  onChange: (logo: string | null) => void;
  marker?: React.ReactNode;
}) {
  const name = useId();
  const input = useRef<HTMLInputElement>(null);
  const [logos, setLogos] = useState<Logo[] | null>(null);
  const [uploading, setUploading] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Logo | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.listLogos().then(setLogos, (reason: Error) => {
      setLogos([]);
      setError(`Couldn't load the logos: ${reason.message}`);
    });
  }, []);

  async function upload(file: File | undefined) {
    if (!file || uploading) return;
    setUploading(true);
    setError(null);
    try {
      const logo = await api.uploadLogo(file);
      setLogos((old) => [...(old ?? []), logo]);
      onChange(logo.id);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setUploading(false);
      if (input.current) input.current.value = "";
    }
  }

  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setOver(false);
    void upload(event.dataTransfer.files[0]);
  }

  async function remove(logo: Logo) {
    setBusy(true);
    try {
      await api.deleteLogo(logo.id);
      setLogos((old) => (old ?? []).filter((other) => other.id !== logo.id));
      if (value === logo.id) onChange(null);
      setDeleting(null);
    } catch (reason) {
      setError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="flex min-w-0 flex-col gap-1.5">
      <legend className="mb-1.5 flex items-center gap-1.5 text-sm font-medium">Logo {marker}</legend>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
        {logos === null &&
          [0, 1].map((slot) => <Skeleton key={slot} className="aspect-square" />)}
        {logos?.map((logo) => (
          <div key={logo.id} className="group relative min-w-0">
            <label className="flex cursor-pointer flex-col" title={logo.name}>
              <input
                type="radio"
                name={name}
                value={logo.id}
                checked={value === logo.id}
                onChange={() => onChange(logo.id)}
                aria-label={logo.name}
                className="peer sr-only"
              />
              <span
                className={cx(
                  "flex aspect-square items-center justify-center rounded-control border border-border p-2 select-none",
                  CHECKERS,
                  "hover:border-accent/60 peer-checked:border-accent peer-checked:shadow-[0_0_0_1px_var(--accent)]",
                  "peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-focus",
                  "motion-safe:transition-[border-color,box-shadow] motion-safe:duration-150",
                )}
              >
                <img src={logoUrl(logo.id)} alt="" width={logo.width} height={logo.height} className="max-h-full max-w-full object-contain" />
              </span>
            </label>
            <button
              type="button"
              onClick={() => setDeleting(logo)}
              aria-label={`Delete logo ${logo.name}`}
              title="Delete this logo"
              className={cx(
                "glass absolute top-1 right-1 inline-flex size-7 items-center justify-center rounded-full text-muted hover:text-danger",
                "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100",
                "motion-safe:transition-opacity",
              )}
            >
              <Trash2 aria-hidden size={13} />
            </button>
          </div>
        ))}
        <label
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
            setOver(true);
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
          }}
          onDrop={drop}
          className={cx(
            "flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-control border-2 border-dashed p-2 text-center text-sm font-medium text-muted",
            "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
            "hover:border-accent/60 hover:text-text motion-safe:transition-colors",
            over ? "border-accent bg-accent/10" : "border-border",
          )}
        >
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            disabled={uploading}
            onChange={(event) => void upload(event.target.files?.[0])}
            className="sr-only"
          />
          {uploading ? (
            <LoaderCircle aria-hidden size={20} className="motion-safe:animate-spin" />
          ) : (
            <ImagePlus aria-hidden size={20} />
          )}
          <span aria-live="polite">{uploading ? "Uploading…" : "Upload logo"}</span>
        </label>
      </div>
      <p className="text-sm text-muted">PNG with a transparent background works best. PNG, JPEG or WebP, up to 5 MB.</p>
      {error && <p className="text-sm text-danger">{error}</p>}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete the logo “${deleting?.name ?? ""}”?`}
        confirmLabel="Delete logo"
        busyLabel="Deleting…"
        busy={busy}
        onConfirm={() => deleting && void remove(deleting)}
        onCancel={() => setDeleting(null)}
      >
        Presets and clips that show it will show no watermark from their next render.
      </ConfirmDialog>
    </fieldset>
  );
}
