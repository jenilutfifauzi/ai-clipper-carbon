import { Loader2, Speech } from "lucide-react";
import { useEffect, useId, useState, useSyncExternalStore } from "react";
import { api, type VoicesList } from "../../../api";
import { Button } from "../../../components/Button";
import { Hint } from "../../../components/InfoTip";
import { Skeleton } from "../../../components/Skeleton";
import { Slider } from "../../../components/Slider";
import { cx } from "../../../format";
import { DEFAULT_PAUSE, engineLabel, MAX_SCRIPT_CHARS, PAUSE_STOPS, type NarrateFlow, type NarrateState } from "./narrate";

/**
 * The Narrate tab (GLOSSARY.md, Narration; ADR 0019): a Voice, the pause between sentences and a script,
 * read aloud by Generate into a Media Library item that lands as a Music Clip marked Speech at the
 * playhead. The Voices are loaded once, with the default engine for the Job's `language`.
 */
export function NarratePanel({ flow, language, playhead }: { flow: NarrateFlow; language: string; playhead: () => number }) {
  const [voices, setVoices] = useState<VoicesList | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.listVoices(language).then(setVoices, (reason: Error) => setError(`Couldn't load the Voices: ${reason.message}`));
  }, [language]);
  const state = useSyncExternalStore(flow.subscribe, () => flow.state, () => flow.state);
  if (error) return <p className="text-sm text-danger">{error}</p>;
  if (!voices) return <Skeleton className="h-40" />;
  return <NarrateFields voices={voices} state={state} onGenerate={(body) => void flow.generate(body, playhead())} />;
}

/** The tab's fields, given the engines and the flow's state. */
export function NarrateFields({
  voices,
  state,
  onGenerate,
}: {
  voices: VoicesList;
  state: NarrateState;
  onGenerate: (body: { text: string; engine: string; voice: string; pauses: number }) => void;
}) {
  const id = useId();
  const ready = voices.engines.filter((engine) => engine.ready);
  const engine = ready.find((other) => other.id === voices.default) ?? ready[0];
  const [voice, setVoice] = useState<string | null>(null);
  const [pause, setPause] = useState<number>(DEFAULT_PAUSE);
  const [script, setScript] = useState("");
  if (!engine) {
    return (
      <Hint>
        No speech engine is set up. Add your Gemini API key to <code>.env</code> as <code>GEMINI_API_KEY</code> and restart to narrate.
      </Hint>
    );
  }
  const chosen = engine.voices.find((other) => other.id === voice) ?? engine.voices[0];
  const making = state.phase === "making";
  const text = script.trim();
  const canGenerate = !making && !!text && text.length <= MAX_SCRIPT_CHARS && !!chosen;
  return (
    <div className="flex flex-col gap-4">
      <Hint more="Each sentence is read alone and joined with the pause. The Narration is kept in the Media tab; Undo removes the clip and keeps it.">
        Type a script: it is read aloud and lands at the playhead.
      </Hint>
      <div className="flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">{engine.label}</span>
        <span className="text-muted">{engineLabel(engine)}</span>
      </div>
      <div role="radiogroup" aria-label="Voice" className="flex max-h-56 flex-col gap-1 overflow-y-auto">
        {engine.voices.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={option.id === chosen?.id}
            onClick={() => setVoice(option.id)}
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
        onChange={setPause}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor={`${id}-script`} className="text-sm font-medium">
          Script
        </label>
        <textarea
          id={`${id}-script`}
          value={script}
          rows={5}
          onChange={(event) => setScript(event.target.value)}
          className="min-h-28 w-full resize-y rounded-[10px] border border-border bg-fill px-3 py-2 text-base"
        />
        {text.length > MAX_SCRIPT_CHARS && (
          <p className="text-sm text-danger">A script can be {MAX_SCRIPT_CHARS.toLocaleString("en")} characters at most.</p>
        )}
      </div>
      {state.phase === "failed" && <p className="text-sm text-danger">{state.message}</p>}
      <Button
        variant="primary"
        disabled={!canGenerate}
        onClick={() => chosen && onGenerate({ text, engine: engine.id, voice: chosen.id, pauses: PAUSE_STOPS[pause].secs })}
      >
        {making ? <Loader2 aria-hidden size={18} className="motion-safe:animate-spin" /> : <Speech aria-hidden size={18} />}
        {making ? "Making the Narration…" : "Generate"}
      </Button>
    </div>
  );
}
