import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./Button";

// Copies `text` to the clipboard, and says so for a moment. `look` "icon" is a round icon button
// for dense lists (`label` is then its accessible name and tooltip); its 44 px hit area overhangs
// the row instead of heightening it.
export function CopyButton({ text, label, look = "label" }: { text: string; label: string; look?: "label" | "icon" }) {
  const [copied, setCopied] = useState<boolean | null>(null);

  useEffect(() => {
    if (copied === null) return;
    const timer = setTimeout(() => setCopied(null), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  async function copy() {
    try {
      await writeClipboard(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const icon = copied ? <Check aria-hidden size={16} className="text-success" /> : <Copy aria-hidden size={16} />;
  const said = copied === null ? label : copied ? "Copied" : "Copy failed";
  if (look === "icon") {
    return (
      <Button onClick={copy} disabled={!text} size="icon" variant="ghost" className="-my-3 -mr-3" aria-label={label} title={label}>
        {icon}
        <span aria-live="polite" className="sr-only">
          {copied === null ? "" : said}
        </span>
      </Button>
    );
  }
  return (
    <Button onClick={copy} disabled={!text} size="sm">
      {icon}
      <span aria-live="polite">{said}</span>
    </Button>
  );
}

// The Clipboard API needs a secure context: on a phone over the local network (plain http) the
// app isn't one, so fall back to copying a selected textarea.
async function writeClipboard(text: string) {
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.opacity = "0";
  document.body.append(area);
  area.select();
  const ok = document.execCommand("copy");
  area.remove();
  if (!ok) throw new Error("copy failed");
}
