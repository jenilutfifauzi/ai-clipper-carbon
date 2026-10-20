import { Eye, Loader2, SquareSplitHorizontal, X } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent } from "react";
import { Button } from "../../../components/Button";
import { cx } from "../../../format";
import { CompareRender, holdHandlers, type CompareState, type FetchFrame } from "../editor/compareRender";
import { usePlayback, type Playback } from "../editor/playback";

// How far an arrow key moves the split line, as a fraction of the frame (with Shift, five times as far).
const SPLIT_STEP = 0.02;

/**
 * The Advanced Edit player's two checks of a Grade (.scratch/color-adjust/spec.md, "Preview"): the
 * before view's hold flag, and a Compare render of the draft (`key`, its JSON), cleared on any
 * playhead move or edit.
 */
export function usePlayerChecks(playback: Playback, key: string) {
  const [original, setOriginal] = useState(false);
  const [compare] = useState(() => new CompareRender(playback, key));
  useEffect(() => compare.watch(), [compare]);
  useEffect(() => compare.edited(key), [compare, key]);
  const state = useSyncExternalStore(compare.subscribe, () => compare.state);
  return { original, setOriginal, compare, state };
}

/** The before view's button: the preview drawn without any Grade while it is held. */
export function HoldOriginalButton({ held, onHold }: { held: boolean; onHold: (held: boolean) => void }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      aria-label="Hold to see the original"
      aria-pressed={held}
      title="Hold to see the original, without any Grade"
      className={cx("touch-none", held && "bg-fill text-text")}
      {...holdHandlers(onHold)}
    >
      <Eye aria-hidden size={18} />
    </Button>
  );
}

/**
 * Compare render's button: while paused, asks for the frame at the playhead (`fetch`); again, takes
 * it away. Off while playing; spinning while the frame is on its way.
 */
export function CompareButton({
  playback,
  compare,
  state,
  fetch,
}: {
  playback: Playback;
  compare: CompareRender;
  state: CompareState;
  fetch: FetchFrame;
}) {
  const playing = usePlayback(playback, (_, p) => p.playing);
  const on = state.kind !== "idle";
  return (
    <Button
      variant="ghost"
      size="icon"
      disabled={playing}
      aria-pressed={on}
      aria-label={on ? "Hide Compare render" : "Compare render"}
      title={playing ? "Compare render: pause first" : on ? "Hide Compare render" : "Compare render: the server's frame at the playhead"}
      className={cx(on && "bg-fill text-text")}
      onClick={() => (on ? compare.clear() : compare.request(fetch))}
    >
      {state.kind === "loading" ? <Loader2 aria-hidden size={18} className="animate-spin" /> : <SquareSplitHorizontal aria-hidden size={18} />}
    </Button>
  );
}

/**
 * Compare render over the stage (GLOSSARY): the server's frame right of a draggable split line, the
 * preview left of it; a note while it is on its way, and why it failed. Only the line and the notes
 * take the pointer: the stage under it stays live (and an edit there clears it).
 */
export function CompareSplit({ state, onClose }: { state: CompareState; onClose: () => void }) {
  const [split, setSplit] = useState(0.5);
  const room = useRef<HTMLDivElement>(null);
  if (state.kind === "idle") return null;
  if (state.kind !== "shown") {
    return (
      <div className="pointer-events-none absolute inset-x-0 top-3 flex justify-center">
        <div
          role={state.kind === "failed" ? "alert" : "status"}
          className="pointer-events-auto flex max-w-[90%] items-center gap-2 rounded-full bg-black/75 py-1 pr-1 pl-3 text-sm text-white"
        >
          {state.kind === "loading" ? (
            <>
              <Loader2 aria-hidden size={14} className="animate-spin" />
              <span className="pr-2">Rendering the frame…</span>
            </>
          ) : (
            <>
              <span className="truncate">Couldn't render the frame: {state.message}</span>
              <CloseButton onClose={onClose} />
            </>
          )}
        </div>
      </div>
    );
  }
  const to = (x: number) => {
    const box = room.current?.getBoundingClientRect();
    if (box && box.width > 0) setSplit(clamp((x - box.left) / box.width));
  };
  const drag = {
    onPointerDown: (event: PointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      event.currentTarget.setPointerCapture(event.pointerId);
      to(event.clientX);
    },
    onPointerMove: (event: PointerEvent<HTMLDivElement>) => {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) to(event.clientX);
    },
    onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => {
      const step = (event.shiftKey ? 5 : 1) * SPLIT_STEP;
      const next = { ArrowLeft: split - step, ArrowRight: split + step, Home: 0, End: 1 }[event.key];
      if (next === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      setSplit(clamp(next));
    },
  };
  const at = `${split * 100}%`;
  return (
    <div ref={room} className="pointer-events-none absolute inset-0" data-compare>
      <img
        src={state.url}
        alt="Compare render: the server's frame"
        className="absolute inset-0 size-full"
        style={{ clipPath: `inset(0 0 0 ${at})` }}
      />
      <Label side="left" text="Preview" />
      <Label side="right" text="Render" />
      <div
        role="slider"
        tabIndex={0}
        aria-label="Compare render split: the preview left of it, the render right"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(split * 100)}
        className="group pointer-events-auto absolute inset-y-0 w-6 -translate-x-1/2 cursor-ew-resize touch-none focus-visible:outline-none"
        style={{ left: at }}
        {...drag}
      >
        <div className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 bg-white shadow-[0_0_0_1px_rgb(0_0_0/0.4)] group-focus-visible:bg-focus" />
        <div className="absolute top-1/2 left-1/2 h-8 w-3 -translate-1/2 rounded-full bg-white shadow-raised group-focus-visible:outline-2 group-focus-visible:outline-focus" />
      </div>
      <div className="pointer-events-auto absolute top-2 right-2">
        <CloseButton onClose={onClose} />
      </div>
    </div>
  );
}

function Label({ side, text }: { side: "left" | "right"; text: string }) {
  return (
    <span className={cx("absolute bottom-2 rounded-full bg-black/60 px-2 py-0.5 text-xs text-white", side === "left" ? "left-2" : "right-2")}>
      {text}
    </span>
  );
}

function CloseButton({ onClose }: { onClose: () => void }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close Compare render"
      className="grid size-7 place-items-center rounded-full bg-black/60 text-white hover:bg-black/80 focus-visible:outline-2 focus-visible:outline-focus"
    >
      <X aria-hidden size={14} />
    </button>
  );
}

const clamp = (value: number) => Math.min(1, Math.max(0, value));
