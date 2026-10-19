import { Loader2, X } from "lucide-react";
import { useEffect, type ReactNode } from "react";
import { Button } from "../../../components/Button";

// How long a notice stays unless it is closed.
const SHOW_MS = 8000;

export interface Notice {
  // A new one for each notice, so that each stays its full time.
  id: number;
  text: string;
  action?: ReactNode;
  // Something under way, such as a file being made: it stays, with a spinner, until the next notice.
  busy?: boolean;
}

/**
 * A short notice at the bottom of the screen that another editor changed this clip (ADR 0003), with
 * what it offers to do about it; or of something the editor is doing, or has done.
 */
export function ChangeNotice({ notice, onClose }: { notice: Notice | null; onClose: () => void }) {
  useEffect(() => {
    if (!notice || notice.busy) return;
    const timer = setTimeout(onClose, SHOW_MS);
    return () => clearTimeout(timer);
  }, [notice, onClose]);

  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-20 z-50 flex justify-center px-4 lg:bottom-6">
      {notice && (
        <div className="glass pointer-events-auto flex max-w-md items-center gap-3 rounded-panel py-2 pr-2 pl-4 text-sm shadow-raised motion-safe:animate-[sheet-in_220ms_var(--ease-out)]">
          {notice.busy && <Loader2 aria-hidden size={16} className="shrink-0 motion-safe:animate-spin" />}
          <span className="min-w-0 text-pretty">{notice.text}</span>
          {notice.action}
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close">
            <X aria-hidden size={16} />
          </Button>
        </div>
      )}
    </div>
  );
}
