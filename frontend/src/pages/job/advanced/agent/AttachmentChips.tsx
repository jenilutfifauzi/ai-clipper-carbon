import { Clapperboard, FileText, UserRound, X, type LucideIcon } from "lucide-react";
import { cx } from "../../../../format";

/**
 * A row of Agent Attachment chips: its kind's icon and the name of each. In the composer (`onRemove`) each
 * has a × that takes it off the message; in the owner's bubble they only name what went with it.
 */
export function AttachmentChips({
  attachments,
  onRemove,
  className,
}: {
  attachments: { kind: string; name: string }[];
  onRemove?: (index: number) => void;
  className?: string;
}) {
  if (attachments.length === 0) return null;
  return (
    <ul data-attachments="" aria-label="Attachments" className={cx("flex flex-wrap gap-1.5", className)}>
      {attachments.map((attachment, index) => (
        <li
          key={`${index}-${attachment.name}`}
          className="flex h-7 max-w-48 min-w-0 items-center gap-1.5 rounded-lg border border-border bg-bg pr-1 pl-2 text-xs text-text/80"
          title={attachment.name}
        >
          <ChipIcon kind={attachment.kind} />
          <span className={cx("min-w-0 truncate", !onRemove && "pr-1")}>{attachment.name}</span>
          {onRemove && (
            // The × is small to see; its hit area reaches the chip's height.
            <button
              type="button"
              aria-label={`Remove ${attachment.name}`}
              title="Remove"
              onClick={() => onRemove(index)}
              className="-my-1 grid size-6 shrink-0 place-items-center rounded-md text-muted hover:bg-fill hover:text-text focus-visible:outline-2 focus-visible:outline-focus motion-safe:transition-colors"
            >
              <X aria-hidden size={12} />
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

// Each kind's icon, as the + menu shows it; a text file's for any other.
const KIND_ICONS: Record<string, LucideIcon> = { text: FileText, candidate: Clapperboard, channel_profile: UserRound };

function ChipIcon({ kind }: { kind: string }) {
  const Icon = KIND_ICONS[kind] ?? FileText;
  return <Icon aria-hidden size={13} className="shrink-0 text-muted" />;
}
