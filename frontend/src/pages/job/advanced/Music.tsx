import { Copy, Link2, Music as MusicIcon, Trash2 } from "lucide-react";
import type { MediaItem, MusicClip } from "../../../api";
import { Button } from "../../../components/Button";
import { formatPrecise } from "../../../format";
import { Slider } from "../../../components/Slider";
import { Switch } from "../../../components/Switch";
import type { Playback } from "../editor/playback";
import type { RetimedAsk } from "../editor/retimedCopy";
import { Group } from "../editor/StyleFields";
import { DEFAULT_DUCK, DUCK_MAX, DUCK_MIN, FADE_MAX_SECS, ITEM_MIN_SECS, newId, round } from "./edits";
import { KeyedVolume, MutedSwitch } from "./KeyCluster";
import { SpeedFields } from "./SpeedFields";
import { TimingFields } from "./TimingFields";

/**
 * A Music Clip of `item` at `at` (the playhead, or where it was dropped), as long as the song or what
 * is left of the Clip, Ducked under speech at DEFAULT_DUCK (said so, rather than left to the server's
 * default for a new song, ADR 0016).
 */
export function newMusicClip(item: MediaItem, at: number, duration: number): MusicClip {
  const length = item.duration ?? 0;
  let start = Math.max(0, Math.min(at, duration - ITEM_MIN_SECS));
  // From the start, when the playhead is too near the end for much of it.
  if (duration - start < Math.min(length, 1)) start = 0;
  return { id: newId(), media: item.id, start: round(start), secs: round(Math.min(length, duration - start)), offset: 0, volume: 1, fade_in: 0, fade_out: 0, keys: {}, duck: DEFAULT_DUCK };
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** What a Music Clip is called: a song's (or video's) name, or the episode's sound for a Music Clip of the Source. */
export const musicName = (clip: MusicClip, item: MediaItem | undefined) => (clip.media === null ? "The episode's sound" : (item?.name ?? "Music"));

/**
 * The selected Music Clip's volume, Muted, fades, Duck under speech and its depth (none for the
 * Source's sound, which is never Ducked), Speed (the Overlay's fields), part of its song (or,
 * of the Source's sound, the time in the episode it plays from) and time. Its volume is shown at the
 * playhead, and keyed there (`onVolume` writes a Keyframe once it has some), with its ‹ ◆ ›.
 */
export function MusicFields({
  clip,
  item,
  sourceLength,
  duration,
  playback,
  copy,
  onChange,
  onVolume,
  onFade,
  onSpeed,
  onReverse,
  onDuck,
  onDuplicate,
  onDelete,
  detached,
}: {
  clip: MusicClip;
  // Its song; undefined while the library loads, and for the Source's sound.
  item: MediaItem | undefined;
  // The Source's, which a Music Clip of the Source reads.
  sourceLength: number;
  duration: number;
  playback: Playback;
  // The Retimed copy the preview plays it from, if any.
  copy: RetimedAsk | null;
  onChange: (clip: MusicClip, group: string) => void;
  onVolume: (volume: number, group: string) => void;
  // A fade set, as its Fade Ramp's handle sets it.
  onFade: (fade: "fade_in" | "fade_out", secs: number, group: string) => void;
  // Its Speed set (actions.ts' setSpeed), a change of `group`.
  onSpeed: (speed: number, group: string) => void;
  // Its Reverse turned on or off (actions.ts' setReverse).
  onReverse: (reverse: boolean) => void;
  // Its Duck under speech set (actions.ts' setDuck): off with null, else a depth in dB.
  onDuck: (duck: number | null, group?: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
  // A Detached sound's Segment (its `index` on the Main Track), while it is there to Reattach it to.
  detached?: { index: number; onReattach: () => void };
}) {
  const episode = clip.media === null;
  const length = episode ? sourceLength : (item?.duration ?? clip.offset + clip.secs);
  // Each fade as long as 10 s, or as what the other leaves of the clip.
  const most = (other: number) => Math.max(0, Math.min(FADE_MAX_SECS, clip.secs - other));
  const fade = (field: "fade_in" | "fade_out") => (secs: number) => onFade(field, secs, `music:${clip.id}:${field}`);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 font-semibold">
          <MusicIcon aria-hidden size={17} className="shrink-0 text-muted" />
          <span className="truncate">{musicName(clip, item)}</span>
        </h2>
        <div className="flex gap-1">
          <Button variant="ghost" size="icon" onClick={onDuplicate} aria-label="Duplicate music">
            <Copy aria-hidden size={17} />
          </Button>
          <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete music">
            <Trash2 aria-hidden size={17} />
          </Button>
        </div>
      </div>
      {detached && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted">Detached from Segment {detached.index + 1}</p>
          <Button size="sm" className="in-data-sheet:min-h-11" onClick={detached.onReattach} title="Delete every Music Clip Detached from that Segment, and unmute it">
            <Link2 aria-hidden size={16} />
            Reattach
          </Button>
        </div>
      )}
      <Group title="Sound">
        <KeyedVolume
          item={{ kind: "music", id: clip.id }}
          span={clip}
          keys={clip.keys.volume ?? []}
          volume={clip.volume}
          label="Volume"
          format={percent}
          playback={playback}
          onChange={(volume) => onVolume(volume, `music:${clip.id}:volume`)}
        />
        <MutedSwitch muted={clip.muted ?? false} onChange={(muted) => onChange({ ...clip, muted }, `music:${clip.id}:muted`)} />
        <Slider
          label="Fade in"
          value={Math.min(clip.fade_in, most(clip.fade_out))}
          min={0}
          max={most(clip.fade_out)}
          step={0.1}
          format={(v) => `${v.toFixed(1)} s`}
          onChange={fade("fade_in")}
        />
        <Slider
          label="Fade out"
          value={Math.min(clip.fade_out, most(clip.fade_in))}
          min={0}
          max={most(clip.fade_in)}
          step={0.1}
          format={(v) => `${v.toFixed(1)} s`}
          onChange={fade("fade_out")}
        />
        {!episode && <DuckFields duck={clip.duck ?? null} group={`music:${clip.id}:duck`} onDuck={onDuck} />}
      </Group>
      <SpeedFields
        speed={clip.speed ?? 1}
        pitch={clip.pitch ?? false}
        reverse={clip.reverse ?? false}
        heard
        group={`music:${clip.id}:speed`}
        copy={copy}
        what={episode ? "sound" : item?.kind === "video" ? "video" : "song"}
        onSpeed={onSpeed}
        onPitch={(pitch) => onChange({ ...clip, pitch }, `music:${clip.id}:pitch`)}
        onReverse={onReverse}
      />
      <TimingFields
        item={clip}
        duration={duration}
        length={length}
        labels={{ start: "Comes in at", secs: "Plays for", offset: `${clip.reverse ? "Ends" : "Starts"} in the ${episode ? "episode" : "song"} at` }}
        // A time in the episode reads as the Transcript's do.
        offsetFormat={episode ? formatPrecise : undefined}
        onChange={onChange}
      />
    </div>
  );
}

/**
 * A Music Clip's Duck under speech (GLOSSARY.md, Ducking): a switch, each turn of it one step of undo,
 * on at DEFAULT_DUCK; while on, its depth from DUCK_MIN to DUCK_MAX dB, a change of `group`.
 */
function DuckFields({ duck, group, onDuck }: { duck: number | null; group: string; onDuck: (duck: number | null, group?: string) => void }) {
  return (
    <>
      <Switch checked={duck !== null} onChange={(on) => onDuck(on ? DEFAULT_DUCK : null)}>
        <span className="text-sm font-medium">Duck under speech</span>
      </Switch>
      {duck !== null && (
        <Slider label="Depth" value={duck} min={DUCK_MIN} max={DUCK_MAX} step={1} format={(v) => `${v} dB`} onChange={(depth) => onDuck(depth, group)} />
      )}
    </>
  );
}
