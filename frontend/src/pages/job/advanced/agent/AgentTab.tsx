import { ArrowDown } from "lucide-react";
import { useContext, useEffect, useRef, useState } from "react";
import { api, TAB_ID, type AgentAttachment, type AgentProviderListing, type AgentTurnRequest, type Candidate } from "../../../../api";
import { rememberedValue } from "../../../../remembered";
import type { AgentTurnView } from "./agentStream";
import { attachmentName, encodeAttachments, type DraftAttachment, type ReferableClip } from "./attachments";
import { ChatHeader } from "./ChatHeader";
import { ChoicePopup } from "./ChoicePopup";
import { ErrorNote } from "./ErrorNote";
import { openChoices } from "./choices";
import { Composer } from "./Composer";
import { PresenceContext } from "./presence";
import { ProviderSetup } from "./ProviderSetup";
import type { AgentThreads } from "./threads";
import { TurnView, type UndoTurn } from "./TurnView";
import { AgentUiContext, type AgentUiHost } from "./ui/GenerativeUi";
import type { AgentStream } from "./useAgentStream";

// The provider and model last chosen, per browser; versioned so a later shape starts afresh.
export const rememberedAgentChoice = rememberedValue<{ provider: string; model: string | null } | null>("agent.choice.v1", null);

// What the empty chat offers to send.
export const EXAMPLE_PROMPTS = ["Add a title over the first three seconds", "Tighten the pauses between sentences", "Make the captions bigger and yellow"];

/** The turn request this tab sends: a model, a Thread and attachments only when there are. */
export function turnRequest({
  provider,
  model,
  prompt,
  thread,
  attachments,
}: {
  provider: string;
  model: string | null;
  prompt: string;
  thread: string | null;
  attachments: AgentAttachment[];
}): AgentTurnRequest {
  return {
    provider,
    ...(model ? { model } : {}),
    prompt,
    tab: TAB_ID,
    ...(thread ? { thread } : {}),
    ...(attachments.length > 0 ? { attachments } : {}),
  };
}

/** The provider to show: the one last chosen while it is listed, else the first ready, else the first. */
export function chosenListing(listings: AgentProviderListing[], chosen: string | null): AgentProviderListing | null {
  return listings.find((listing) => listing.provider.id === chosen) ?? listings.find((listing) => listing.status.ready) ?? listings[0] ?? null;
}

/** An API provider's models to pick from: its saved one first, then its listed ones. None for an ACP agent. */
export function modelOptions({ provider, status }: AgentProviderListing): string[] {
  if (provider.kind !== "api") return [];
  return [...new Set([status.model, ...provider.models, provider.default_model].filter((model): model is string => !!model))];
}

const NO_CLIPS: ReferableClip[] = [];

/**
 * The Inspector's Agent tab (loaded only when opened), laid out as open-pencil's chat panel: a
 * header, the transcript, and the composer, whose model pill picks an Agent Provider and model.
 * Set the provider up until it is ready, and chat with it about this Candidate, each Agent Turn
 * streaming in. The chat's `stream` and its Agent `threads` are the editor's (they outlive the tab;
 * without `threads`, the header lists none and a message goes to the newest), and `onUndo` reverts or
 * restores a finished turn. `candidate` is the Candidate as the editor holds it, with its name, which
 * the Agent shows through show_ui; a choice it offers is sent as the composer sends. `others` are the
 * Job's other Candidates, which a message can reference.
 */
export function AgentTab({
  jobId,
  candidateId,
  stream,
  threads,
  onUndo,
  candidate = null,
  others = NO_CLIPS,
  initialProviders = null,
}: {
  jobId: string;
  candidateId: string;
  stream: AgentStream;
  threads?: AgentThreads;
  onUndo?: UndoTurn;
  candidate?: { value: Candidate; name: string } | null;
  others?: ReferableClip[];
  initialProviders?: AgentProviderListing[] | null;
}) {
  const [providers, setProviders] = useState(initialProviders);
  const [providersError, setProvidersError] = useState<string | null>(null);
  const [choice, setChoice] = useState(rememberedAgentChoice.read);
  const [setupOpen, setSetupOpen] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  // The message last sent and what went with it, for "Try again" when it couldn't be.
  const [lastSent, setLastSent] = useState<{ prompt: string; attachments: DraftAttachment[] } | null>(null);
  // The choices the owner closed with Escape or ✕, by their call: still answerable from their card.
  const [dismissed, setDismissed] = useState<ReadonlySet<string>>(new Set());
  const root = useRef<HTMLDivElement>(null);

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
  async function send(prompt: string, attachments: DraftAttachment[] = []): Promise<boolean> {
    if (!listing || busy) return false;
    setLastSent({ prompt, attachments });
    setSending(true);
    setSendError(null);
    try {
      const thread = threads?.active?.id ?? null;
      // Images go as base64, read from their files only now.
      const encoded = await encodeAttachments(attachments);
      const turn = await api.sendAgentTurn(jobId, candidateId, turnRequest({ provider: listing.provider.id, model, prompt, thread, attachments: encoded }));
      stream.prompted(
        turn,
        prompt,
        attachments.map((attachment) => ({ kind: attachment.kind, name: attachmentName(attachment, others) })),
      );
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
  const open = busy ? null : openChoices(stream.state.turns);
  const popup = open && !dismissed.has(open.call) ? open : null;
  const host: AgentUiHost = { jobId, candidateId, candidate, busy, choose: (prompt) => void send(prompt), popup: popup?.call ?? null };
  // The pop up gone, the focus it held goes back to the message box.
  const backToComposer = () => root.current?.querySelector<HTMLTextAreaElement>("[data-composer] textarea")?.focus();
  return (
    <AgentUiContext.Provider value={host}>
      <div ref={root} className="flex h-full min-h-0 flex-col overflow-hidden">
        <ChatHeader turns={stream.state.turns} threads={threads} />
        {settingUp ? (
          <div className="relative min-h-0 flex-1 overflow-y-auto px-3 py-3">
            <ProviderSetup listing={listing} onSaved={saved} />
          </div>
        ) : (
          <Transcript turns={stream.state.turns} onExample={(prompt) => void send(prompt)} onUndo={onUndo} />
        )}
        {!settingUp && error && (
          <div className="shrink-0 px-3 pb-2">
            <ErrorNote error={error} onRetry={sendError && lastSent && !busy ? () => void send(lastSent.prompt, lastSent.attachments) : undefined} />
          </div>
        )}
        {!settingUp && popup && (
          <ChoicePopup
            key={popup.call}
            ui={popup.ui}
            onChoose={(prompt) => {
              void send(prompt);
              backToComposer();
            }}
            onClose={() => {
              setDismissed((all) => new Set(all).add(popup.call));
              backToComposer();
            }}
          />
        )}
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
          candidates={others}
        />
      </div>
    </AgentUiContext.Provider>
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
      <div className="relative flex min-h-0 flex-1 flex-col justify-end gap-2 overflow-y-auto px-3 py-3">
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
        // Relative, so that what is absolutely placed in a turn (its sr-only words) scrolls with it
        // instead of spilling out and scrolling the Inspector, composer and all.
        className="relative flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3 py-3"
      >
        {turns.map((turn, index) => (
          <TurnView key={turn.id} turn={turn} nextPrompt={turns[index + 1]?.prompt ?? null} onUndo={onUndo} />
        ))}
      </div>
      {scrolledUp && (
        // A small round button, so it covers as little of the turn under it as it can.
        <button
          type="button"
          onClick={jump}
          aria-label="Jump to latest"
          title="Jump to latest"
          className="glass absolute right-2 bottom-2 flex size-7 items-center justify-center rounded-full text-text focus-visible:outline-2 focus-visible:outline-focus"
        >
          <ArrowDown aria-hidden size={14} />
        </button>
      )}
    </div>
  );
}
