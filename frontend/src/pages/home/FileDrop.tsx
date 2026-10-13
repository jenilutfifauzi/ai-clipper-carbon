import { FileVideo, Upload } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { cx, formatBytes } from "../../format";

// A file input as a drop zone: drop a master file on it, or click (or press Space) to pick one.
export function FileDrop({
  id,
  file,
  onFile,
  disabled,
}: {
  id: string;
  file: File | null;
  onFile: (file: File | null) => void;
  disabled?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  // A cleared file (after a cancelled upload, say) clears the input too.
  useEffect(() => {
    if (!file && input.current) input.current.value = "";
  }, [file]);

  function drop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setOver(false);
    const files = event.dataTransfer.files;
    if (disabled || files.length === 0 || !input.current) return;
    // The input holds the dropped file too, so that `required` sees it.
    input.current.files = files;
    onFile(files[0]);
  }

  return (
    <label
      htmlFor={id}
      onDragOver={(event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = disabled ? "none" : "copy";
        setOver(!disabled);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={drop}
      className={cx(
        "flex min-h-36 flex-col items-center justify-center gap-1.5 rounded-control border-2 border-dashed p-6 text-center",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent",
        "motion-safe:transition-colors",
        over ? "border-accent bg-surface" : "border-border bg-surface-raised",
        disabled ? "opacity-60" : "cursor-pointer hover:bg-surface",
      )}
    >
      <input
        ref={input}
        id={id}
        type="file"
        required
        disabled={disabled}
        accept="video/*,.mov,.mxf,.mkv"
        onChange={(event) => onFile(event.target.files?.[0] ?? null)}
        className="sr-only"
      />
      {file ? (
        <>
          <FileVideo aria-hidden size={26} className="text-accent-text" />
          <span className="max-w-full truncate font-medium">{file.name}</span>
          <span className="text-sm text-muted tabular-nums">
            {formatBytes(file.size)} · drop or pick another to replace it
          </span>
        </>
      ) : (
        <>
          <Upload aria-hidden size={26} className="text-muted" />
          <span className="font-medium">Drop the master file here, or pick one</span>
          <span className="text-sm text-muted">
            MP4 or MOV (H.264, HEVC, ProRes) or any video ffmpeg reads. It's transcribed on this Mac.
          </span>
        </>
      )}
    </label>
  );
}
