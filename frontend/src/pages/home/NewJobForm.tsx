import { ArrowRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { api } from "../../api";
import { Button } from "../../components/Button";
import { Panel } from "../../components/Panel";
import { cx } from "../../format";

const LANGUAGES = [
  ["id", "Indonesian"],
  ["en", "English"],
  ["ms", "Malay"],
  ["jv", "Javanese"],
  ["su", "Sundanese"],
];

const INPUT = cx(
  "w-full rounded-control border border-border bg-surface-raised px-3.5 py-2.5 text-base text-text",
  "placeholder:text-muted user-invalid:border-danger",
);
const LABEL = "text-sm font-medium";
const HINT = "text-sm text-muted";

// Start a Job from a YouTube URL, with an optional Brief and the Job's options; then open its page.
export function NewJobForm() {
  const navigate = useNavigate();
  const id = useId();
  const [minSecs, setMinSecs] = useState("20");
  const [maxSecs, setMaxSecs] = useState("90");
  const [captions, setCaptions] = useState(true);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maxInput = useRef<HTMLInputElement>(null);

  const rangeError = Number(minSecs) >= Number(maxSecs) ? "Make the longest clip longer than the shortest." : "";
  useEffect(() => maxInput.current?.setCustomValidity(rangeError), [rangeError]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    try {
      const job = await api.createJob({
        url: String(form.get("url")).trim(),
        options: {
          brief: String(form.get("brief")).trim() || null,
          min_secs: Number(minSecs),
          max_secs: Number(maxSecs),
          captions,
          language: String(form.get("language")).trim(),
        },
      });
      navigate(`/jobs/${job.id}`);
    } catch (reason) {
      setError((reason as Error).message);
      setPending(false);
    }
  }

  // Cmd/Ctrl+Enter in the Brief submits too.
  function submitFromBrief(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  return (
    <Panel aria-labelledby={`${id}-heading`}>
      <h1 id={`${id}-heading`} className="text-2xl font-semibold tracking-tight">
        New Job
      </h1>
      <p className="mt-1 text-muted">Paste a published episode. Candidates are ready to review when it's analyzed.</p>

      <form onSubmit={submit} className="mt-6 flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-url`} className={LABEL}>
            YouTube URL
          </label>
          <input
            id={`${id}-url`}
            name="url"
            type="url"
            required
            placeholder="https://www.youtube.com/watch?v=…"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="go"
            className={INPUT}
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <label htmlFor={`${id}-brief`} className={LABEL}>
            Brief <span className="font-normal text-muted">(optional)</span>
          </label>
          <span id={`${id}-brief-hint`} className={HINT}>
            What to look for in this episode, e.g. "find the funny moments".
          </span>
          <textarea
            id={`${id}-brief`}
            name="brief"
            rows={2}
            aria-describedby={`${id}-brief-hint`}
            onKeyDown={submitFromBrief}
            className={cx(INPUT, "resize-y")}
          />
        </div>

        <fieldset className="grid grid-cols-2 gap-x-4 gap-y-5 sm:grid-cols-4">
          <legend className="sr-only">Options</legend>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-min`} className={LABEL}>
              Shortest clip
            </label>
            <div className="relative">
              <input
                id={`${id}-min`}
                type="number"
                inputMode="numeric"
                min={1}
                required
                value={minSecs}
                onChange={(event) => setMinSecs(event.target.value)}
                className={cx(INPUT, "pr-8 tabular-nums")}
              />
              <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3.5 grid place-items-center text-muted">
                s
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-max`} className={LABEL}>
              Longest clip
            </label>
            <div className="relative">
              <input
                id={`${id}-max`}
                ref={maxInput}
                type="number"
                inputMode="numeric"
                min={1}
                required
                value={maxSecs}
                onChange={(event) => setMaxSecs(event.target.value)}
                aria-describedby={`${id}-range-error`}
                className={cx(INPUT, "pr-8 tabular-nums")}
              />
              <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3.5 grid place-items-center text-muted">
                s
              </span>
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label htmlFor={`${id}-language`} className={LABEL}>
              Language
            </label>
            <input
              id={`${id}-language`}
              name="language"
              list={`${id}-languages`}
              required
              defaultValue="id"
              pattern="[A-Za-z]{2,3}(-[A-Za-z0-9]+)*"
              title="A language code such as id or en"
              autoComplete="off"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              className={INPUT}
            />
            <datalist id={`${id}-languages`}>
              {LANGUAGES.map(([code, name]) => (
                <option key={code} value={code}>
                  {name}
                </option>
              ))}
            </datalist>
          </div>
          <div className="flex flex-col gap-1.5">
            <span id={`${id}-captions-label`} className={LABEL}>
              Captions
            </span>
            <label className="flex min-h-11 cursor-pointer items-center gap-3">
              <input
                type="checkbox"
                role="switch"
                checked={captions}
                onChange={(event) => setCaptions(event.target.checked)}
                aria-labelledby={`${id}-captions-label`}
                className="peer sr-only"
              />
              <span
                aria-hidden
                className={cx(
                  "relative h-7 w-12 shrink-0 rounded-full border border-border bg-surface-raised",
                  "peer-checked:border-accent peer-checked:bg-accent peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent",
                  "after:absolute after:top-0.5 after:left-0.5 after:size-5.5 after:rounded-full after:bg-white after:shadow",
                  "motion-safe:after:transition-transform peer-checked:after:translate-x-5",
                )}
              />
              <span className="text-sm text-muted">{captions ? "On" : "Off"}</span>
            </label>
          </div>
          {rangeError && (
            <p id={`${id}-range-error`} className="col-span-full -mt-2 text-sm text-danger">
              {rangeError}
            </p>
          )}
        </fieldset>

        <div aria-live="polite">
          {error && <p className="rounded-control bg-danger-surface p-3 text-sm text-danger">{error}</p>}
        </div>

        <Button type="submit" variant="primary" disabled={pending} className="self-start px-5">
          {pending ? "Starting…" : "Start Job"}
          <ArrowRight aria-hidden size={18} />
        </Button>
      </form>
    </Panel>
  );
}
