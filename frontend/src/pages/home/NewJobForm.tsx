import { ArrowRight, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useNavigate } from "react-router";
import { api, uploadJob, type Aspect, type JobOptions, type UploadProgress } from "../../api";
import { Button } from "../../components/Button";
import { Panel } from "../../components/Panel";
import { ProgressBar } from "../../components/ProgressBar";
import { Segmented } from "../../components/Segmented";
import { Switch } from "../../components/Switch";
import { cx, formatBytes } from "../../format";
import { LANGUAGES } from "../../languages";
import { FileDrop } from "./FileDrop";

type Origin = "url" | "upload";

const ORIGINS = [
  { value: "url", label: "YouTube URL" },
  { value: "upload", label: "Upload a file" },
] as const satisfies readonly { value: Origin; label: string }[];

// The Canvas Aspect its Candidates are made in (docs/adr/0022): Shorts, TikTok and Reels by default.
const ASPECTS = [
  { value: "9:16", label: "9:16" },
  { value: "4:5", label: "4:5" },
  { value: "1:1", label: "1:1" },
  { value: "16:9", label: "16:9" },
] as const satisfies readonly { value: Aspect; label: string }[];
const ASPECT_HINTS: Record<Aspect, string> = {
  "9:16": "Vertical, for Shorts, TikTok and Reels.",
  "4:5": "Tall, for Instagram and Facebook feeds.",
  "1:1": "Square, for feeds.",
  "16:9": "Landscape, for YouTube and other players.",
};

const INPUT = cx(
  "w-full min-w-0 rounded-control border border-border bg-fill px-3.5 py-2.5 text-base text-text",
  "placeholder:text-muted user-invalid:border-danger",
);
const LABEL = "text-sm font-medium";
const HINT = "text-sm text-muted";

// Start a Job from a YouTube URL or an uploaded master file; then open its page. The optional Brief
// and the Job's options sit in a closed "Advanced options" section whose summary shows their values.
export function NewJobForm() {
  const navigate = useNavigate();
  const id = useId();
  const [minSecs, setMinSecs] = useState("20");
  const [maxSecs, setMaxSecs] = useState("90");
  const [captions, setCaptions] = useState(true);
  const [language, setLanguage] = useState("id");
  const [aspect, setAspect] = useState<Aspect>("9:16");
  const [brief, setBrief] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const advancedSection = useRef<HTMLDetailsElement>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Origin>("url");
  const [file, setFile] = useState<File | null>(null);
  const [uploaded, setUploaded] = useState<UploadProgress | null>(null);
  const cancelUpload = useRef<(() => void) | null>(null);
  const maxInput = useRef<HTMLInputElement>(null);

  // Leaving the page would cut the upload short.
  const uploading = uploaded !== null;
  useEffect(() => {
    if (!uploading) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [uploading]);

  const rangeError = Number(minSecs) >= Number(maxSecs) ? "Make the longest clip longer than the shortest." : "";
  useEffect(() => maxInput.current?.setCustomValidity(rangeError), [rangeError]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    setError(null);
    const options: Partial<JobOptions> = {
      brief: brief.trim() || null,
      min_secs: Number(minSecs),
      max_secs: Number(maxSecs),
      captions,
      language: language.trim(),
      aspect,
    };
    try {
      let job;
      if (origin === "upload" && file) {
        // Asked first: the answer to the upload itself would only come once all of it was sent.
        await api.checkUpload(file.size);
        setUploaded({ loaded: 0, total: file.size });
        const upload = uploadJob(file, options, setUploaded);
        cancelUpload.current = upload.abort;
        job = await upload.done;
      } else {
        job = await api.createJob({ url: String(form.get("url")).trim(), options });
      }
      navigate(`/jobs/${job.id}`);
    } catch (reason) {
      if ((reason as Error).name !== "AbortError") setError((reason as Error).message);
      setPending(false);
      setUploaded(null);
    } finally {
      cancelUpload.current = null;
    }
  }

  // Cmd/Ctrl+Enter in the Brief submits too.
  function submitFromBrief(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !event.nativeEvent.isComposing) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  }

  // The browser can't point at an invalid field inside the closed section, so open it first.
  function openOnInvalid(event: FormEvent<HTMLFormElement>) {
    if (advancedSection.current?.contains(event.target as Node)) setAdvanced(true);
  }

  const summary = [
    `${minSecs || "?"}–${maxSecs || "?"} s`,
    language.trim() || "?",
    captions ? "Captions on" : "Captions off",
    ...(brief.trim() ? ["Brief"] : []),
  ].join(" · ");

  return (
    <Panel aria-labelledby={`${id}-heading`}>
      <h1 id={`${id}-heading`} className="text-2xl font-semibold tracking-tight text-balance">
        New Clips
      </h1>
      <p className="mt-1 max-w-prose text-pretty text-muted">
        Paste a published episode, or upload its master file. Candidates are ready to review when it's analyzed.
      </p>

      <form onSubmit={submit} onInvalidCapture={openOnInvalid} className="mt-6 flex flex-col gap-5">
        <Segmented
          legend="Episode"
          options={ORIGINS}
          value={origin}
          onChange={(value) => {
            setOrigin(value);
            setError(null);
          }}
          className={cx("sm:max-w-sm", pending && "pointer-events-none opacity-60")}
        />
        {origin === "url" ? (
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
        ) : (
          <div className="flex flex-col gap-1.5">
            <span className={LABEL}>Master file</span>
            <FileDrop id={`${id}-file`} file={file} onFile={setFile} disabled={pending} />
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <Segmented
            legend="Shape"
            options={ASPECTS}
            value={aspect}
            onChange={setAspect}
            className={cx("sm:max-w-sm", pending && "pointer-events-none opacity-60")}
          />
          <span className={HINT}>{ASPECT_HINTS[aspect]}</span>
        </div>

        <details
          ref={advancedSection}
          open={advanced}
          onToggle={(event) => setAdvanced(event.currentTarget.open)}
          className="group -mx-2"
        >
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-control px-2 select-none hover:bg-fill motion-safe:transition-colors [&::-webkit-details-marker]:hidden">
            <ChevronRight aria-hidden size={18} className="shrink-0 text-muted group-open:rotate-90 motion-safe:transition-transform motion-safe:duration-150 motion-safe:ease-out" />
            <span className={cx(LABEL, "shrink-0")}>Advanced options</span>
            <span className="min-w-0 truncate text-sm text-muted tabular-nums">{summary}</span>
          </summary>
          <div className="flex flex-col gap-5 px-2 pt-3">
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
                value={brief}
                onChange={(event) => setBrief(event.target.value)}
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
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
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
                <Switch checked={captions} onChange={setCaptions} labelledBy={`${id}-captions-label`}>
                  <span className="text-sm text-muted">{captions ? "On" : "Off"}</span>
                </Switch>
              </div>
              {rangeError && (
                <p id={`${id}-range-error`} className="col-span-full -mt-2 text-sm text-danger">
                  {rangeError}
                </p>
              )}
            </fieldset>
          </div>
        </details>

        {/* Empty, it takes no room: the gap above the submit button stays one gap. */}
        <div aria-live="polite" className="empty:-mt-5">
          {error && <p className="rounded-control bg-danger-surface p-3 text-sm text-danger">{error}</p>}
        </div>

        {uploaded ? (
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-sm">
              <span>{uploaded.loaded < uploaded.total ? "Uploading…" : "Storing the file…"}</span>
              <span className="text-muted tabular-nums">
                {formatBytes(uploaded.loaded)} of {formatBytes(uploaded.total)} ·{" "}
                {Math.floor((100 * uploaded.loaded) / Math.max(1, uploaded.total))}%
              </span>
            </div>
            <ProgressBar percent={(100 * uploaded.loaded) / Math.max(1, uploaded.total)} label="Upload progress" />
            <Button onClick={() => cancelUpload.current?.()} className="mt-1 self-start">
              Cancel upload
            </Button>
          </div>
        ) : (
          <Button type="submit" variant="primary" disabled={pending} className="self-start">
            {pending ? "Starting…" : origin === "upload" ? "Upload and start" : "Start clipping"}
            <ArrowRight aria-hidden size={18} />
          </Button>
        )}
      </form>
    </Panel>
  );
}
