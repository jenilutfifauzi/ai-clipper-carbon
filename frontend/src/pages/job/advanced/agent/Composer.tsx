import { ArrowUp, Bot, ChevronDown, Settings2, Square } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { AgentProviderListing } from "../../../../api";
import { Button } from "../../../../components/Button";
import { useMenu } from "../../../../components/Menu";
import { Select } from "../../../../components/Select";
import { cx } from "../../../../format";
import { keepEscape } from "../AudioEffectsFields";

// The message box grows with its text up to this, then scrolls.
const MAX_HEIGHT_PX = 160;

/**
 * The chat's framed message box: Enter sends, Shift+Enter breaks the line; under it a toolbar with
 * the model pill (the Provider and Model, in a popover), the provider's setup and Send, or Stop
 * while a turn runs. Its text is its own state. While the provider is being set up (`setup`) it is
 * only the toolbar, so that another provider can still be picked.
 */
export function Composer({
  providers,
  listing,
  models,
  model,
  onChoose,
  setup,
  setupOpen,
  onSetup,
  busy,
  running,
  onSend,
  onStop,
}: {
  providers: AgentProviderListing[];
  listing: AgentProviderListing;
  models: string[];
  model: string | null;
  onChoose: (provider: string, model: string | null) => void;
  setup: boolean;
  setupOpen: boolean;
  onSetup: () => void;
  busy: boolean;
  running: boolean;
  onSend: (prompt: string) => Promise<boolean>;
  onStop: () => void;
}) {
  const [text, setText] = useState("");
  const prompt = text.trim();
  const area = useRef<HTMLTextAreaElement>(null);

  // Autosize: as tall as its text, up to MAX_HEIGHT_PX.
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [text, setup]);

  const send = async () => {
    if (prompt && !busy && (await onSend(prompt))) setText("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  };

  return (
    <div data-composer={setup ? undefined : ""} className="shrink-0 border-t border-border p-2.5">
      <div className="rounded-xl border border-border bg-fill transition-colors focus-within:border-accent-text focus-within:ring-1 focus-within:ring-accent/30">
        {!setup && (
          <textarea
            ref={area}
            aria-label="Message the Agent"
            rows={2}
            value={text}
            placeholder="Describe a change…"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            className="block w-full resize-none overflow-y-auto bg-transparent px-3 pt-2.5 pb-1 text-sm outline-none placeholder:text-muted"
          />
        )}
        <div className={cx("box-content flex h-7 items-center gap-1 px-1.5 pb-1.5", setup && "pt-1.5")}>
          <ModelPill providers={providers} listing={listing} models={models} model={model} onChoose={onChoose} />
          {listing.status.ready && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto aria-pressed:text-accent-text"
              aria-label={`Set up ${listing.provider.label}`}
              aria-pressed={setupOpen}
              title={`Set up ${listing.provider.label}`}
              onClick={onSetup}
            >
              <Settings2 aria-hidden size={15} />
            </Button>
          )}
          {setup ? null : running ? (
            <Button size="icon-sm" aria-label="Stop" title="Stop" onClick={onStop}>
              <Square aria-hidden size={12} />
            </Button>
          ) : (
            <Button variant="primary" size="icon-sm" aria-label="Send" title="Send (Enter)" disabled={!prompt || busy} onClick={() => void send()}>
              <ArrowUp aria-hidden size={16} />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

/** The provider (and model, when it has one) the chat uses; a click opens their pickers above the composer. */
function ModelPill({
  providers,
  listing,
  models,
  model,
  onChoose,
}: {
  providers: AgentProviderListing[];
  listing: AgentProviderListing;
  models: string[];
  model: string | null;
  onChoose: (provider: string, model: string | null) => void;
}) {
  const { buttonRef, menuRef, open, toggle } = useMenu();
  const id = useId();
  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        title="Provider and model"
        className="flex min-w-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-fill hover:text-text focus-visible:outline-2 focus-visible:outline-focus"
      >
        <Bot aria-hidden size={13} className="shrink-0" />
        <span className="min-w-0 truncate">{model ? `${listing.provider.label} · ${model}` : listing.provider.label}</span>
        <ChevronDown aria-hidden size={11} className="shrink-0" />
      </button>
      <div
        ref={menuRef}
        id={id}
        role="dialog"
        aria-label="Provider and model"
        {...{ popover: "auto" }}
        onKeyDown={keepEscape}
        className="glass fixed inset-auto m-0 w-64 max-w-[calc(100vw-1rem)] flex-col gap-3 rounded-[10px] bg-bg/90! p-3 text-text [&:popover-open]:flex"
      >
        <Select
          label="Provider"
          value={listing.provider.id}
          options={providers.map(({ provider, status }) => ({ value: provider.id, label: status.ready ? provider.label : `${provider.label} (set up)` }))}
          onChange={(provider) => onChoose(provider, null)}
        />
        {models.length > 0 && model && (
          <Select label="Model" value={model} options={models.map((name) => ({ value: name, label: name }))} onChange={(name) => onChoose(listing.provider.id, name)} />
        )}
      </div>
    </>
  );
}
