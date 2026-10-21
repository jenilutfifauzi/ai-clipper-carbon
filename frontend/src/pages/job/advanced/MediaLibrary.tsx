import { ChevronDown, Film, ImagePlus, Layers, Music, Pause, Play, Plus, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  api,
  ApiError,
  mediaItemUrl,
  mediaThumbnailUrl,
  uploadMedia,
  type MediaItem,
  type MediaKind,
  type MediaUse,
} from "../../../api";
import { ConfirmDialog } from "../../../components/ConfirmDialog";
import { Hint } from "../../../components/InfoTip";
import { ProgressBar } from "../../../components/ProgressBar";
import { Skeleton } from "../../../components/Skeleton";
import { cx, formatBytes, formatPrecise } from "../../../format";
import { DRAG_MEDIA } from "./drag";
import { languageChoices } from "./mediaCaptions";

// An item's card or row carries its id when dragged onto the timeline.
const draggable = (item: MediaItem) => ({
  draggable: true,
  onDragStart: (event: React.DragEvent) => {
    event.dataTransfer.setData(DRAG_MEDIA, item.id);
    event.dataTransfer.effectAllowed = "copy";
  },
});

interface Uploading {
  key: number;
  name: string;
  // Of the upload; null once it is in and the backend converts it.
  percent: number | null;
  error: string | null;
}

export interface MediaLibrary {
  // Null while it loads.
  items: MediaItem[] | null;
  error: string | null;
  uploads: Uploading[];
  // The item it makes, once uploaded and converted: rejected as the upload is.
  upload: (file: File) => Promise<MediaItem>;
  dismiss: (key: number) => void;
  // Resolves to the clips using it when it can't be deleted.
  remove: (item: MediaItem) => Promise<MediaUse[] | null>;
  // A video's language for its Media Words, in every Job (null: each Job's).
  setLanguage: (item: MediaItem, language: string | null) => Promise<void>;
  // An item the backend made (a Narration), listed with the uploaded ones.
  added: (item: MediaItem) => void;
}

// What a video's card needs to set its language: the Job's (its first choice), and what setting it does.
export interface MediaLanguages {
  job: string;
  set: (item: MediaItem, language: string | null) => Promise<void>;
}

let uploadKeys = 0;

/** The Media Library, loaded once, with the uploads under way. */
export function useMediaLibrary(): MediaLibrary {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploads, setUploads] = useState<Uploading[]>([]);

  useEffect(() => {
    api.listMedia().then(setItems, (reason: Error) => {
      setItems([]);
      setError(`Couldn't load the media: ${reason.message}`);
    });
  }, []);

  function change(key: number, update: Partial<Uploading>) {
    setUploads((old) => old.map((item) => (item.key === key ? { ...item, ...update } : item)));
  }

  return {
    items,
    error,
    uploads,
    upload(file) {
      const key = ++uploadKeys;
      setUploads((old) => [...old, { key, name: file.name, percent: 0, error: null }]);
      const { done } = uploadMedia(file, ({ loaded, total }) => change(key, { percent: loaded >= total ? null : (100 * loaded) / total }));
      done.then(
        (item) => {
          setItems((old) => [...(old ?? []), item]);
          setUploads((old) => old.filter((other) => other.key !== key));
        },
        (reason: Error) => change(key, { error: reason.message, percent: 0 }),
      );
      return done;
    },
    dismiss: (key) => setUploads((old) => old.filter((item) => item.key !== key)),
    added: (item) => setItems((old) => [...(old ?? []).filter((other) => other.id !== item.id), item]),
    async setLanguage(item, language) {
      const changed = await api.setMediaLanguage(item.id, language);
      setItems((old) => (old ?? []).map((other) => (other.id === changed.id ? changed : other)));
    },
    async remove(item) {
      try {
        await api.deleteMedia(item.id);
        setItems((old) => (old ?? []).filter((other) => other.id !== item.id));
        return null;
      } catch (reason) {
        if (reason instanceof ApiError && reason.status === 409) {
          return ((reason.detail as { uses?: MediaUse[] } | undefined)?.uses ?? []) as MediaUse[];
        }
        throw reason;
      }
    },
  };
}

/**
 * The Media tab (videos and images) or the Audio tab (songs, and videos' sound): an upload button,
 * the uploads under way, and the items, each added to the clip by `onAdd` and deletable.
 */
export function MediaAssets({
  library,
  kinds,
  onAdd,
  addable = () => true,
  onOverlay,
  languages,
  hint,
  details,
}: {
  library: MediaLibrary;
  kinds: MediaKind[];
  // What adding an item does, for the items it is offered for (by default, all of them).
  onAdd?: (item: MediaItem) => void;
  addable?: (item: MediaItem) => boolean;
  // Adding a video or an image over the Clip instead.
  onOverlay?: (item: MediaItem) => void;
  // Each video's language, set from its card.
  languages?: MediaLanguages;
  // One sentence, and more in a tip.
  hint: ReactNode;
  details?: ReactNode;
}) {
  const audio = kinds.includes("audio");
  const items = library.items?.filter((item) => kinds.includes(item.kind)) ?? null;
  const [deleting, setDeleting] = useState<MediaItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleteError, setDeleteError] = useState<ReactNode>(null);

  async function remove(item: MediaItem) {
    setBusy(true);
    setDeleteError(null);
    try {
      const uses = await library.remove(item);
      if (uses === null) setDeleting(null);
      else
        setDeleteError(
          <>
            It is used by {uses.length === 1 ? "a clip" : `${uses.length} clips`}: {uses.map((use) => use.title).join(", ")}. Remove it from{" "}
            {uses.length === 1 ? "that clip" : "them"} first.
          </>,
        );
    } catch (reason) {
      setDeleteError((reason as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <UploadButton
        accept={audio ? "audio/*" : "video/*,image/png,image/jpeg,image/webp"}
        label={audio ? "Upload music" : "Upload video or image"}
        icon={audio ? Music : ImagePlus}
        onFile={library.upload}
      />
      <Hint more={details}>{hint}</Hint>
      {library.uploads.map((upload) => (
        <div key={upload.key} className="flex flex-col gap-1.5 rounded-[10px] bg-fill p-2.5 text-sm">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate">{upload.name}</span>
            {upload.error && (
              <button type="button" onClick={() => library.dismiss(upload.key)} className="shrink-0 text-muted hover:text-text">
                Dismiss
              </button>
            )}
          </div>
          {upload.error ? (
            <p className="text-danger">{upload.error}</p>
          ) : (
            <>
              <ProgressBar percent={upload.percent} label={`Uploading ${upload.name}`} />
              <span className="text-xs text-muted">{upload.percent === null ? "Converting…" : `Uploading ${Math.round(upload.percent)}%`}</span>
            </>
          )}
        </div>
      ))}
      {library.error && <p className="text-sm text-danger">{library.error}</p>}
      {items === null ? (
        <div className="grid grid-cols-2 gap-2">
          <Skeleton className="aspect-video" />
          <Skeleton className="aspect-video" />
        </div>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted">{audio ? "No music yet." : "No videos or images yet."}</p>
      ) : audio ? (
        <ul className="flex flex-col gap-1.5">
          {items.map((item) => (
            <AudioRow key={item.id} item={item} onAdd={onAdd} onDelete={() => setDeleting(item)} />
          ))}
        </ul>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {items.map((item) => (
            <VisualCard
              key={item.id}
              item={item}
              onAdd={addable(item) ? onAdd : onOverlay}
              onOverlay={addable(item) ? onOverlay : undefined}
              languages={item.kind === "video" && item.has_audio ? languages : undefined}
              onDelete={() => setDeleting(item)}
            />
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete “${deleting?.name ?? ""}”?`}
        confirmLabel="Delete"
        busyLabel="Deleting…"
        busy={busy}
        error={typeof deleteError === "string" ? deleteError : null}
        onConfirm={() => deleting && void remove(deleting)}
        onCancel={() => {
          setDeleting(null);
          setDeleteError(null);
        }}
      >
        {deleteError && typeof deleteError !== "string" ? (
          <span className="text-danger">{deleteError}</span>
        ) : (
          "It is removed from the Media Library for every Job."
        )}
      </ConfirmDialog>
    </div>
  );
}

function UploadButton({
  accept,
  label,
  icon: Icon,
  onFile,
}: {
  accept: string;
  label: string;
  icon: typeof Upload;
  onFile: (file: File) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <label
      className={cx(
        "raised inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-control px-4 font-medium hover:bg-fill",
        "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-focus",
      )}
    >
      <input
        ref={input}
        type="file"
        accept={accept}
        multiple
        onChange={(event) => {
          for (const file of event.target.files ?? []) onFile(file);
          if (input.current) input.current.value = "";
        }}
        className="sr-only"
      />
      <Icon aria-hidden size={18} />
      {label}
    </label>
  );
}

function VisualCard({
  item,
  onAdd,
  onOverlay,
  languages,
  onDelete,
}: {
  item: MediaItem;
  onAdd?: (item: MediaItem) => void;
  // A second way to add it: over the Clip.
  onOverlay?: (item: MediaItem) => void;
  // A video's language, which its captions are transcribed in.
  languages?: MediaLanguages;
  onDelete: () => void;
}) {
  return (
    <li className="group relative flex min-w-0 flex-col gap-1">
      <button
        type="button"
        {...draggable(item)}
        onClick={() => onAdd?.(item)}
        disabled={!onAdd}
        aria-label={onAdd ? `Add ${item.name}` : item.name}
        className="relative aspect-video overflow-hidden rounded-[10px] bg-black ring-1 ring-border hover:ring-accent/70 focus-visible:outline-2 focus-visible:outline-focus disabled:cursor-default disabled:hover:ring-border"
      >
        <img src={mediaThumbnailUrl(item.id)} alt="" className="size-full object-contain" loading="lazy" />
        <span className="absolute bottom-1 left-1 inline-flex items-center gap-1 rounded bg-black/70 px-1 text-[11px] text-white tabular-nums">
          {item.kind === "video" ? <Film aria-hidden size={11} /> : <ImagePlus aria-hidden size={11} />}
          {item.duration !== null ? formatPrecise(item.duration) : `${item.width}×${item.height}`}
        </span>
        {onAdd && (
          <span className="absolute top-1 left-1 inline-flex size-6 items-center justify-center rounded-full bg-accent text-on-accent opacity-0 group-hover:opacity-100 [@media(hover:none)]:opacity-100">
            <Plus aria-hidden size={14} />
          </span>
        )}
      </button>
      <span className="flex items-center justify-between gap-1">
        <span className="truncate text-xs text-muted" title={item.name}>
          {item.name}
        </span>
        {onOverlay && (
          <button
            type="button"
            onClick={() => onOverlay(item)}
            aria-label={`Add ${item.name} as an overlay`}
            title="Add as an overlay"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-full text-muted hover:bg-fill hover:text-text focus-visible:outline-2 focus-visible:outline-focus"
          >
            <Layers aria-hidden size={14} />
          </button>
        )}
      </span>
      {languages && <LanguageSelect item={item} languages={languages} />}
      <DeleteButton name={item.name} onClick={onDelete} />
    </li>
  );
}

/** A video's language for its captions, in every Job: "Job's language (xx)" first. */
function LanguageSelect({ item, languages }: { item: MediaItem; languages: MediaLanguages }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <span className="relative">
        <select
          value={item.language ?? ""}
          disabled={busy}
          aria-label={`Captions language of ${item.name}, in every Job`}
          title="Its captions' language, in every Job"
          onChange={(event) => {
            setBusy(true);
            setError(null);
            languages
              .set(item, event.target.value || null)
              .catch((reason: Error) => setError(reason.message))
              .finally(() => setBusy(false));
          }}
          className="min-h-8 w-full appearance-none truncate rounded-[8px] border border-border bg-fill py-1 pr-6 pl-2 text-xs enabled:cursor-pointer disabled:opacity-60"
        >
          {languageChoices(languages.job, item.language).map((choice) => (
            <option key={choice.value} value={choice.value}>
              {choice.label}
            </option>
          ))}
        </select>
        <ChevronDown aria-hidden size={12} className="pointer-events-none absolute top-1/2 right-2 -translate-y-1/2 text-muted" />
      </span>
      {error && <span className="text-xs text-danger">{error}</span>}
    </>
  );
}

// One song at a time plays from the Audio tab.
let playing: HTMLAudioElement | null = null;

function AudioRow({ item, onAdd, onDelete }: { item: MediaItem; onAdd?: (item: MediaItem) => void; onDelete: () => void }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [on, setOn] = useState(false);
  function toggle() {
    const element = audio.current;
    if (!element) return;
    if (element.paused) {
      if (playing && playing !== element) playing.pause();
      playing = element;
      void element.play();
    } else element.pause();
  }
  return (
    <li {...draggable(item)} className="group relative flex min-h-12 cursor-grab items-center gap-2 rounded-[10px] bg-fill px-2">
      <audio ref={audio} src={mediaItemUrl(item.id)} preload="none" onPlay={() => setOn(true)} onPause={() => setOn(false)} onEnded={() => setOn(false)} />
      <button
        type="button"
        onClick={toggle}
        aria-label={on ? `Pause ${item.name}` : `Play ${item.name}`}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-focus"
      >
        {on ? <Pause aria-hidden size={16} /> : <Play aria-hidden size={16} />}
      </button>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm" title={item.name}>
          {item.name}
        </span>
        <span className="text-xs text-muted tabular-nums">
          {formatPrecise(item.duration ?? 0)} · {formatBytes(item.size_bytes)}
        </span>
      </div>
      {onAdd && (
        <button
          type="button"
          onClick={() => onAdd(item)}
          aria-label={`Add ${item.name}`}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-accent-text hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-focus"
        >
          <Plus aria-hidden size={18} />
        </button>
      )}
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${item.name}`}
        className="inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-raised hover:text-danger focus-visible:outline-2 focus-visible:outline-focus"
      >
        <Trash2 aria-hidden size={15} />
      </button>
    </li>
  );
}

function DeleteButton({ name, onClick }: { name: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Delete ${name}`}
      title="Delete"
      className={cx(
        "glass absolute top-1 right-1 inline-flex size-7 items-center justify-center rounded-full text-muted hover:text-danger",
        "opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 motion-safe:transition-opacity",
      )}
    >
      <Trash2 aria-hidden size={13} />
    </button>
  );
}
