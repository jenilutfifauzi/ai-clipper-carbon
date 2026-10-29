import { Circle, CircleAlert, CircleCheck, Info, TriangleAlert, type LucideIcon } from "lucide-react";
import type { AgentUi } from "../../../../../api";
import { cx } from "../../../../../format";
import { ChatMarkdown } from "../ChatMarkdown";

type Tone = Extract<AgentUi, { kind: "callout" }>["tone"];

// Each tone's icon and colour, from the app's tokens.
const TONES: Record<Tone, { icon: LucideIcon; color: string }> = {
  info: { icon: Info, color: "text-accent-text" },
  success: { icon: CircleCheck, color: "text-success" },
  warning: { icon: TriangleAlert, color: "text-waiting" },
  danger: { icon: CircleAlert, color: "text-danger" },
};

/** A note the Agent sets apart by its tone: its title, its body as Markdown, and a checklist to read (not tick). */
export function Callout({ ui }: { ui: Extract<AgentUi, { kind: "callout" }> }) {
  const { icon: Icon, color } = TONES[ui.tone] ?? TONES.info;
  return (
    <div data-agent-ui="callout" className="flex gap-2 rounded-lg border border-border px-3 py-2 text-sm">
      <Icon aria-hidden size={16} className={cx("mt-0.5 shrink-0", color)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {ui.title && <p className={cx("font-medium text-pretty", color)}>{ui.title}</p>}
        <ChatMarkdown text={ui.body} />
        {ui.checklist && ui.checklist.length > 0 && (
          <ul className="flex flex-col gap-1 text-xs">
            {ui.checklist.map((item, index) => (
              <li key={index} className="flex items-start gap-1.5">
                {item.done ? (
                  <CircleCheck aria-hidden size={14} className="mt-px shrink-0 text-success" />
                ) : (
                  <Circle aria-hidden size={14} className="mt-px shrink-0 text-muted" />
                )}
                <span className={cx("text-pretty", item.done && "text-muted line-through")}>
                  {item.text}
                  <span className="sr-only">{item.done ? ", done" : ", to do"}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
