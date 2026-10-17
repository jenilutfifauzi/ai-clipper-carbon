import { LoaderCircle, Type } from "lucide-react";
import { useState } from "react";
import { ApiError, type FontImported } from "../../../api";
import { buttonClass } from "../../../components/Button";
import { importFont } from "../../../fonts";

/** What an import says it did: the Faces it added, or that they were all there already. */
export function importedText(imported: FontImported): string {
  const added = imported.faces.map((face) => face.label);
  if (added.length) return `Added ${added.join(", ")}. Pick ${added.length === 1 ? "it" : "them"} as the font of any text.`;
  return `Already imported: ${imported.existing.map((face) => face.label).join(", ")}.`;
}

/**
 * Import font: a TTF, OTF or TTC file becomes Faces every Job's font pickers list. `onImported` is
 * told what it added, as the Face picker is, which then picks it.
 */
export function ImportFont({ onImported }: { onImported?: (imported: FontImported) => void }) {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<FontImported | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function choose(input: HTMLInputElement) {
    const file = input.files?.[0];
    if (!file || importing) return;
    setImporting(true);
    setError(null);
    setResult(null);
    try {
      const imported = await importFont(file);
      setResult(imported);
      onImported?.(imported);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : "The font couldn't be imported.");
    } finally {
      setImporting(false);
      // The same file can be chosen again.
      input.value = "";
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label
        className={buttonClass(
          "secondary",
          "sm",
          "cursor-pointer self-start has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
        )}
      >
        <input
          type="file"
          accept=".ttf,.otf,.ttc,font/ttf,font/otf,font/collection"
          disabled={importing}
          onChange={(event) => void choose(event.currentTarget)}
          className="sr-only"
        />
        {importing ? <LoaderCircle aria-hidden size={16} className="motion-safe:animate-spin" /> : <Type aria-hidden size={16} />}
        <span aria-live="polite">{importing ? "Importing…" : "Import font"}</span>
      </label>
      {result && <p className="text-sm text-muted">{importedText(result)}</p>}
      {result?.warnings.map((warning) => (
        <p key={warning} className="text-sm text-danger">
          {warning}
        </p>
      ))}
      {error && <p className="text-sm text-danger">{error}</p>}
    </div>
  );
}
