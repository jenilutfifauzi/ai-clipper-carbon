import { Copy, Music as MusicIcon, Trash2 } from "lucide-react";
import type { MediaItem, MusicClip } from "../../../api";
import { Button } from "../../../components/Button";
import { Slider } from "../../../components/Slider";
import { valueAt } from "../editor/keyframes";
import type { Playback } from "../editor/playback";
import { Group } from "../editor/StyleFields";
import { FADE_MAX_SECS, ITEM_MIN_SECS, newId, round } from "./edits";
import { KeyCluster, useKeyTime } from "./KeyCluster";
import { keyTime } from "./keying";
import { TimingFields } from "./TimingFields";

/** A Music Clip of `item` at `at` (the playhead, or where it was dropped), as long as the song or what is left of the Clip. */
export function newMusicClip(item: MediaItem, at: number, duration: number): MusicClip {
  const length = item.duration ?? 0;
  let start = Math.max(0, Math.min(at, duration - ITEM_MIN_SECS));
  // From the start, when the playhead is too near the end for much of it.
  if (duration - start < Math.min(length, 1)) start = 0;
  return { id: newId(), media: item.id, start: round(start), secs: round(Math.min(length, duration - start)), offset: 0, volume: 1, fade_in: 0, fade_out: 0, keys: {} };
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/**
 * The selected Music Clip's volume, fades, part of its song and time. Its volume is shown at the
 * playhead, and keyed there (`onVolume` writes a Keyframe once it has some), with its ‹ ◆ ›.
 */
export function MusicFields({
  clip,
  item,
  duration,
  playback,
  onChange,
  onVolume,
  onFade,
  onDuplicate,
  onDelete,
}: {
  clip: MusicClip;
  // Its song; undefined while the library loads.
  item: MediaItem | undefined;
  duration: number;
  playback: Playback;
  onChange: (clip: MusicClip, group: string) => void;
  onVolume: (volume: number, group: string) => void;
  // A fade set, as its Fade Ramp's handle sets it.
  onFade: (fade: "fade_in" | "fade_out", secs: number, group: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const length = item?.duration ?? clip.offset + clip.secs;
  // Each fade as long as 10 s, or as what the other leaves of the clip.
  const most = (other: number) => Math.max(0, Math.min(FADE_MAX_SECS, clip.secs - other));
  const fade = (field: "fade_in" | "fade_out") => (secs: number) => onFade(field, secs, `music:${clip.id}:${field}`);
  const time = useKeyTime(playback);
  const at = keyTime(clip, time);
  const keys = clip.keys.volume ?? [];
  const volume = valueAt(keys, at ?? Math.min(Math.max(time - clip.start, 0), clip.secs), clip.volume);
  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex min-w-0 items-center gap-2 font-semibold">
          <MusicIcon aria-hidden size={17} className="shrink-0 text-muted" />
          <span className="truncate">{item?.name ?? "Music"}</span>
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
      <Group title="Sound">
        <Slider
          label="Volume"
          value={volume}
          min={0}
          max={2}
          step={0.05}
          format={percent}
          onChange={(volume) => onVolume(volume, `music:${clip.id}:volume`)}
          after={<KeyCluster item={{ kind: "music", id: clip.id }} property="volume" label="Volume" />}
          disabled={!!keys.length && at === null}
        />
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
      </Group>
      <TimingFields
        item={clip}
        duration={duration}
        length={length}
        labels={{ start: "Comes in at", secs: "Plays for", offset: "Starts in the song at" }}
        onChange={onChange}
      />
    </div>
  );
}
