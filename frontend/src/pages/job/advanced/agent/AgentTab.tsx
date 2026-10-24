import { ArrowUp, LocateFixed, Settings2, Square } from "lucide-react";
import { useContext, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { api, TAB_ID, type AgentProviderListing } from "../../../../api";
import { Button } from "../../../../components/Button";
import { Select } from "../../../../components/Select";
import { rememberedValue } from "../../../../remembered";
import type { AgentTurnView } from "./agentStream";
import { rememberedFollow } from "./follow";
import { PresenceContext } from "./presence";
import { ProviderSetup } from "./ProviderSetup";
import { TurnView, type UndoTurn } from "./TurnView";
import type { AgentStream } from "./useAgentStream";

// The provider and model last chosen, per browser; versioned so a later shape starts afresh.
export const rememberedAgentChoice = rememberedValue<{ provider: string; model: string | null } | null>("agent.choice.v1", null);

// What the empty chat offers to send.
export const EXAMPLE_PROMPTS = ["Add a title over the first three seconds", "Tighten the pauses between sentences", "Make the captions bigger and yellow"];

/** The provider to show: the one last chosen while it is listed, else the first ready, else the first. */
export function chosenListing(listings: AgentProviderListing[], chosen: string | null): AgentProviderListing | null {
  return listings.find((listing) => listing.provider.id === chosen) ?? listings.find((listing) => listing.status.ready) ?? listings[0] ?? null;
}

/** An API provider's models to pick from: its saved one first, then its listed ones. None for an ACP agent. */
export function modelOptions({ provider, status }: AgentProviderListing): string[] {
  if (provider.kind !== "api") return [];
  return [...new Set([status.model, ...provider.models, provider.default_model].filter((model): model is string => !!model))];
}

/**
 * The Inspector's Agent tab (loaded only when opened): pick an Agent Provider and model, set it up
 * until it is ready, and chat with it about this Candidate, each Agent Turn streaming in. The chat's
 * `stream` is the editor's (it outlives the tab), and `onUndo` reverts or restores a finished turn.
 */
export function AgentTab({
  jobId,
  candidateId,
  stream,
  onUndo,
  initialProviders = null,
}: {
  jobId: string;
  candidateId: string;
  stream: AgentStream;
  onUndo?: UndoTurn;
  initialProviders?: AgentProviderListing[] | null;
}) {
  const [providers, setProviders] = useState(initialProviders);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [choice, setChoice] = useState(rememberedAgentChoice.read);
  const [setupOpen, setSetupOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api.listAgentProviders().then(setProviders, (reason) => setProvidersError(reason instanceof Error ? reason.message : "Couldn't list the providers"));
  }, []);

  const follow = rememberedFollow.use();
  // The Agent's cursor names its provider as listed here.
  const presence = useContext(PresenceContext);
  useEffect(() => {
    if (providers) presence?.named(Object.fromEntries(providers.map(({ provider }) => [provider.id, provider.label])));
  }, [providers, presence]);

  const listing = providers && chosenListing(providers, choice?.provider ?? null);
  const models = listing ? modelOptions(listing) : [];
  const model = choice?.model && models.includes(choice.model) ? choice.model : (models[0] ?? null);
  const busy = sending || stream.running !== null;

  const choose = (provider: string, chosenModel: string | null) => {
    const next = { provider, model: chosenModel };
    setChoice(next);
    rememberedAgentChoice.set(next);
    setSetupOpen(false);
    setSendError(null);
  };

  const saved = (updated: AgentProviderListing) => {
    setProviders((all) => all?.map((each) => (each.provider.id === updated.provider.id ? updated : each)) ?? [updated]);
    if (updated.status.ready) setSetupOpen(false);
  };

  // Whether it was sent: the composer then empties.
  async function send(prompt: string): Promise<boolean> {
    if (!listing || busy) return false;
    setSending(true);
    setSendError(null);
    try {
      const turn = await api.sendAgentTurn(jobId, candidateId, { provider: listing.provider.id, ...(model ? { model } : {}), prompt, tab: TAB_ID });
      stream.prompted(turn, prompt);
      return true;
    } catch (reason) {
      setSendError(reason instanceof Error ? reason.message : "Couldn't send it");
      return false;
    } finally {
      setSending(false);
    }
  }

  const stop = () => void api.cancelAgentTurn(jobId, candidateId, TAB_ID).catch(() => {});

  if (!providers || !listing) {
    return <p className={providersError ? "text-sm text-danger" : "text-sm text-muted"}>{providersError ?? "Loading the providers…"}</p>;
  }
  const settingUp = !listing.status.ready || setupOpen;
  return (
    <div className="flex h-full min-h-0 flex-col gap-3">
      <div className="flex items-end gap-2">
        <Select
          label="Provider"
          className="flex-1"
          value={listing.provider.id}
          options={providers.map(({ provider, status }) => ({ value: provider.id, label: status.ready ? provider.label : `${provider.label} (set up)` }))}
          onChange={(provider) => choose(provider, null)}
        />
        {models.length > 0 && model && (
          <Select label="Model" className="flex-1" value={model} options={models.map((name) => ({ value: name, label: name }))} onChange={(name) => choose(listing.provider.id, name)} />
        )}
        {listing.status.ready && (
          <Button variant="ghost" size="icon" aria-label={`Set up ${listing.provider.label}`} aria-pressed={setupOpen} onClick={() => setSetupOpen(!setupOpen)}>
            <Settings2 aria-hidden size={17} />
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="aria-pressed:text-accent-text"
          aria-label="Follow agent"
          aria-pressed={follow}
          title="Follow agent: the Timeline goes to what the Agent changes (until you scroll or zoom it in that turn)"
          onClick={() => rememberedFollow.set(!follow)}
        >
          <LocateFixed aria-hidden size={17} />
        </Button>
      </div>
      {settingUp ? (
        <ProviderSetup listing={listing} onSaved={saved} />
      ) : (
        <>
          <Transcript turns={stream.state.turns} onExample={send} onUndo={onUndo} />
          {(sendError ?? stream.state.error) && <p className="text-sm text-danger">{sendError ?? stream.state.error}</p>}
          <Composer busy={busy} running={stream.running !== null} onSend={send} onStop={stop} />
        </>
      )}
    </div>
  );
}

/** The chat's turns, kept scrolled to the newest until the owner scrolls up; three examples while empty. */
function Transcript({ turns, onExample, onUndo }: { turns: AgentTurnView[]; onExample: (prompt: string) => void; onUndo?: UndoTurn }) {
  const ref = useRef<HTMLDivElement>(null);
  // Whether the view follows the newest words: until scrolled up from the bottom.
  const following = useRef(true);

  useEffect(() => {
    const view = ref.current;
    if (view && following.current) view.scrollTop = view.scrollHeight;
  }, [turns]);

  if (turns.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col gap-2">
        <p className="text-sm text-pretty text-muted">Ask the Agent to change this clip. It edits only this Candidate, and each change can be undone.</p>
        {EXAMPLE_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            data-example=""
            onClick={() => onExample(prompt)}
            className="rounded-[10px] bg-fill px-3 py-2 text-left text-sm hover:text-text focus-visible:outline-2 focus-visible:outline-focus"
          >
            {prompt}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div
      ref={ref}
      onScroll={(event) => {
        const view = event.currentTarget;
        following.current = view.scrollHeight - view.scrollTop - view.clientHeight < 24;
      }}
      className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
    >
      {turns.map((turn) => (
        <TurnView key={turn.id} turn={turn} onUndo={onUndo} />
      ))}
    </div>
  );
}

/** The message box: Enter sends, Shift+Enter breaks the line; Stop in Send's place while a turn runs. Its text is its own state. */
function Composer({ busy, running, onSend, onStop }: { busy: boolean; running: boolean; onSend: (prompt: string) => Promise<boolean>; onStop: () => void }) {
  const [text, setText] = useState("");
  const prompt = text.trim();

  const send = async () => {
    if (prompt && !busy && (await onSend(prompt))) setText("");
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void send();
  };

  return (
    <div data-composer="" className="flex items-end gap-2">
      <textarea
        aria-label="Message the Agent"
        rows={2}
        value={text}
        placeholder="Ask for a change…"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKeyDown}
        className="max-h-40 min-h-11 w-full resize-none rounded-[10px] border border-border bg-fill px-3 py-2 text-base"
      />
      {running ? (
        <Button size="icon" aria-label="Stop" title="Stop" onClick={onStop}>
          <Square aria-hidden size={15} />
        </Button>
      ) : (
        <Button variant="primary" size="icon" aria-label="Send" title="Send (Enter)" disabled={!prompt || busy} onClick={() => void send()}>
          <ArrowUp aria-hidden size={18} />
        </Button>
      )}
    </div>
  );
}
