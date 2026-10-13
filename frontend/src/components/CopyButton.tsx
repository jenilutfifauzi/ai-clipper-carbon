import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "./Button";

// Copies `text` to the clipboard, and says so for a moment.
export function CopyButton({ text, label }: { text: string; label: string }) {
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

  return (
    <Button onClick={copy} disabled={!text} size="sm">
      {copied ? <Check aria-hidden size={16} className="text-success" /> : <Copy aria-hidden size={16} />}
      <span aria-live="polite">{copied === null ? label : copied ? "Copied" : "Copy failed"}</span>
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
