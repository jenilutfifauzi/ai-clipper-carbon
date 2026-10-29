import { CircleAlert } from "lucide-react";
import { Button } from "../../../../components/Button";
import { cleanError } from "./status";

/**
 * What went wrong, said plainly (cleanError) on the danger surface, with "Try again" when there is
 * something to try again (`onRetry`): a turn's error, or a message that couldn't be sent.
 */
export function ErrorNote({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-lg bg-danger-surface px-3 py-2 text-sm">
      <CircleAlert aria-hidden size={15} className="mt-0.5 shrink-0 text-danger" />
      <p className="min-w-0 flex-1 text-pretty break-words">{cleanError(error)}</p>
      {onRetry && (
        <Button variant="ghost" size="xs" className="-my-1 shrink-0 text-text" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}
