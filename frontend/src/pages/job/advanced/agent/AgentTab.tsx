import { ArrowDown } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { api, TAB_ID, type AgentProviderListing } from "../../../../api";
import { rememberedValue } from "../../../../remembered";
import type { AgentTurnView } from "./agentStream";
import { ChatHeader } from "./ChatHeader";
import { Composer } from "./Composer";
import { PresenceContext } from "./presence";
import { ProviderSetup } from "./ProviderSetup";
import type { AgentThreads } from "./threads";
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
 * The Inspector's Agent tab (loaded only when opened), laid out as open-pencil's chat panel: a
 * header, the transcript, and the composer, whose model pill picks an Agent Provider and model.
 * Set the provider up until it is ready, and chat with it about this Candidate, each Agent Turn
 * streaming in. The chat's `stream` and its Agent `threads` are the editor's (they outlive the tab;
 * without `threads`, the header lists none and a message goes to the newest), and `onUndo` reverts or
 * restores a finished turn.
 */
export function AgentTab({
  jobId,
  candidateId,
  stream,
  threads,
  onUndo,
  initialProviders = null,
}: {
  jobId: string;
  candidateId: string;
  stream: AgentStream;
  threads?: AgentThreads;
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
      const thread = threads?.active?.id;
      const turn = await api.sendAgentTurn(jobId, candidateId, {
        provider: listing.provider.id,
        ...(model ? { model } : {}),
        prompt,
        tab: TAB_ID,
        ...(thread ? { thread } : {}),
      });
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
  const error = sendError ?? stream.state.error ?? threads?.error ?? null;
  return (
    <div className="flex h-full min-h-0 flex-col">
      <ChatHeader turns={stream.state.turns} threads={threads} />
      {settingUp ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          <ProviderSetup listing={listing} onSaved={saved} />
        </div>
      ) : (
        <Transcript turns={stream.state.turns} onExample={send} onUndo={onUndo} />
      )}
      {!settingUp && error && <p className="shrink-0 px-3 pb-2 text-sm text-danger">{error}</p>}
      <Composer
        providers={providers}
        listing={listing}
        models={models}
        model={model}
        onChoose={choose}
        setup={settingUp}
        setupOpen={setupOpen}
        onSetup={() => setSetupOpen(!setupOpen)}
        busy={busy}
        running={stream.running !== null}
        onSend={send}
        onStop={stop}
      />
    </div>
  );
}

/**
 * The chat's turns, kept scrolled to the newest until the owner scrolls up, when "Jump to latest"
 * brings them back; an introduction and three examples while empty.
 */
function Transcript({ turns, onExample, onUndo }: { turns: AgentTurnView[]; onExample: (prompt: string) => void; onUndo?: UndoTurn }) {
  const ref = useRef<HTMLDivElement>(null);
  // Whether the view follows the newest words: until scrolled up from the bottom.
  const following = useRef(true);
  const [scrolledUp, setScrolledUp] = useState(false);

  useEffect(() => {
    const view = ref.current;
    if (view && following.current) view.scrollTop = view.scrollHeight;
  }, [turns]);

  const jump = () => {
    const view = ref.current;
    if (!view) return;
    following.current = true;
    setScrolledUp(false);
    view.scrollTo({ top: view.scrollHeight, behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  };

  if (turns.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-y-auto px-3 py-3">
        <p className="px-1 pb-1 text-sm text-pretty text-muted">Ask the Agent to change this clip. It edits only this Candidate, and each change can be undone.</p>
        {EXAMPLE_PROMPTS.map((prompt) => (
          <button
            key={prompt}
            type="button"
            data-example=""
            onClick={() => onExample(prompt)}
            className="rounded-xl border border-border px-3 py-2 text-left text-sm text-muted hover:bg-fill hover:text-text focus-visible:outline-2 focus-visible:outline-focus"
          >
            {prompt}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={ref}
        onScroll={(event) => {
          const view = event.currentTarget;
          following.current = view.scrollHeight - view.scrollTop - view.clientHeight < 24;
          setScrolledUp(!following.current);
        }}
        className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3"
      >
        {turns.map((turn) => (
          <TurnView key={turn.id} turn={turn} onUndo={onUndo} />
        ))}
      </div>
      {scrolledUp && (
        <button
          type="button"
          onClick={jump}
          className="raised absolute right-3 bottom-3 flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium text-text focus-visible:outline-2 focus-visible:outline-focus"
        >
          <ArrowDown aria-hidden size={13} />
          Jump to latest
        </button>
      )}
    </div>
  );
}
