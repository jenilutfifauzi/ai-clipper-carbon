import { Copy, Music as MusicIcon, Trash2 } from "lucide-react";
import type { MediaItem, MusicClip } from "../../../api";
import { Button } from "../../../components/Button";
import { Slider } from "../../../components/Slider";
import { Group } from "../editor/StyleFields";
import { newId } from "./TextLayers";

export const MUSIC_MIN_SECS = 0.1;

/** A Music Clip of `item` at the playhead (`at`), as long as the song or what is left of the Clip. */
export function newMusicClip(item: MediaItem, at: number, duration: number): MusicClip {
  const length = item.duration ?? 0;
  let start = Math.max(0, Math.min(at, duration - MUSIC_MIN_SECS));
  // From the start, when the playhead is too near the end for much of it.
  if (duration - start < Math.min(length, 1)) start = 0;
  return { id: newId(), media: item.id, start: round(start), secs: round(Math.min(length, duration - start)), offset: 0, volume: 1, fade_in: 0, fade_out: 0 };
}

const round = (seconds: number) => Math.round(seconds * 100) / 100;
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
  const fades = Math.max(0, Math.min(10, clip.secs / 2));
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
      <Group title="Time">
        <Slider
          label="Starts in the song at"
          value={clip.offset}
          min={0}
          max={Math.max(0, length - clip.secs)}
          step={0.1}
          format={(v) => `${v.toFixed(1)} s`}
          onChange={(offset) => set("offset", offset)}
        />
        <Slider
          label="Comes in at"
          value={Math.min(clip.start, duration - MUSIC_MIN_SECS)}
          min={0}
          max={Math.max(MUSIC_MIN_SECS, duration - MUSIC_MIN_SECS)}
          step={0.05}
          format={(v) => `${v.toFixed(2)} s`}
          onChange={(start) => onChange({ ...clip, start, secs: Math.min(clip.secs, duration - start) }, `music:${clip.id}:start`)}
        />
        <Slider
          label="Plays for"
          value={Math.min(clip.secs, duration - clip.start, length - clip.offset)}
          min={MUSIC_MIN_SECS}
          max={Math.max(MUSIC_MIN_SECS, Math.min(duration - clip.start, length - clip.offset))}
          step={0.05}
          format={(v) => `${v.toFixed(2)} s`}
          onChange={(secs) => set("secs", secs)}
        />
      </Group>
    </div>
  );
}

/** The Clip's own sound, under its music. */
export function SourceSoundFields({ volume, onChange }: { volume: number; onChange: (volume: number) => void }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="font-semibold">Video</h2>
        <p className="text-sm text-pretty text-muted">The clip from the episode. Its framing and trim are changed in the clip editor.</p>
      </div>
      <Slider label="Original sound" value={volume} min={0} max={2} step={0.05} format={percent} onChange={onChange} />
    </div>
  );
}
