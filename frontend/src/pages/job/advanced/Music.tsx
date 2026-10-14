import { Copy, Music as MusicIcon, Trash2 } from "lucide-react";
import type { MediaItem, MusicClip } from "../../../api";
import { Button } from "../../../components/Button";
import { Slider } from "../../../components/Slider";
import { Group } from "../editor/StyleFields";
import { ITEM_MIN_SECS, newId, round } from "./edits";
import { TimingFields } from "./TimingFields";

// The longest fade (fade_in and fade_out in backend/app/candidates.py); half the clip's at most.
const FADE_MAX_SECS = 10;

/** A Music Clip of `item` at `at` (the playhead, or where it was dropped), as long as the song or what is left of the Clip. */
export function newMusicClip(item: MediaItem, at: number, duration: number): MusicClip {
  const length = item.duration ?? 0;
  let start = Math.max(0, Math.min(at, duration - ITEM_MIN_SECS));
  // From the start, when the playhead is too near the end for much of it.
  if (duration - start < Math.min(length, 1)) start = 0;
  return { id: newId(), media: item.id, start: round(start), secs: round(Math.min(length, duration - start)), offset: 0, volume: 1, fade_in: 0, fade_out: 0 };
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** The selected Music Clip's volume, fades, part of its song and time. */
export function MusicFields({
  clip,
  item,
  duration,
  onChange,
  onDuplicate,
  onDelete,
}: {
  clip: MusicClip;
  // Its song; undefined while the library loads.
  item: MediaItem | undefined;
  duration: number;
  onChange: (clip: MusicClip, group: string) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  const set = <K extends keyof MusicClip>(field: K, value: MusicClip[K]) => onChange({ ...clip, [field]: value }, `music:${clip.id}:${field}`);
  const length = item?.duration ?? clip.offset + clip.secs;
  const fades = Math.max(0, Math.min(FADE_MAX_SECS, clip.secs / 2));
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
        <Slider label="Volume" value={clip.volume} min={0} max={2} step={0.05} format={percent} onChange={(volume) => set("volume", volume)} />
        <Slider label="Fade in" value={Math.min(clip.fade_in, fades)} min={0} max={fades} step={0.1} format={(v) => `${v.toFixed(1)} s`} onChange={(v) => set("fade_in", v)} />
        <Slider label="Fade out" value={Math.min(clip.fade_out, fades)} min={0} max={fades} step={0.1} format={(v) => `${v.toFixed(1)} s`} onChange={(v) => set("fade_out", v)} />
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
