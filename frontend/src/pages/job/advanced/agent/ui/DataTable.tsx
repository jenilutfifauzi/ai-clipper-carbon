import type { AgentUi } from "../../../../../api";

/** The Agent's table: its columns over its rows, scrolling sideways when it is wider than the chat. */
export function DataTable({ ui }: { ui: Extract<AgentUi, { kind: "table" }> }) {
  return (
    <div data-agent-ui="table" className="flex flex-col gap-1 rounded-lg border border-border px-3 py-2">
      {ui.title && <p className="text-sm font-medium text-pretty">{ui.title}</p>}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs tabular-nums">
          <thead>
            <tr className="text-muted">
              {ui.columns.map((column, index) => (
                <th key={index} scope="col" className="py-1 pr-3 text-left font-medium last:pr-0">
                  {column}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ui.rows.map((row, index) => (
              <tr key={index} className="border-t border-border">
                {row.map((cell, column) => (
                  <td key={column} className="py-1 pr-3 align-top last:pr-0">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
