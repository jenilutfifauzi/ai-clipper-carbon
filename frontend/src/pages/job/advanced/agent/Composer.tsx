import { ArrowUp, Bot, ChevronDown, Settings2, Square } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { AgentProviderListing } from "../../../../api";
import { Button } from "../../../../components/Button";
import { useMenu } from "../../../../components/Menu";
import { Select } from "../../../../components/Select";
import { cx } from "../../../../format";
import { keepEscape } from "../AudioEffectsFields";
import { ThinkingOrb } from "./ThinkingOrb";

// The message box grows with its text up to this, then scrolls.
const MAX_HEIGHT_PX = 160;

/**
 * The chat's framed message box: Enter sends, Shift+Enter breaks the line; under it a toolbar with
 * the Provider pill, then the Model pill (each opening its picker), the provider's setup and Send, or Stop
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
    <div data-composer={setup ? undefined : ""} className="shrink-0 px-3 pt-1 pb-3">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void send();
        }}
        className="rounded-2xl border border-border bg-fill shadow-sm transition-colors focus-within:border-text/25"
      >
        {!setup && (
          <textarea
            ref={area}
            aria-label="Message the Agent"
            rows={2}
            value={text}
            placeholder="Describe a change…"
            onChange={(event) => setText(event.target.value)}
            onKeyDown={onKeyDown}
            className="block w-full resize-none overflow-y-auto bg-transparent px-4 pt-3.5 pb-2 text-base caret-text outline-none placeholder:text-muted"
          />
        )}
        <div className={cx("box-content flex h-8 items-center gap-1 px-2.5 pb-2.5", setup && "pt-2.5")}>
          <Pill title="Provider" icon={<Bot aria-hidden size={15} className="shrink-0" />} text={listing.provider.label}>
            <Select
              label="Provider"
              value={listing.provider.id}
              options={providers.map(({ provider, status }) => ({ value: provider.id, label: status.ready ? provider.label : `${provider.label} (set up)` }))}
              onChange={(provider) => onChoose(provider, null)}
            />
          </Pill>
          <span className="ml-auto" />
          {models.length > 0 && model && (
            <Pill title="Model" text={model} muted>
              <Select label="Model" value={model} options={models.map((name) => ({ value: name, label: name }))} onChange={(name) => onChoose(listing.provider.id, name)} />
            </Pill>
          )}
          {listing.status.ready && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="aria-pressed:bg-fill aria-pressed:text-text"
              aria-label={`Set up ${listing.provider.label}`}
              aria-pressed={setupOpen}
              title={`Set up ${listing.provider.label}`}
              onClick={onSetup}
            >
              <Settings2 aria-hidden size={15} />
            </Button>
          )}
          {setup ? null : running ? (
            // The orb turns while the Agent works (open-design's); pointed at or focused, it gives way
            // to the square that says what a click does.
            <Button variant="secondary" size="icon-round" className="group/stop" aria-label="Stop" title="Stop" onClick={onStop}>
              <span className="grid place-items-center *:[grid-area:1/1] *:motion-safe:transition-opacity *:motion-safe:duration-150">
                <ThinkingOrb size={18} className="group-hover/stop:opacity-0 group-focus-visible/stop:opacity-0" />
                <Square aria-hidden size={10} className="fill-current opacity-0 group-hover/stop:opacity-100 group-focus-visible/stop:opacity-100" />
              </span>
            </Button>
          ) : (
            <Button type="submit" variant="solid" size="icon-round" aria-label="Send" title="Send (Enter)" disabled={!prompt || busy}>
              <ArrowUp aria-hidden size={16} />
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

/** A toolbar pill naming the chat's provider or model; a click opens its picker above the composer. */
function Pill({ title, icon, text, muted, children }: { title: string; icon?: ReactNode; text: string; muted?: boolean; children: ReactNode }) {
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
        title={title}
        className={cx(
          "flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-sm hover:bg-fill hover:text-text focus-visible:outline-2 focus-visible:outline-focus motion-safe:transition-colors",
          muted ? "text-muted" : "text-text/80",
        )}
      >
        {icon}
        <span className="min-w-0 truncate">{text}</span>
        <ChevronDown aria-hidden size={13} className="shrink-0 opacity-60" />
      </button>
      <div
        ref={menuRef}
        id={id}
        role="dialog"
        aria-label={title}
        {...{ popover: "auto" }}
        onKeyDown={keepEscape}
        className="glass fixed inset-auto m-0 w-64 max-w-[calc(100vw-1rem)] flex-col gap-3 rounded-[10px] bg-bg/90! p-3 text-text [&:popover-open]:flex"
      >
        {children}
      </div>
    </>
  );
}
