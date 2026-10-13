import { useEffect, useRef, type ReactNode } from "react";
import { cx } from "../format";
import { Button } from "./Button";

interface Props {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  // Shown on the confirm button while the action runs.
  busyLabel: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
}

// A modal confirmation for a destructive action, on the native <dialog> (focus trap, Esc to cancel).
export function ConfirmDialog({ open, title, children, confirmLabel, busyLabel, busy, error, onConfirm, onCancel }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  return (
    <dialog
      ref={dialog}
      aria-labelledby="confirm-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
      className={cx(
        "glass m-auto w-[min(28rem,calc(100%-2rem))] rounded-panel bg-bg/85! p-0 text-text backdrop:bg-black/50",
        "scale-100 opacity-100 starting:open:scale-95 starting:open:opacity-0",
        "motion-safe:transition-[opacity,scale] motion-safe:duration-200 motion-safe:ease-out",
      )}
    >
      <div className="flex flex-col gap-4 p-6">
        <h2 id="confirm-title" className="text-lg font-semibold">
          {title}
        </h2>
        <div className="text-muted">{children}</div>
        {error && (
          <p role="alert" className="rounded-control bg-danger-surface p-3 text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onCancel} disabled={busy} autoFocus>
            Cancel
          </Button>
          <Button variant="danger" onClick={onConfirm} disabled={busy}>
            {busy ? busyLabel : confirmLabel}
          </Button>
        </div>
      </div>
    </dialog>
  );
}
