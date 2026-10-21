import { Speech, X } from "lucide-react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { api, type VoicesList } from "../../../api";
import { Button } from "../../../components/Button";
import { Hint } from "../../../components/InfoTip";
import { ProgressBar } from "../../../components/ProgressBar";
import { Skeleton } from "../../../components/Skeleton";
import { Select } from "../../../components/Select";
import { Slider } from "../../../components/Slider";
import { cx } from "../../../format";
import {
  chosenVoice,
  engineOption,
  MAX_SCRIPT_CHARS,
  NARRATE_AT_END_HINT,
  PAUSE_STOPS,
  rememberChoice,
  rememberedVoice,
  type NarrateDraft,
  type NarrateFlow,
  type NarrateState,
  type RememberedVoice,
} from "./narrate";

/**
 * The Narrate tab (GLOSSARY.md, Narration; ADR 0019): an engine, a Voice, the pause between sentences
 * and a script, read aloud by Generate into a Media Library item that lands as a Music Clip marked
 * Speech at the playhead. The engines and Voices are loaded once, with the default engine for the Job's
 * `language`; the browser remembers the last engine and Voice chosen, which win over it. While it is
 * made, its progress and Cancel take Generate's place; the draft is the flow's, so it outlives the tab.
 * Generate is off with the playhead `atEnd` of the Clip.
 */
export function NarratePanel({ flow, language, atEnd }: { flow: NarrateFlow; language: string; atEnd: boolean }) {
  const [voices, setVoices] = useState<VoicesList | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.listVoices(language).then(setVoices, (reason: Error) => setError(`Couldn't load the Voices: ${reason.message}`));
  }, [language]);
  const state = useSyncExternalStore(flow.subscribe, () => flow.state, () => flow.state);
  const draft = useSyncExternalStore(flow.subscribe, () => flow.draft, () => flow.draft);
  const remembered = rememberedVoice.use();
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!voices) return <Skeleton className="h-40" />;
  return (
    <NarrateFields
      voices={voices}
      state={state}
      draft={draft}
      remembered={remembered}
      atEnd={atEnd}
      onDraft={(change) => {
        flow.edit(change);
        rememberChoice(change);
      }}
      onGenerate={(body) => void flow.generate(body)}
      onCancel={flow.cancel}
    />
  );
}

/** The tab's fields, given the engines, the flow's state, the draft and the remembered engine and Voice. */
export function NarrateFields({
  voices,
  state,
  draft,
  remembered = null,
  atEnd = false,
  onDraft,
  onGenerate,
  onCancel,
}: {
  voices: VoicesList;
  state: NarrateState;
  draft: NarrateDraft;
  remembered?: RememberedVoice | null;
  atEnd?: boolean;
  onDraft: (change: Partial<NarrateDraft>) => void;
  onGenerate: (body: { text: string; engine: string; voice: string; pauses: number }) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const ready = voices.engines.filter((engine) => engine.ready);
  const choice = chosenVoice(voices, draft, remembered);
  const { script, pause } = draft;
  if (!choice) {
    return (
      <div className="flex flex-col gap-4">
        <Hint>
          No speech engine is set up. In <code>.env</code>, add your Gemini API key as <code>GEMINI_API_KEY</code>, or an
          OpenAI-compatible speech service as <code>TTS_BASE_URL</code>, <code>TTS_API_KEY</code> and <code>TTS_MODEL</code>, and
          restart to narrate.
        </Hint>
        <Button variant="primary" disabled>
          <Speech aria-hidden size={18} />
          Generate
        </Button>
      </div>
    );
  }
  const { engine, voice: chosen } = choice;
  const making = state.phase === "making";
  const text = script.trim();
  const canGenerate = !making && !atEnd && !!text && text.length <= MAX_SCRIPT_CHARS && !!chosen;
  return (
    <div className="flex flex-col gap-4">
      <Hint more="Each sentence is read alone and joined with the pause. The Narration is kept in the Media tab; Undo removes the clip and keeps it.">
        Type a script: it is read aloud and lands at the playhead.
      </Hint>
      <Select
        label="Engine"
        value={engine.id}
        options={ready.map((option) => ({ value: option.id, label: engineOption(option) }))}
        onChange={(value) => onDraft({ engine: value, voice: null })}
        disabled={making}
      />
      <div role="radiogroup" aria-label="Voice" className="flex max-h-56 flex-col gap-1 overflow-y-auto">
        {engine.voices.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={option.id === chosen?.id}
            onClick={() => onDraft({ engine: engine.id, voice: option.id })}
            className={cx(
              "flex min-h-11 flex-col items-start justify-center rounded-[10px] px-3 py-1.5 text-left",
              "focus-visible:outline-2 focus-visible:outline-focus",
              option.id === chosen?.id ? "raised text-text" : "text-muted hover:bg-fill hover:text-text",
            )}
          >
            <span className="text-sm font-medium">{option.name}</span>
            <span className="text-xs">{option.detail}</span>
          </button>
        ))}
      </div>
      <Slider
        label="Pause between sentences"
        value={pause}
        min={0}
        max={PAUSE_STOPS.length - 1}
        format={(stop) => PAUSE_STOPS[stop].label}
        onChange={(stop) => onDraft({ pause: stop })}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-script`} className="text-sm font-medium">
          Script
        </label>
        <textarea
          id={`${id}-script`}
          value={script}
          rows={5}
          onChange={(event) => onDraft({ script: event.target.value })}
          className="min-h-28 w-full resize-y rounded-[10px] border border-border bg-fill px-3 py-2 text-base"
        />
        {text.length > MAX_SCRIPT_CHARS && (
          <p className="text-sm text-danger">A script can be {MAX_SCRIPT_CHARS.toLocaleString("en")} characters at most.</p>
        )}
      </div>
      {state.phase === "failed" && <p className="text-sm text-danger">{state.message}</p>}
      {making ? (
        <NarrationProgressRow state={state} onCancel={onCancel} />
      ) : (
        // The hint on the wrapper too: an off button takes no pointer, and so shows no title of its own.
        <div className="flex flex-col" title={atEnd ? NARRATE_AT_END_HINT : undefined}>
          <Button
            variant="primary"
            disabled={!canGenerate}
            onClick={() => chosen && onGenerate({ text, engine: engine.id, voice: chosen.id, pauses: PAUSE_STOPS[pause].secs })}
          >
            <Speech aria-hidden size={18} />
            Generate
          </Button>
        </div>
      )}
    </div>
  );
}

/** How far the Narration being made has got, sentence by sentence, with Cancel. */
function NarrationProgressRow({ state, onCancel }: { state: Extract<NarrateState, { phase: "making" }>; onCancel: () => void }) {
  const progress = state.progress;
  // The bar fills as the sentences are read; it sweeps while the voice loads, and is full past reading.
  const percent = !progress || progress.stage === "Loading the voice" ? null : progress.stage === "Reading" ? (100 * progress.done) / Math.max(1, progress.of) : 100;
  return (
    <div className="flex flex-col gap-2">
      <div aria-live="polite" className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">{progress ? `${progress.stage}…` : "Starting…"}</span>
        {progress && (
          <span className="text-muted tabular-nums">
            {progress.done} of {progress.of} {progress.of === 1 ? "sentence" : "sentences"}
          </span>
        )}
      </div>
      <ProgressBar percent={percent} label="Making the Narration" />
      <Button onClick={onCancel}>
        <X aria-hidden size={18} />
        Cancel
      </Button>
    </div>
  );
}
