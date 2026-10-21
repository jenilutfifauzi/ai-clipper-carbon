import { LoaderCircle, Play, Speech, Square, X } from "lucide-react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { api, type NarrationRequest, type VoicesList } from "../../../api";
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
  NARRATE_AT_END_HINT,
  NARRATE_TITLE_AT_END_HINT,
  NARRATION_SPEED_STEP,
  NARRATION_SPEEDS,
  narrationBody,
  narrationEstimate,
  PAUSE_STOPS,
  rememberChoice,
  rememberedVoice,
  playSound,
  scriptTooLong,
  VoiceSamples,
  type SampleState,
  type NarrateDraft,
  type NarratedTitle,
  type NarrateFlow,
  type NarrateState,
  type RememberedVoice,
} from "./narrate";
import { speedLabel } from "./speed";

/**
 * The Narrate tab (GLOSSARY.md, Narration; ADR 0019): an engine, a Voice, the Speed, the pause between
 * sentences, a Style line for an engine that takes one, and a script with the estimate of its length, read aloud by Generate into a Media Library item that lands as a Music Clip marked
 * Speech at the playhead, or at the start of the picked `title` (a Text Layer or the hook), whose words
 * fill the script when the tab opens or the Pick changes, unless the owner has typed one (NarrateFlow's
 * `prefill`). The engines and Voices are loaded once, with the default engine for the Job's
 * `language`; the browser remembers the last engine and Voice chosen, which win over it. While it is
 * made, its progress and Cancel take Generate's place; the draft is the flow's, so it outlives the tab.
 * Generate is off with the start `atEnd` of the Clip, and past 5,000 characters. Each Voice has Play
 * sample (VoiceSamples), in the Job's language; it says busy when a Narration elsewhere holds the runner.
 */
export function NarratePanel({ flow, language, atEnd, title }: { flow: NarrateFlow; language: string; atEnd: boolean; title: NarratedTitle | null }) {
  const [voices, setVoices] = useState<VoicesList | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.listVoices(language).then(setVoices, (reason: Error) => setError(`Couldn't load the Voices: ${reason.message}`));
  }, [language]);
  const state = useSyncExternalStore(flow.subscribe, () => flow.state, () => flow.state);
  const draft = useSyncExternalStore(flow.subscribe, () => flow.draft, () => flow.draft);
  const remembered = rememberedVoice.use();
  const [samples] = useState(() => new VoiceSamples({ fetch: api.voiceSample, play: playSound }));
  const sample = useSyncExternalStore(samples.subscribe, () => samples.state, () => samples.state);
  useEffect(() => samples.stop, [samples]);
  // Its words in the script on opening the tab, and again when another title is picked while it shows.
  const words = title?.script ?? null;
  useEffect(() => flow.prefill(words), [flow, words]);
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!voices) return <Skeleton className="h-40" />;
  return (
    <NarrateFields
      voices={voices}
      language={language}
      state={state}
      draft={draft}
      remembered={remembered}
      atEnd={atEnd}
      title={title}
      onDraft={(change) => {
        flow.edit(change);
        rememberChoice(change);
      }}
      onGenerate={(body) => void flow.generate(body, title?.start)}
      onCancel={flow.cancel}
      sample={sample}
      onSample={(engine, voice) => void samples.play(engine, voice, language)}
    />
  );
}

/** The tab's fields, given the engines, the Job's language (the estimate's pace), the flow's state, the
 * draft, the remembered engine and Voice, and the picked title it lands at the start of. */
export function NarrateFields({
  voices,
  language = "id",
  state,
  draft,
  remembered = null,
  atEnd = false,
  title = null,
  onDraft,
  onGenerate,
  onCancel,
  sample = null,
  onSample = () => {},
}: {
  voices: VoicesList;
  language?: string;
  state: NarrateState;
  draft: NarrateDraft;
  remembered?: RememberedVoice | null;
  atEnd?: boolean;
  title?: NarratedTitle | null;
  onDraft: (change: Partial<NarrateDraft>) => void;
  onGenerate: (body: NarrationRequest) => void;
  onCancel: () => void;
  // The Play sample loading, playing or refused, and Play sample pressed (engine and Voice ids).
  sample?: SampleState;
  onSample?: (engine: string, voice: string) => void;
}) {
  const id = useId();
  const ready = voices.engines.filter((engine) => engine.ready);
  const choice = chosenVoice(voices, draft, remembered);
  const { script, speed, pause, style } = draft;
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
  const tooLong = scriptTooLong(script);
  const estimate = narrationEstimate(script, language, speed);
  const canGenerate = !making && !atEnd && !!text && !tooLong && !!chosen;
  return (
    <div className="flex flex-col gap-4">
      <Hint more="Each sentence is read alone and joined with the pause. The Narration is kept in the Media tab; Undo removes the clip and keeps it.">
        Type a script: it is read aloud and lands at {title ? `the start of ${title.name}` : "the playhead"}.
      </Hint>
      <Select
        label="Engine"
        value={engine.id}
        options={ready.map((option) => ({ value: option.id, label: engineOption(option) }))}
        onChange={(value) => onDraft({ engine: value, voice: null })}
        disabled={making}
      />
      <div role="radiogroup" aria-label="Voice" className="flex max-h-56 flex-col gap-1 overflow-y-auto">
        {engine.voices.map((option) => {
          const playing = sample?.engine === engine.id && sample.voice === option.id ? sample : null;
          return (
            <div key={option.id} className="flex flex-col">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  role="radio"
                  aria-checked={option.id === chosen?.id}
                  onClick={() => onDraft({ engine: engine.id, voice: option.id })}
                  className={cx(
                    "flex min-h-11 flex-1 flex-col items-start justify-center rounded-[10px] px-3 py-1.5 text-left",
                    "focus-visible:outline-2 focus-visible:outline-focus",
                    option.id === chosen?.id ? "raised text-text" : "text-muted hover:bg-fill hover:text-text",
                  )}
                >
                  <span className="text-sm font-medium">{option.name}</span>
                  <span className="text-xs">{option.detail}</span>
                </button>
                <SampleButton voice={option.name} state={playing} disabled={!engine.ready || making} onPlay={() => onSample(engine.id, option.id)} />
              </div>
              {playing && (playing.phase === "busy" || playing.phase === "failed") && (
                <p role="status" className={cx("px-3 text-xs", playing.phase === "busy" ? "text-muted" : "text-danger")}>
                  {playing.message}
                </p>
              )}
            </div>
          );
        })}
      </div>
      <Slider
        label="Speed"
        value={speed}
        min={NARRATION_SPEEDS[0]}
        max={NARRATION_SPEEDS[1]}
        step={NARRATION_SPEED_STEP}
        format={speedLabel}
        onChange={(value) => onDraft({ speed: value })}
      />
      <Slider
        label="Pause between sentences"
        value={pause}
        min={0}
        max={PAUSE_STOPS.length - 1}
        format={(stop) => PAUSE_STOPS[stop].label}
        onChange={(stop) => onDraft({ pause: stop })}
      />
      {engine.takes_style && (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-style`} className="text-sm font-medium">
            Style
          </label>
          <input
            id={`${id}-style`}
            type="text"
            value={style}
            maxLength={200}
            placeholder="warm, unhurried"
            onChange={(event) => onDraft({ style: event.target.value })}
            className="min-h-11 w-full rounded-[10px] border border-border bg-fill px-3 text-base"
          />
        </div>
      )}
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
        {tooLong ? (
          <p className="text-sm text-danger">{tooLong}</p>
        ) : (
          estimate && <p className="text-sm text-muted tabular-nums">{estimate}</p>
        )}
      </div>
      {state.phase === "failed" && <p className="text-sm text-danger">{state.message}</p>}
      {making ? (
        <NarrationProgressRow state={state} onCancel={onCancel} />
      ) : (
        // The hint on the wrapper too: an off button takes no pointer, and so shows no title of its own.
        <div className="flex flex-col" title={atEnd ? (title ? NARRATE_TITLE_AT_END_HINT : NARRATE_AT_END_HINT) : undefined}>
          <Button
            variant="primary"
            disabled={!canGenerate}
            onClick={() => chosen && onGenerate(narrationBody(engine, chosen.id, draft))}
          >
            <Speech aria-hidden size={18} />
            Generate
          </Button>
        </div>
      )}
    </div>
  );
}

/** A Voice's Play sample: a spinner while it is made, Stop while it plays. Off for an engine that isn't
 * ready (Kokoro before its download) and while a Narration is being made. */
function SampleButton({ voice, state, disabled, onPlay }: { voice: string; state: SampleState; disabled: boolean; onPlay: () => void }) {
  const phase = state?.phase;
  const label = phase === "playing" ? `Stop the sample of ${voice}` : phase === "loading" ? `Making the sample of ${voice}` : `Play sample of ${voice}`;
  return (
    <Button variant="ghost" size="icon" aria-label={label} title={label} disabled={disabled} onClick={onPlay}>
      {phase === "loading" ? (
        <LoaderCircle aria-hidden size={18} className="motion-safe:animate-spin" />
      ) : phase === "playing" ? (
        <Square aria-hidden size={16} />
      ) : (
        <Play aria-hidden size={18} />
      )}
    </Button>
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
