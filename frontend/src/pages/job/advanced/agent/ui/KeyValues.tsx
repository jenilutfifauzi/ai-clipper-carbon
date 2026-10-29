import type { AgentUi } from "../../../../../api";

/** The Agent's labelled values, a label and its value to a line. */
export function KeyValues({ ui }: { ui: Extract<AgentUi, { kind: "key_values" }> }) {
  return (
    <div data-agent-ui="key_values" className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
      {ui.title && <p className="text-sm font-medium text-pretty">{ui.title}</p>}
      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs">
        {ui.items.map((item, index) => (
          <div key={index} className="contents">
            <dt className="text-muted">{item.label}</dt>
            <dd className="tabular-nums break-words">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
