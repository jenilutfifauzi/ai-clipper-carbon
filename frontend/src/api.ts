// The backend's HTTP API (backend/app/api.py), as the frontend uses it.

export type JobStatus =
  | "queued"
  | "downloading"
  | "transcribing"
  | "analyzing"
  | "review"
  // In review, with Clips queued or being rendered.
  | "rendering"
  | "waiting_quota"
  | "error";

export interface JobOptions {
  language: string;
  min_secs: number;
  max_secs: number;
  captions: boolean;
  brief: string | null;
  transcribe_locally: boolean;
}

export interface JobWarning {
  stage: JobStatus;
  message: string;
}

export interface QuotaWait {
  since: string;
  errors: number;
  retry_at: string;
  scored: number;
}

export interface SourceMetadata {
  duration: number;
  fps: number;
  width: number;
  height: number;
  codec: string;
}

export interface Source {
  video: string;
  caption_track: string | null;
  metadata: SourceMetadata;
  // A copy the browser can play, for previews, when it can't play `video` (an HEVC or ProRes master).
  preview: string | null;
}

// The master file the owner uploaded for a Job, in place of a URL.
export interface Upload {
  // Its name on the owner's machine, and its size in bytes.
  name: string;
  size: number;
  // The stored file, in the Job's directory.
  file: string;
}

export interface Job {
  id: string;
  // Empty for an uploaded master file.
  url: string;
  options: JobOptions;
  created_at: string;
  updated_at: string;
  status: JobStatus;
  // The stage running now, or the one the Job stopped in (error, waiting_quota).
  stage: JobStatus | null;
  error: string | null;
  progress: number | null;
  message: string | null;
  warnings: JobWarning[];
  quota: QuotaWait | null;
  upload: Upload | null;
  source: Source | null;
  prompt_version: string | null;
  history: { status: JobStatus; at: string }[];
  // Candidates queued to be prepared for the clip editor.
  preparing: string[];
}

export interface Word {
  text: string;
  start: number;
  end: number;
}

// A line of the Transcript, for display.
export interface Segment {
  text: string;
  start: number;
  end: number;
}

export interface Transcript {
  language: string;
  source: "youtube" | "whisper";
  words: Word[];
  segments: Segment[];
}

// Auto chooses per Scene by its faces (never Manual); Manual frames the Source by hand with a Framing.
export type Layout = "auto" | "track" | "split" | "blur" | "manual";

// The Layout of the one Scene that holds `at` (seconds on the Source's timeline), in place of the
// Candidate's there. Auto chooses that Scene's by its faces. A Manual one has its Framing, and no
// other has one.
export interface LayoutOverride {
  at: number;
  layout: Layout;
  framing?: Framing | null;
  // A Manual one's Keyframes (ADR 0008): its Framing's Transform moved, each `at` in seconds from its
  // Scene's start on the Source's timeline (the plan's `ScenePlan.keys_from`).
  keys?: Keys;
}

// The owner's correction of one caption Word, keyed by a time on the Source's timeline, or with
// `media` on that Media Library item's (the Word whose span holds it, of that timeline's Words).
// `text` replaces the Word's (null keeps it; "" removes the Word).
export interface WordEdit {
  at: number;
  text: string | null;
  break_before: boolean;
  media?: string | null;
}

// The owner's change to one Cue (GLOSSARY: Cue Edit), keyed as a Word Edit is: a time in its first
// Word on the Source's timeline (with `media`, on that Media Library item's). That Word starts a Cue.
// `shift` moves the Cue and its highlight, `start_delta` and `end_delta` one edge (negative: earlier),
// in seconds of that timeline (so they scale with Speed), each within ±CUE_SHIFT_MAX_SECS. With
// `join` (and every other field left 0), instead of starting a Cue its Word's Cue is kept with the
// one before, where only a pause, a sentence's end or the longest-Cue limit would part them.
export interface CueEdit {
  at: number;
  media: string | null;
  shift: number;
  start_delta: number;
  end_delta: number;
  // Its own place, the middle of its lines in output pixels (as the Caption Style's custom position,
  // kept in the frame), and its size, times the Caption Style's; null or missing: the style's.
  x?: number | null;
  y?: number | null;
  scale?: number | null;
  join: boolean;
}

// The furthest a Cue Edit moves its Cue or an edge (CUE_SHIFT_MAX_SECS in backend/app/candidates.py).
export const CUE_SHIFT_MAX_SECS = 10;
// The least and the most a Cue Edit scales its Cue (CUE_MIN_SCALE, CUE_MAX_SCALE in backend/app/candidates.py).
export const CUE_MIN_SCALE = 0.25;
export const CUE_MAX_SCALE = 4;

export type Highlight = "colour" | "box" | "none";
export type CaptionPosition = "auto" | "top" | "middle" | "bottom" | "custom";
export type HookPosition = "top" | "middle" | "bottom" | "custom";
// How the hook comes on or goes off: at once, fading, popping from 70%, or sliding 60 px up.
export type Animation = "none" | "fade" | "pop" | "slide";

// How captions look and are broken into lines (backend/app/styles.py). Sizes are libass's, which
// sets a font so that its Windows ascent plus descent is the size (see FontInfo).
export interface CaptionStyle {
  font: string;
  size: number;
  colour: string;
  active_colour: string;
  outline: number;
  outline_colour: string;
  // Under the text and its outline, as a Text Layer's.
  shadow: DropShadow;
  // Added after every character of a line but its last, in output pixels; may be negative.
  tracking: number;
  uppercase: boolean;
  highlight: Highlight;
  // The highlight box's padding across and down and its corners' radius, in output pixels at the
  // style's size (smaller on a line set smaller); null: 0.12, 0.08 and 0.12 of the line's size.
  padding_x: number | null;
  padding_y: number | null;
  radius: number | null;
  position: CaptionPosition;
  // The line's centre, for the custom position.
  y: number;
  // Each line's centre, at any position (the backend keeps the line in the frame); null: centred.
  x: number | null;
  // A Cue holds at most max_lines lines (1 to 3), each of at most max_chars characters and max_words
  // Words, its lines balanced; it lasts at most max_secs and ends after a pause of pause_secs.
  max_lines: number;
  max_chars: number;
  max_words: number | null;
  max_secs: number;
  pause_secs: number;
}

// One box behind all the lines, a strip behind each, or none.
export type HookShape = "block" | "strips" | "none";
export type HookAlign = "center" | "left";

export interface HookStyle {
  shape: HookShape;
  font: string;
  size: number;
  // 1 to 4: the hook is set smaller only when even this many lines are too wide.
  max_lines: number;
  uppercase: boolean;
  align: HookAlign;
  // Added after every character of a line but its last, in output pixels; may be negative. Not the Kicker's.
  tracking: number;
  // How far apart its lines' baselines are, in sizes.
  line_height: number;
  colour: string;
  // Of the words marked *like this*.
  emphasis_colour: string;
  // Around and under the text, in output pixels; the box has neither.
  outline: number;
  outline_colour: string;
  shadow: DropShadow;
  box_colour: string;
  box_opacity: number;
  // The box's corners, and its padding across and down, in output pixels (the padding at the style's
  // size, smaller with a hook set smaller); null: the Shape's own (backend/app/planner.py's _hook_padding).
  radius: number;
  padding_x: number | null;
  padding_y: number | null;
  // A badge with quote marks on the corner of the first line's box.
  quote: boolean;
  quote_colour: string;
  // The Kicker's text, and its pill.
  kicker_colour: string;
  kicker_box_colour: string;
  position: HookPosition;
  // The box's top, for the custom position.
  y: number;
  // Its middle, at any position (the backend keeps it in the frame); null: its lines centred.
  x: number | null;
  animation_in: Animation;
  animation_out: Animation;
  animation_ms: number;
}

// Nothing, a line of text, or one of the Logos.
export type WatermarkKind = "none" | "text" | "logo";
// A corner, an edge's middle or the middle of the safe area; or custom, centred on (x, y).
export type WatermarkPosition =
  | "top_left"
  | "top"
  | "top_right"
  | "left"
  | "middle"
  | "right"
  | "bottom_left"
  | "bottom"
  | "bottom_right"
  | "custom";

// Shown over the whole Clip, under the captions and the hook.
export interface WatermarkStyle {
  kind: WatermarkKind;
  text: string;
  font: string;
  colour: string;
  // A thin black outline around the text.
  outline: boolean;
  // The Logo's id.
  logo: string | null;
  position: WatermarkPosition;
  // Its centre in output pixels, for the custom position.
  x: number;
  y: number;
  // How tall it is: the Logo's height, or the text's font size (libass's).
  size: number;
  opacity: number;
}

// An uploaded image a Watermark can show, kept as a PNG of this size.
export interface Logo {
  id: string;
  name: string;
  width: number;
  height: number;
  created: string;
}

export type MediaKind = "video" | "audio" | "image";

// A video, song or image in the Media Library (backend/app/media.py), normalized: its length (null
// for an image) and picture size (null for audio).
export interface MediaItem {
  id: string;
  kind: MediaKind;
  name: string;
  size_bytes: number;
  duration: number | null;
  width: number | null;
  height: number | null;
  has_audio: boolean;
  created: string;
  // A video's Media Words are transcribed in this language in every Job; null: each Job's.
  language?: string | null;
}

// A video's Media Words for a Job (backend/app/api.py's MediaWordsView): in its language (its own,
// else the Job's), their status, the error of a failure, and the Words when ready. (Their status is
// the item's, not a Segment's WordsStatus: a Segment of the video is "media" while they are "ready".)
export interface MediaWords {
  media_id: string;
  language: string;
  status: "ready" | "pending" | "failed" | "none";
  error: string | null;
  words: Word[] | null;
}

// A Candidate that uses a Media Library item, as a refused delete names it.
export interface MediaUse {
  job_id: string;
  candidate_id: string;
  title: string;
}

export interface StylePreset {
  id: string;
  name: string;
  caption: CaptionStyle;
  hook: HookStyle;
  watermark: WatermarkStyle;
  // Built-in Presets can't be changed or deleted.
  builtin: boolean;
  // What each new join of its Candidates gets (pages/job/editor/joinTransition.ts); null for none, as
  // on the built-in ones. Copied, never linked.
  join_transition: JoinTransition | null;
}

// A Text Preset (GLOSSARY): a named Text Style a new Text Layer copies, never linked to it.
export interface TextPreset {
  id: string;
  name: string;
  style: TextStyle;
  // The words it is shown in on its shelf, which a Text Layer made from it starts with.
  sample: string;
  // Its shelf in the Text tab: "Mine" for the owner's, a built-in one's kind otherwise.
  category: string;
  // A built-in one's place among them.
  order: number;
  // Built-in Presets can't be changed, renamed or deleted.
  builtin: boolean;
  // The one used for new titles.
  default: boolean;
}

// Or, for a field that is a value of several fields (a shadow), those of it to replace.
export type StyleValue = string | number | boolean | null | Partial<DropShadow>;

// The fields of the Preset's styles a Candidate replaces.
export interface StyleOverrides {
  caption: Partial<Record<keyof CaptionStyle, StyleValue>>;
  hook: Partial<Record<keyof HookStyle, StyleValue>>;
  watermark: Partial<Record<keyof WatermarkStyle, StyleValue>>;
}

// The Render Plan (backend/app/planner.py), in output pixels (1080x1920) and seconds into the Clip.
export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CropPoint {
  at: number;
  x: number;
  y: number;
}

export interface Panel {
  area: Box;
  // The crop's size in Source pixels; `path` holds where it is from each change point on.
  crop_width: number;
  crop_height: number;
  path: CropPoint[];
  blur: boolean;
}

// "media": a Media Library video placed by its Framing; "manual": the Source placed by one by hand.
export type SceneLayout = "track" | "split" | "blur" | "passthrough" | "media" | "manual";

export interface ScenePlan {
  start: number;
  end: number;
  layout: SceneLayout;
  // Laid over one another. Under a picture, its Background's: one blurred cover, or none for a colour.
  panels: Panel[];
  // A media Segment's or a Manual Scene's: its one picture, over its panels, or over `colour` without any.
  picture: Picture | null;
  colour: string | null;
  // The Framing that draws its first frame (a Manual Scene's own): what a switch to Manual copies.
  framing: Framing | null;
  // A Manual Scene of a Layout Override's: where (Timeline time) its Keyframes count from, before the
  // Scene when it shows its shot from part way in; and those past its shot's end, never reached.
  keys_from?: number | null;
  ignored?: Keys;
}

// What a Cue is known by (and a Cue Edit keys it by): the middle of its first Word on that Word's
// timeline, seconds into the Source (or, with `media`, into that Media Library item).
export interface CueKey {
  at: number;
  media: string | null;
}

// Captions shown at once (GLOSSARY: Cue). One moved at a Layout change is one of these in each place, keyed alike.
export interface Cue {
  start: number;
  end: number;
  // One under another; their Words, as captions show them, each highlighted from its start to its end.
  lines: Word[][];
  // Each line as its Words are written, with the Word Edits (not in the Caption Style's case, nor stripped).
  plain: string[];
  area: Box;
  size: number;
  key: CueKey;
  // A Cue Edit applies to it.
  edited: boolean;
  // Merged into the Cue before, it would still fit the line limits.
  joinable: boolean;
  // A pause, a sentence's end or the longest-Cue limit parts it from the Cue before: merging takes a join.
  needs_join: boolean;
  // Where a Cue Edit keeps it (seconds into the Clip: its Segment, the Cue before's end, what the Cue
  // after leaves it), and its Segment's Speed, which a Cue Edit's seconds are divided by.
  low: number;
  high: number;
  speed: number;
  // Each of its Words' middle on its timeline (the first's is `key.at`), and the `at`, as sent, of
  // the Cue Edit matched to each: the first's starts it, another's is a join keeping it in.
  word_ats: number[];
  cue_edit_ats: (number | null)[];
}

export interface HookEvent {
  lines: string[];
  start: number;
  end: number;
  // Holds all of the hook.
  area: Box;
  size: number;
  // Each line's anchor: the middle of its text and its baseline.
  anchors: [number, number][];
  // Drawn behind the lines in the box colour: one block, a strip per line, or none.
  boxes: Box[];
  // Each line's emphasised runs, as [start, end) ranges of its characters.
  emphasis: [number, number][][];
  // Above the lines; null without one.
  kicker: HookKicker | null;
  // The Quote Mark's badge; null without one.
  quote: Box | null;
}

// The Kicker's text at font `size` on its pill, placed by its anchor (the middle of its text and its baseline).
export interface HookKicker {
  text: string;
  size: number;
  box: Box;
  anchor: [number, number];
}

// The Watermark in `area` for the whole Clip: the text at font `size`, centred in it, or the Logo filling it.
export interface WatermarkEvent {
  kind: WatermarkKind;
  area: Box;
  opacity: number;
  text: string;
  size: number;
  logo: string | null;
}

export type TextAlign = "center" | "left" | "right";

// What is drawn behind a Text Style's words (backend/app/candidates.py): nothing, a Block behind all
// its lines, or Strips, one behind each line, in `colour` at `opacity`, its corners `radius` round
// (at most half its height), reaching `padding_x` either side of the widest line (of each, for
// Strips) and `padding_y` above the capitals and below the descenders. Lengths in output pixels, at
// the style's size.
export interface Plate {
  shape: HookShape;
  colour: string;
  opacity: number;
  radius: number;
  padding_x: number;
  padding_y: number;
}

// A drop shadow under text (backend/app/styles.py): its letters and stroke again in `colour` at
// `opacity`, moved `distance` px towards `angle` degrees clockwise from the right (45: down and to
// the right) and blurred `blur` px (a CSS shadow's blur radius). Off at opacity 0, or with neither
// distance nor blur.
export interface DropShadow {
  colour: string;
  opacity: number;
  blur: number;
  distance: number;
  angle: number;
}

// How a Text Layer's words look (backend/app/candidates.py): its Face at `size` (libass's, as the
// captions') in `colour`, stroked `stroke_width` px (none at 0), with its shadow, over its plate (a
// Block, or Strips: one per line); its baselines `line_height` sizes apart, `tracking` px after
// each character but a line's last. Its box's least size, plate and padding and all: its words
// break into lines at `wrap_width` (0: the frame less a margin) and are centred down `fixed_height`
// (0: their own height); never set smaller.
export interface TextStyle {
  font: string;
  size: number;
  colour: string;
  stroke_width: number;
  stroke_colour: string;
  shadow: DropShadow;
  plate: Plate;
  line_height: number;
  tracking: number;
  align: TextAlign;
  wrap_width: number;
  fixed_height: number;
}

// A free text overlay of the Advanced Edit (backend/app/candidates.py): its text (lines split at
// newlines) from `start` for `secs` in Timeline time, centred by its Transform (never stretched nor
// flipped) in its Text Style. Its `keys` move its centre, scale, rotation and opacity as an
// Overlay's do (ADR 0008), its animations stacked on them.
export interface TextLayer {
  id: string;
  text: string;
  start: number;
  secs: number;
  transform: Transform;
  style: TextStyle;
  animation_in: Animation;
  animation_out: Animation;
  animation_ms: number;
  keys: Keys;
}

// The figure a Shape draws (backend/app/candidates.py's ShapeKind, docs/adr/0011): a filled figure
// (the triangle point up, the parallelogram leaning right, the trapezoid narrower at the top), or a
// line or an arrow (its head at the right), all stroke.
export type ShapeKind = "rectangle" | "ellipse" | "triangle" | "parallelogram" | "trapezoid" | "line" | "arrow";

// How a Shape looks (backend/app/candidates.py): its figure `kind`, `width` x `height` output
// pixels before its Transform's scale (whole pixels, 2 to 4096), filled with `fill` (null: none),
// with a stroke `stroke_width` px thick (none at 0) drawn inside its width and height, its corners
// rounded `radius` times its shorter side (a rectangle's; 0.5 makes a pill) and a drop shadow as a
// Text Layer's. A fill or a stroke it has, or it is refused. Never stretched: a wider Shape is a new
// width, drawn again, its stroke and corners keeping their size. A line and an arrow are all stroke:
// `width` is their length, `stroke_width` their thickness (never 0) and `stroke_colour` their
// colour; their height and fill are kept but not used.
export interface ShapeStyle {
  kind: ShapeKind;
  width: number;
  height: number;
  fill: string | null;
  stroke_colour: string;
  stroke_width: number;
  radius: number;
  shadow: DropShadow;
}

// A figure of the Advanced Edit (backend/app/candidates.py): drawn in its Shape Style from `start`
// for `secs` in Timeline time, centred by its Transform (never stretched nor flipped), coming on and
// going off as a Text Layer does, its `keys` moving it as a Text Layer's do.
export interface Shape {
  id: string;
  start: number;
  secs: number;
  transform: Transform;
  style: ShapeStyle;
  animation_in: Animation;
  animation_out: Animation;
  animation_ms: number;
  keys: Keys;
}

// What a picture layer draws (a Text Layer, a Shape): its id, its Transform and Keyframes, and its
// in/out animations.
export interface PictureLayerItem {
  id: string;
  transform: Transform;
  animation_in: Animation;
  animation_out: Animation;
  animation_ms: number;
  keys: Keys;
}

// A picture layer as drawn (backend/app/planner.py's PictureLayer): its item `layer`, on screen from
// `start` to `end`, drawn as the picture the backend made of it (docs/adr/0010), the file `image`
// (layerPictureUrl), placed as `picture` says. `area` is what its Grips hold, and `bounds` that area
// once turned and scaled. `picture_key` names what its picture shows at any scale: its pictures of
// one key differ only in size.
export interface PictureLayerEvent<Item extends PictureLayerItem = PictureLayerItem> {
  layer: Item;
  start: number;
  end: number;
  area: Box;
  image: string;
  picture: Picture;
  bounds: Box;
  picture_key: string;
}

// A Text Layer as drawn, a picture layer: its lines at its style's size, each placed by its anchor
// (the middle of its text and its baseline), in `area`; `box` is the area when it has a Block plate.
export interface TextEvent extends PictureLayerEvent<TextLayer> {
  lines: string[];
  anchors: [number, number][];
  box: Box | null;
}

// A Shape as drawn, a picture layer: `area` is its figure's box, its Shape Style's width and height
// about its Transform's centre; its picture holds that and a little room round it.
export type ShapeEvent = PictureLayerEvent<Shape>;

// A song (or a video's sound) from the Media Library under the Clip, or with `media` null the Source's
// sound (scaled by the Clip's `source_volume`, `offset` then a time on the Source's timeline): heard
// from `start` for `secs` in Timeline time, playing `secs` × speed of its file from `offset` seconds
// into it (ADR 0016; in Reverse, backwards, as a video Overlay's sound), at `volume` (0 to 2), faded
// in and out. Its `keys` shape its volume over its length (ADR 0008), in place of `volume`; the fades
// multiply them.
// Muted (ADR 0016), it is silent and keeps them. With `duck`, a depth in dB (-30 to -1), it is
// turned down that far while speech is heard (ADR 0016); a Music Clip of the Source has none. Marked
// `speech` (ADR 0018), a song's or a video's is itself speech over its whole span, and has no `duck`.
export interface MusicClip extends Omit<Retiming, "hold"> {
  id: string;
  media: string | null;
  start: number;
  secs: number;
  offset: number;
  volume: number;
  fade_in: number;
  fade_out: number;
  keys: Keys;
  muted?: boolean;
  duck?: number | null;
  // Left out, false: stored Music Clips aren't Speech.
  speech?: boolean;
  // The Segment whose sound was Detached onto it (ADR 0016), which Reattach finds it by.
  detached_from?: string | null;
  // Its sound's Audio Effects (ADR 0017), in order, after its Speed and before its volume, duck and
  // fades. Empty when missing.
  audio_effects?: AudioEffect[];
}

// How an item plays its range (docs/adr/0009): at its Speed (1 by default), its sound's pitch
// following the Speed with `pitch`, backwards from a Retimed copy with `reverse`; or, a Freeze
// frame's, its first frame held for `hold` seconds. Left out, they are 1, false, false and null.
export interface Retiming {
  speed?: number;
  pitch?: boolean;
  reverse?: boolean;
  hold?: number | null;
}

// A Music Clip (or an Overlay video's sound, `id` its item's) as heard, cut where the Clip or its
// song ends. A keyed one's `gain` is its volume Keyframes in seconds from its `start`, in place of
// `volume`; its fades multiply them. It plays (end − start) × speed of its item: with `source`, of
// the Source (`media` null), at the Clip's `source_volume` too. A Muted one (ADR 0016) isn't heard.
// A ducked one (`duck` dB) is turned down under the spans of speech that reach it (`speech_spans`),
// in seconds into the Clip, by the plan's `ducking` (ADR 0016).
export interface AudioEvent extends Omit<Retiming, "hold"> {
  media: string | null;
  source?: boolean;
  start: number;
  end: number;
  offset: number;
  volume: number;
  fade_in: number;
  fade_out: number;
  gain: Keyframe[];
  id: string;
  muted?: boolean;
  duck?: number | null;
  speech_spans?: [number, number][];
  // Where a ducked one is turned down, ramps included, within it (the planner's ducked_stretches).
  ducked?: [number, number][];
  // A Music Clip's marked Speech (ADR 0018), as MusicClip.speech: its whole span is speech where it
  // isn't Muted.
  speech?: boolean;
  detached_from?: string | null;
  // Its item's enabled Audio Effects (ADR 0017), in order.
  audio_effects?: AudioEffect[];
}

// How a ducked sound follows speech (ADR 0016): down over `lead_secs` before a span, up over
// `release_secs` after it; spans less than `bridge_secs` apart are one.
export interface Ducking {
  lead_secs: number;
  release_secs: number;
  bridge_secs: number;
}

// Where and how a picture sits on the 1080x1920 frame (backend/app/candidates.py, ADR 0007): its
// centre (x, y) in output pixels, on the frame; `scale` times its fitted size (the largest that fits
// the frame keeping its aspect: 1 fits, 0.05 to 8); `stretch_x` and `stretch_y` on top of that (0.1
// to 10); `rotation` in degrees clockwise (-360 to 360); its flips and its opacity.
export interface Transform {
  x: number;
  y: number;
  scale: number;
  stretch_x: number;
  stretch_y: number;
  rotation: number;
  flip_h: boolean;
  flip_v: boolean;
  opacity: number;
}

// What is cut off each edge of a picture before it is fitted (backend/app/candidates.py), as
// fractions of its width and height: each 0 to 0.9, a pair leaving a tenth at least (tidyCrop).
export interface Crop {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

// What shows where a Framing's picture doesn't cover the frame (backend/app/candidates.py): the
// picture itself blurred, or `colour` (#RRGGBB).
export interface Background {
  kind: "blur" | "colour";
  colour: string;
}

// How a picture fills the frame on its own (ADR 0007): a media Segment's video cut by its Crop and
// placed by its Transform, over its Background.
export interface Framing {
  transform: Transform;
  crop: Crop;
  background: Background;
}

// A line `width` output pixels wide (1 to 40) of `colour` along the inside of a picture's edge.
export interface Border {
  width: number;
  colour: string;
}

// A drop shadow: the picture's shape in `colour` at `opacity`, blurred `blur` output pixels (0 to
// 100, as a CSS shadow's) and moved `x` right and `y` down on the frame (-100 to 100).
export interface Shadow {
  blur: number;
  x: number;
  y: number;
  colour: string;
  opacity: number;
}

// How a Keyframe is approached from the one before it (backend/app/candidates.py, ADR 0008): a CSS
// cubic-bezier [x1, y1, x2, y2] from (0, 0) to (1, 1), its x within 0 to 1, its y -2 to 3.
export type Ease = [number, number, number, number];

// The value of one property of an item at `at` seconds from its start (in a picture's motion,
// seconds into the Clip), in the property's own units, approached from the one before by `ease`.
export interface Keyframe {
  at: number;
  value: number;
  ease: Ease;
}

// What a Keyframe sets: a picture's centre, scale, rotation and opacity, or a sound's volume.
export type KeyProperty = "x" | "y" | "scale" | "rotation" | "opacity" | "volume";

// Each keyed property's Keyframes, sorted by `at`; a property without any is left out.
export type Keys = Partial<Record<KeyProperty, Keyframe[]>>;

// A video or image from the Media Library laid over the Clip: from `start` for `secs` in Timeline
// time (a video from `offset` into it), cut by its Crop and placed by its Transform, a video's
// sound at `volume` (0, muted, by default); its corners rounded `radius` times its drawn shorter
// side (0 to 0.5), with a Border and a Shadow or none. Its `keys` move its centre, scale, rotation
// and opacity over its length, replacing those fields of its Transform, and a video's volume.
// A video's shows `secs` × speed of it from `offset` (docs/adr/0009); in Reverse its left edge shows
// `offset + secs × speed`, its right edge `offset`. It comes on and goes off as a Text Layer does.
// A video's sound may be Muted (ADR 0016), keeping its volume and Keyframes.
export interface Overlay extends Omit<Retiming, "hold">, OverlayAnimation {
  id: string;
  media: string;
  start: number;
  secs: number;
  offset: number;
  transform: Transform;
  crop: Crop;
  volume: number;
  radius: number;
  border: Border | null;
  shadow: Shadow | null;
  keys: Keys;
  muted?: boolean;
  // Its colour (ADR 0013): its picture graded before its corners, border and shadow. Neutral when missing.
  grade?: Grade;
  // A video's sound's Audio Effects (ADR 0017), as a Music Clip's; an image has none. Empty when missing.
  audio_effects?: AudioEffect[];
  // Its picture's Video Effects (ADR 0014), in order, after its Grade and before its corners, border,
  // rotation, shadow and opacity; sizes at its fitted size. Empty when missing.
  video_effects?: VideoEffect[];
}

// A span of the Adjust Track (GLOSSARY.md, Adjustment Layer; ADR 0013): its Grade laid over the Main
// Track and the Overlays from `start` for `secs` (Timeline time), mixed over the picture as it was by
// `strength` percent (0..100) times its ramp, up over `fade_in` seconds and down over `fade_out`
// (each at most half its length). Never on the Watermark, captions, Shapes, Text Layers or hook.
export interface AdjustmentLayer {
  id: string;
  start: number;
  secs: number;
  grade: Grade;
  strength: number;
  fade_in: number;
  fade_out: number;
  // Its Video Effects (ADR 0014), in order, after its Grade and mixed with it; sizes the 1080x1920
  // frame's. Empty when missing.
  video_effects?: VideoEffect[];
}

// An Adjustment Layer as the plan draws it: from `start` to `end` seconds into the Clip (cut at its
// end, its fades held to half of what is left), its Grade as given.
export interface AdjustmentEvent {
  id: string;
  start: number;
  end: number;
  grade: Grade;
  strength: number;
  fade_in: number;
  fade_out: number;
  // Its enabled Video Effects (ADR 0014), in order, after its Grade; sizes the 1080x1920 frame's.
  video_effects?: VideoEffect[];
}

// How an Overlay comes on and goes off, as a Text Layer does (its picture only, never its sound).
// Left out, they are none, none and 300 ms.
export interface OverlayAnimation {
  animation_in?: Animation;
  animation_out?: Animation;
  animation_ms?: number;
}

// A picture as drawn (backend/app/planner.py): the pixels in `crop` of its item (`item_size`
// large) scaled to `width` x `height`, flipped, turned `rotation` degrees clockwise about `centre`,
// at `opacity`; `bounds` holds it once turned, and may go past the frame's edges. An Overlay's
// corners are rounded `radius` output pixels, and it may have a Border and a Shadow. A keyed one
// (ADR 0008) has its `motion`, the Keyframes of each keyed property in seconds into the Clip, and
// its drawn size at scale 1 (`unscaled`); its other fields are its constants' (pictureAt samples it).
export interface Picture {
  crop: Box;
  item_size: [number, number];
  width: number;
  height: number;
  centre: [number, number];
  rotation: number;
  flip_h: boolean;
  flip_v: boolean;
  opacity: number;
  bounds: Box;
  radius: number;
  border: Border | null;
  shadow: Shadow | null;
  // Absent or empty, and null, for an unkeyed picture.
  motion?: Keys;
  unscaled?: [number, number] | null;
}

// An Overlay (`id`) as drawn: its `picture`, from `start` to `end`, coming on and going off by its
// animations; `image` for a still. A video's shows (end − start) × speed of it from `offset`
// (docs/adr/0009).
export interface OverlayEvent extends Omit<Retiming, "hold">, OverlayAnimation {
  id: string;
  media: string;
  picture: Picture;
  start: number;
  end: number;
  offset: number;
  image: boolean;
  // Its Overlay's Grade as given (ADR 0013): the preview folds it (editor/grading.ts), as the render does.
  grade?: Grade;
  // Its Overlay's enabled Video Effects (ADR 0014), in order, their sizes times its scale (as drawn).
  video_effects?: VideoEffect[];
}

// How one Segment gives way to the next: its stored id, with a recipe in backend/app/transitions.py and a look in pages/job/editor/transitions.ts.
export type TransitionKind =
  | "fade"
  | "fadeblack"
  | "fadewhite"
  | "fadegrays"
  | "dipcolour"
  | "dissolve"
  | "blurdissolve"
  | "slideleft"
  | "slideright"
  | "slideup"
  | "slidedown"
  | "coverleft"
  | "coverright"
  | "coverup"
  | "coverdown"
  | "whipleft"
  | "whipright"
  | "wipeleft"
  | "wiperight"
  | "wipeup"
  | "wipedown"
  | "radial"
  | "circleopen"
  | "circleclose"
  | "circlecrop"
  | "rectcrop"
  | "vertopen"
  | "horzopen"
  | "zoomin"
  | "squeezeh"
  | "squeezev"
  | "zoomblur"
  | "spin"
  | "filmburn"
  | "lightleak"
  | "glitch"
  | "rgbsplit"
  | "pixelize"
  | "hblur"
  | "distance"
  | "hlslice";

// How a Transition's sound crosses, whatever its kind: in straight lines, along quarter sines, or
// switched at its middle (pages/job/editor/transitionSound.ts).
export type TransitionSound = "linear" | "equal_power" | "cut";

// A Transition's knobs, read by the kinds that have them (pages/job/editor/transitions.ts): its
// strength (0 to 1; unset, its kind's own) and Dip to colour's colour (#RRGGBB; unset, black). Kept
// on a kind that doesn't read them. Always sent; one made by hand may leave them out.
export interface TransitionKnobs {
  strength?: number | null;
  colour?: string | null;
}

// A Transition from the Segment `after` into the next, the two overlapping by `secs` (0.1 to 3).
// Its sound is always sent; one made by hand may leave it out (linear).
export interface Transition extends TransitionKnobs {
  after: string;
  kind: TransitionKind;
  secs: number;
  sound?: TransitionSound;
}

// A Style Preset's Join Transition (GLOSSARY): a Transition without the Segment it follows.
export type JoinTransition = Omit<Transition, "after">;

// A Transition as drawn, from `start` to `end` seconds into the Clip.
export interface TransitionEvent extends TransitionKnobs {
  kind: TransitionKind;
  start: number;
  end: number;
  sound?: TransitionSound;
}

// A Segment of a Clip cut into several, as played: the Source from `source_start` to `source_end`,
// from `start` to `end` seconds into the Clip; a Freeze frame holds its frame at `source_start`. Its
// Retiming is always sent; a plan made by hand may leave it out.
export interface SegmentPlan extends Retiming {
  start: number;
  end: number;
  source_start: number;
  source_end: number;
  // A Media Library video's instead of the Source's, its sound at `volume` (none when `silent`).
  media: string | null;
  volume: number;
  silent: boolean;
  // How many of the plan's Scenes, in order, are its.
  scenes: number;
  // A keyed video's volume Keyframes, in seconds from its start, setting its volume in place of `volume`.
  gain: Keyframe[];
  // Its Segment's id.
  id: string;
  // Its sound's linear fades from `start` and to `end` (a Transition's overlap included), fitted to it.
  fade_in: number;
  fade_out: number;
  // Its sound switched silent (ADR 0016), keeping its volume, Keyframes and fades.
  muted?: boolean;
  // Its Grade as given (ADR 0013): the preview folds it (editor/grading.ts), as the render does.
  grade?: Grade;
  // Its sound's enabled Audio Effects (ADR 0017), in order.
  audio_effects?: AudioEffect[];
  // Its frame's enabled Video Effects (ADR 0014), in order, after its Grade; sizes the 1080x1920 frame's.
  video_effects?: VideoEffect[];
}

export interface RenderPlan {
  start: number;
  end: number;
  source_width: number;
  source_height: number;
  fps: number;
  scenes: ScenePlan[];
  captions: Cue[];
  hook: HookEvent | null;
  caption_style: CaptionStyle;
  hook_style: HookStyle;
  width: number;
  height: number;
  watermark: WatermarkEvent | null;
  watermark_style: WatermarkStyle;
  // The Text Layers that show, in drawing order.
  texts: TextEvent[];
  // The Music Clips heard, under the Clip's own sound at `source_volume`.
  audio: AudioEvent[];
  source_volume: number;
  // A Clip cut into several Segments: each, in order; [] for a Clip of one range.
  segments: SegmentPlan[];
  // Laid over the Segments, in drawing order.
  overlays: OverlayEvent[];
  // Between Segments, in order.
  transitions: TransitionEvent[];
  // The Shapes that show, in drawing order, under the Text Layers.
  shapes: ShapeEvent[];
  // The Cue Edits whose Word isn't shown, which do nothing (and are kept).
  unused_cue_edits: CueEdit[];
  // The shortest a Cue Edit leaves its Cue shown, where it has room.
  cue_min_secs: number;
  // Its ducked sounds' ramps.
  ducking?: Ducking;
  // The Candidate's Grade as given (ADR 0013), over the Main Track: the preview folds it (editor/grading.ts).
  grade?: Grade;
  // Its Adjustment Layers that show, in the order applied, over the Main Track and the Overlays.
  // None in a plan from before them.
  adjustment_layers?: AdjustmentEvent[];
}

// A Word the captions are made of, as heard (in seconds into the Clip), with its middle on its
// timeline (the Source's, or with `media` its Media Library item's: what a Word Edit of it is keyed
// by) and its Word Edit.
export interface PreviewWord extends Word {
  edit: WordEdit | null;
  at: number;
  media?: string | null;
}

// Where a Segment's caption Words come from: "clip", transcribed for a Source Segment's range;
// "transcript", the episode's until it is; "media", a video's Media Words; "pending", while they are
// transcribed; "failed", when that failed (until a Retry); "off", a video's with its Captions switch
// off; "none" (a Freeze frame, Reverse, a silent video, or the Job's captions off). A Segment's, not
// its video's MediaWords status ("ready" there is "media" here).
export type WordsStatus = "clip" | "transcript" | "media" | "pending" | "failed" | "off" | "none";

/**
 * A saved Export file (a frame or a sound): its path on this Mac, its name, and the URL it downloads
 * from, with its time, since a file saved again keeps its name.
 */
export interface SavedExport {
  path: string;
  name: string;
  url: string;
}

export interface PreviewPlan {
  plan: RenderPlan;
  words: PreviewWord[];
  // "clip": transcribed for the Clip; "transcript": the episode's, until it is.
  words_source: "clip" | "transcript";
  // Each Segment's, by its id.
  words_status: Record<string, WordsStatus>;
  // Why a "failed" Segment's video failed to be transcribed, by the Segment's id.
  words_errors: Record<string, string>;
  // False while the Clip is planned as one Scene, unanalysed.
  analysed: boolean;
}

export interface NewPreset {
  name: string;
  caption?: Partial<CaptionStyle>;
  hook?: Partial<HookStyle>;
  watermark?: Partial<WatermarkStyle>;
  join_transition?: JoinTransition | null;
}

// A Face (GLOSSARY): a bundled or imported font file of one weight and slant, with what its font says
// of its licence, and its measures in its units.
export interface FontInfo {
  id: string;
  label: string;
  // The name libass matches it by.
  family: string;
  // The family the picker groups it in.
  typographic_family: string;
  weight: number;
  italic: boolean;
  bundled: boolean;
  copyright: string;
  licence: string;
  licence_url: string;
  // Its font says it may not be embedded.
  restricted: boolean;
  // Its file, at a URL that changes with it.
  url: string;
  // Windows ascent plus descent: libass's font size. A browser's is the em.
  units: number;
  em: number;
  ascent: number;
  cap_height: number;
  descent: number;
}

// What importing a font file added, the Faces it holds that were there already, and its warnings.
export interface FontImported {
  faces: FontInfo[];
  existing: FontInfo[];
  warnings: string[];
}

// A piece of a Candidate's Main Track (docs/adr/0002-segments-and-timeline-time.md): the Source
// from `start` to `end`, snapped to Words; or, with `media`, a Media Library video from `start` to
// `end` seconds into it, placed by its `framing` (which only it has), its own sound at `volume`.
// A video's `keys` move its Framing's Transform and shape its volume (ADR 0008), each `at` in
// seconds from its start; the Source's have none. Its range plays in (end − start) ÷ speed on the
// Timeline (docs/adr/0009), its left edge showing `end` in Reverse; a Freeze frame holds the frame
// at `start`, silent, and its `end` is `start`. Muted (ADR 0016), its sound is silent and keeps its volume and Keyframes.
export interface ClipSegment extends Retiming {
  id: string;
  start: number;
  end: number;
  media?: string | null;
  framing?: Framing | null;
  volume?: number;
  keys?: Keys;
  // A video's Captions switch: false leaves it uncaptioned; empty means on. The Source's have none.
  captions?: boolean | null;
  // Its sound's fades in and out, 0 to 10 s each (the plan fits them to its length).
  fade_in?: number;
  fade_out?: number;
  muted?: boolean;
  // Its colour (ADR 0013): its whole frame graded before the joins. Neutral when missing.
  grade?: Grade;
  // Its sound's Audio Effects (ADR 0017), in order, after its Speed and before its volume and fades.
  // Empty when missing.
  audio_effects?: AudioEffect[];
  // Its whole frame's Video Effects (ADR 0014), in order, after its Grade and before the joins; sizes
  // the 1080x1920 frame's. Empty when missing.
  video_effects?: VideoEffect[];
}

// An Audio Effect applied to an item's sound (GLOSSARY: Audio Effect; ADR 0017): a catalogue
// effect's `id`, its settings by key (the server fills in each one left out with its default), and
// whether it is heard; off, it stays in the stack.
export interface AudioEffect {
  id: string;
  params: Record<string, number>;
  enabled: boolean;
}

// One of a catalogue effect's settings: a number from `min` to `max` in steps of `step`; the
// `intensity` one is the slider of the effect's row in the stack.
export interface AudioEffectSetting {
  key: string;
  label: string;
  min: number;
  max: number;
  default: number;
  step: number;
  unit: string;
  intensity: boolean;
}

// An entry of the Audio Effects catalogue (backend/app/audio_effects.py), on its group's shelf at `order`.
export interface AudioEffectKind {
  id: string;
  name: string;
  group: "Clean" | "Voice" | "Tone" | "Space";
  order: number;
  description: string;
  settings: AudioEffectSetting[];
}

// A Video Effect applied to a picture (GLOSSARY: Video Effect; ADR 0014): a catalogue effect's `id`,
// its settings by key (the server fills in each one left out with its default), and whether it is
// drawn; off, it stays in the stack. An id is at most once in a stack.
export interface VideoEffect {
  id: string;
  params: Record<string, number>;
  enabled: boolean;
}

// An entry of the Video Effects catalogue (backend/app/video_effects.py, the effects registry's video
// kind), on its category's shelf at `order`. A setting in "px" is output pixels at the picture's
// fitted size, times its scale when drawn.
export interface VideoEffectKind {
  id: string;
  kind: "video";
  name: string;
  category: "Blur" | "Distort" | "Light" | "Stylize" | "Cutout";
  order: number;
  description: string;
  settings: AudioEffectSetting[];
}

// The dials of a Grade (GLOSSARY: Adjust), in Concat's ranges, each neutral by default: temperature
// 2000–11000 K (6500 as shot), exposure ±3 EV, sharpen, fade and vignette 0–100, the rest −100–100.
export interface Adjust {
  temperature: number;
  tint: number;
  saturation: number;
  exposure: number;
  brightness: number;
  contrast: number;
  highlights: number;
  shadows: number;
  whites: number;
  blacks: number;
  sharpen: number;
  fade: number;
  vignette: number;
}

// The colour of a picture (GLOSSARY: Grade, ADR 0013): its Adjust, then its Look (an id, or null)
// mixed over it at `intensity` percent. Constant over its item.
export interface Grade {
  adjust: Adjust;
  look: string | null;
  intensity: number;
}

// A Look a Grade's `look` names (GLOSSARY: Look; backend/app/looks.py): its Adjust values, laid over
// the Grade's own (editor/grading.ts says how); its category is its shelf in the Filters tab, and
// `order` its place.
export interface Look {
  id: string;
  name: string;
  category: string;
  order: number;
  adjust: Adjust;
  // An Imported Look's: it has a 3D table (from a .cube file), and the tables and matrix fitted to it,
  // which the preview draws in its place. A built-in Look has neither.
  has_table?: boolean;
  fit?: LookFit | null;
}

// The table per channel (R, G, B; 256 entries, 0..1) and the 3×3 matrix (rows R, G, B) fitted to an
// Imported Look's 3D table (backend/app/looks.py), drawn as a Grade's tables and matrix are.
export interface LookFit {
  tables: [number[], number[], number[]];
  matrix: [[number, number, number], [number, number, number], [number, number, number]];
}

// A range of a video to play from a Retimed copy (docs/adr/0009): backwards when `reverse`, at
// `speed` (1 by default), its pitch following the Speed with `pitch`.
export interface RetimedRange extends Omit<Retiming, "hold"> {
  start: number;
  end: number;
}

// A Retimed copy as it is coming along: its `progress` from 0 to 1, then its `url` and where in it
// the range asked for starts (`at`, seconds); or the `error` that stopped it.
export interface RetimedCopy {
  progress: number;
  url: string | null;
  at: number | null;
  error: string | null;
}

export interface Candidate {
  id: string;
  // On the Source's timeline; with several Segments, the hull of what they show.
  start: number;
  end: number;
  // The AI's assessment; null for a manual Candidate.
  predicted_score: number | null;
  hook_strength: number | null;
  emotion: string;
  reason: string;
  retention_notes: string;
  hook_text: string;
  title: string;
  descriptions: { tiktok: string; instagram: string; shorts: string };
  hashtags: string[];
  window_id: string | null;
  window_score: number | null;
  origin: "ai" | "manual";
  layout: Layout;
  // How its Manual Layout frames every Scene without an override; null for another Layout.
  framing: Framing | null;
  // Chosen for rendering.
  selected: boolean;
  // The owner has changed its bounds, hook text, layout or style.
  edited: boolean;
  preset_id: string;
  style_overrides: StyleOverrides;
  word_edits: WordEdit[];
  cue_edits: CueEdit[];
  // When the hook comes on, in seconds into the Clip, and how long it stays.
  hook_start: number;
  hook_secs: number;
  layout_overrides: LayoutOverride[];
  // A short label in a pill above the hook; "" for none.
  hook_kicker: string;
  // The Advanced Edit's, drawn in this order (the last on top).
  text_layers: TextLayer[];
  // The Advanced Edit's, drawn in this order over the captions and under the Text Layers.
  shapes: Shape[];
  // Its Music Clips, under its own sound at `source_volume` (0 to 2).
  music: MusicClip[];
  source_volume: number;
  // Its Main Track; [] (one piece, from `start` to `end`) unless the Advanced Edit has cut it.
  segments: ClipSegment[];
  // Laid over the Main Track, the last on top.
  overlays: Overlay[];
  // Between its Segments, each by the Segment it follows.
  transitions: Transition[];
  // Its own colour (ADR 0013): laid over its whole Main Track, after the Segments' Grades and the
  // Transitions, never on the Overlays. Neutral when missing.
  grade?: Grade;
  // Its Adjustment Layers (ADR 0013), applied in this order; none when missing.
  adjustment_layers?: AdjustmentLayer[];
  // Its saved state's number: each save that changes it makes the next (ADR 0003).
  revision: number;
}

// A Candidate's Main Track: its Segments, or its one range.
export const mainTrackOf = (candidate: Pick<Candidate, "start" | "end" | "segments">): ClipSegment[] =>
  candidate.segments.length ? candidate.segments : [{ id: "main", start: candidate.start, end: candidate.end }];

// The items whose sound can be saved as a WAV.
export type SoundKind = "segment" | "music" | "overlay";

// An item's Effected copy (ADR 0017): its sound before its volume, through its Audio Effects, at
// `url`; or none (`url` null) for an item without one, and `why`.
export interface EffectedCopy {
  url: string | null;
  why?: string | null;
}

// A review edit: fields left out stay as they are. The backend snaps start and end to Words.
export interface CandidateChange {
  start?: number;
  end?: number;
  hook_text?: string;
  layout?: Layout;
  // The Manual Layout's, needed with it and refused with another; null leaves it (dropped with Manual).
  framing?: Framing | null;
  selected?: boolean;
  preset_id?: string;
  // Replaces the Candidate's overrides as a whole.
  style_overrides?: StyleOverrides;
  // Replaces the Candidate's Word Edits as a whole.
  word_edits?: WordEdit[];
  // Replaces the Candidate's Cue Edits as a whole.
  cue_edits?: CueEdit[];
  hook_start?: number;
  hook_secs?: number;
  // Replaces the Candidate's Layout Overrides as a whole.
  layout_overrides?: LayoutOverride[];
  hook_kicker?: string;
  // Replaces the Candidate's Text Layers as a whole.
  text_layers?: TextLayer[];
  // Replaces the Candidate's Shapes as a whole.
  shapes?: Shape[];
  // Replaces the Candidate's Music Clips as a whole.
  music?: MusicClip[];
  source_volume?: number;
  // Replaces the Main Track as a whole; one Segment is kept as `start` and `end`.
  segments?: ClipSegment[];
  // Replaces the Candidate's Overlays as a whole.
  overlays?: Overlay[];
  // Replaces the Candidate's Transitions as a whole; those without a join are left out.
  transitions?: Transition[];
  // The Candidate's own Grade (ADR 0013), replaced as a whole.
  grade?: Grade;
  // Replaces the Candidate's Adjustment Layers as a whole.
  adjustment_layers?: AdjustmentLayer[];
  // The Revision the change was made from: refused (409) if the Candidate has moved past it.
  revision?: number;
}

// Which editor saves an edit, so that other editors can say who changed a Candidate.
export type EditSource = "advanced-edit" | "clip-editor";
// Who saved a Revision: an editor, the agent (MCP), a Restore, or unknown (a CLI run, an older caller);
// "original" for a Candidate as Selection (or the owner, for a manual one) made it.
export type SavedBy = EditSource | "agent" | "restore" | "unknown" | "original";

// This tab's id, sent with its edits: its own saves are then told apart from another tab's.
export const TAB_ID = crypto.randomUUID();

// An entry of a Candidate's Revision History: the last of a stretch of saves from one editor (in one
// tab), with the parts it changed since the entry before.
export interface RevisionEntry {
  revision: number;
  // null when it isn't known (a state written by another process).
  at: string | null;
  source: SavedBy;
  tab: string | null;
  parts: string[];
}

// A new Revision of one of a Job's Candidates, from its Candidate events: who saved it (`tab` for an
// editor's), and the parts it changed since the one before, as the editors name them.
export interface CandidateEvent {
  candidate: Candidate;
  source: SavedBy;
  tab: string | null;
  parts: string[];
}

export type Codec = "h264" | "hevc" | "av1";

// How a Clip is encoded (backend/app/encoding.py). The frame is 9:16, `resolution` its short side.
export interface ExportSettings {
  codec: Codec;
  resolution: 720 | 1080 | 1440 | 2160;
  // null for the Source's.
  fps: number | null;
  quality: "high" | "recommended" | "smallest";
  // A bitrate of their own, in place of the quality tier.
  bitrate: { mode: "vbr" | "cbr"; kbps: number } | null;
  // The loudness target in LUFS; null for none.
  loudness: -14 | -16 | null;
}

// Named, global Export Settings that a render uses for its whole batch.
export interface ExportPreset {
  id: string;
  name: string;
  builtin: boolean;
  order: number;
  settings: ExportSettings;
}

export interface ExportPresetList {
  // The built-in ones first.
  presets: ExportPreset[];
  // The one a render uses when none is asked for.
  default: string;
  // The codecs this Mac's ffmpeg can encode.
  available: Codec[];
}

// The formats a Candidate's sound is saved alone in: a 48 kHz 16-bit WAV, or AAC in an M4A.
export type AudioFormat = "wav" | "m4a";

// A finished render: the Candidate as it was rendered, and its files (relative to the Job's directory).
export interface RenderedClip {
  start: number;
  end: number;
  hook_text: string;
  layout: Layout;
  // Its Manual Layout's Framing, as rendered; null for another Layout (and before Manual).
  framing?: Framing | null;
  video: string;
  poster: string;
  plan: string;
  duration: number;
  size_bytes: number;
  encoder: string;
  render_secs: number;
  at: string;
  // The clip editor's edits as rendered and the styles they resolved to; null in a Clip rendered
  // before the editor.
  preset_id: string | null;
  style_overrides: StyleOverrides | null;
  word_edits: WordEdit[] | null;
  hook_start: number | null;
  hook_secs: number | null;
  layout_overrides: LayoutOverride[] | null;
  caption_style: CaptionStyle | null;
  hook_style: HookStyle | null;
  // "" in a Clip rendered before Kickers.
  hook_kicker: string;
  // null in a Clip rendered before Watermarks.
  watermark_style: WatermarkStyle | null;
  // [] in a Clip rendered before Text Layers, and before music.
  text_layers: TextLayer[];
  // [] in a Clip rendered before Shapes.
  shapes: Shape[];
  music: MusicClip[];
  source_volume: number;
  segments: ClipSegment[];
  overlays: Overlay[];
  transitions: Transition[];
  // The Candidate's Revision it was rendered from; null in a Clip rendered before Revisions.
  revision: number | null;
  // Its caption files, beside the MP4; null for a Job with captions off, and in a Clip rendered
  // before caption files.
  srt: string | null;
  vtt: string | null;
  // The Export Preset it was asked for (perhaps deleted since) and the Export Settings it was made
  // with, for display only; null in a Clip rendered before Export Presets (1080p H.264).
  export_preset_id: string | null;
  export: ExportSettings | null;
  // CBR was asked for and the encoder did VBR.
  bitrate_fallback: boolean;
}

export type ClipStatus = "queued" | "rendering" | "done" | "error";

// A caption file's format (backend/app/caption_files.py): one subtitle cue per Cue, in the Words'
// own case, with the Word Edits.
export type CaptionFormat = "srt" | "vtt";

export interface Clip {
  candidate_id: string;
  // Where its latest render request is.
  status: ClipStatus;
  requested_at: string;
  // The latest finished render; kept while it is rendered again, and when that fails.
  output: RenderedClip | null;
  error: string | null;
  // When the worker started rendering it; null unless it is rendering.
  started_at: string | null;
  // The Export Preset its latest request asked for; null in a Clip asked for before Export Presets.
  export_preset_id: string | null;
}

export interface JobDetail extends Job {
  transcript: Transcript | null;
  // Best first; null until the Job has been analyzed.
  candidates: Candidate[] | null;
  // In their Candidates' order.
  clips: Clip[];
}

// A `job` event from GET /api/jobs/{id}/events.
export interface JobProgress {
  status: JobStatus;
  stage: JobStatus | null;
  progress: number | null;
  message: string | null;
  error: string | null;
  warnings: JobWarning[];
  retry_at: string | null;
}

export interface NewJob {
  url: string;
  options: Partial<JobOptions>;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    // What the backend said besides its message, such as a refused delete's uses.
    readonly detail?: unknown,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await send(path, init);
  return (response.status === 204 ? undefined : await response.json()) as T;
}

// The API's answer to a request, or an ApiError with its reason for refusing it.
async function send(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      // A FormData body sets its own multipart type, with its boundary.
      ...(typeof init?.body === "string" ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers as Record<string, string> | undefined),
    },
  });
  if (!response.ok) {
    const [message, detail] = await errorMessage(response);
    throw new ApiError(response.status, message, detail);
  }
  return response;
}

// The Candidate as it is now, when a save was refused for being made from an older Revision.
export function staleCandidate(reason: unknown): Candidate | null {
  if (!(reason instanceof ApiError) || reason.status !== 409) return null;
  const detail = reason.detail as { candidate?: Candidate } | undefined;
  return detail?.candidate ?? null;
}

// FastAPI's `detail`: a message, a list of validation errors, or an object with a message.
async function errorMessage(response: Response): Promise<[string, unknown]> {
  try {
    const { detail } = await response.json();
    return [detailMessage(detail) ?? `${response.status} ${response.statusText}`, detail];
  } catch {
    // not JSON: fall through to the status line
  }
  return [`${response.status} ${response.statusText}`, undefined];
}

function detailMessage(detail: unknown): string | null {
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail)) return detail.map((error: { msg: string }) => error.msg).join("; ");
  if (detail && typeof detail === "object" && "message" in detail && typeof detail.message === "string") return detail.message;
  return null;
}

export const api = {
  // Newest first: a page of `limit`, the one before the Job created at `before` (the last listed).
  listJobs: (page: { limit: number; before?: string }) => {
    const query = new URLSearchParams({ limit: String(page.limit) });
    if (page.before) query.set("before", page.before);
    return request<Job[]>(`/jobs?${query}`);
  },
  getJob: (id: string) => request<JobDetail>(`/jobs/${id}`),
  createJob: (job: NewJob) => request<Job>("/jobs", { method: "POST", body: JSON.stringify(job) }),
  retryJob: (id: string) => request<Job>(`/jobs/${id}/retry`, { method: "POST" }),
  deleteJob: (id: string) => request<void>(`/jobs/${id}`, { method: "DELETE" }),
  // Rejects with the backend's message (507) when an upload this size wouldn't fit on the disk.
  checkUpload: (size: number) => request<void>(`/jobs/upload/check?size=${size}`),
  updateCandidate: (jobId: string, id: string, change: CandidateChange, source: EditSource) =>
    request<Candidate>(`/jobs/${jobId}/candidates/${id}`, {
      method: "PATCH",
      body: JSON.stringify(change),
      headers: { "X-Edit-Source": source, "X-Edit-Tab": TAB_ID },
    }),
  // The Candidate's Revision History, newest first.
  listRevisions: (jobId: string, id: string) =>
    request<{ revisions: RevisionEntry[] }>(`/jobs/${jobId}/candidates/${id}/revisions`).then((answer) => answer.revisions),
  // Saves the Candidate as it was at Revision `restore`, as its next Revision; refused (409) when it
  // has moved past `revision`.
  restoreRevision: (jobId: string, id: string, restore: number, revision: number, source: EditSource) =>
    request<Candidate>(`/jobs/${jobId}/candidates/${id}/revisions/${restore}/restore`, {
      method: "POST",
      body: JSON.stringify({ revision }),
      headers: { "X-Edit-Source": source, "X-Edit-Tab": TAB_ID },
    }),
  addCandidate: (jobId: string, range: { start: number; end: number }) =>
    request<Candidate>(`/jobs/${jobId}/candidates`, { method: "POST", body: JSON.stringify(range) }),
  // Queues Clips of the given Candidates, or of the selected ones, with an Export Preset (the
  // default without one); answers with the Job's Clips.
  render: (jobId: string, candidateIds?: string[], exportPresetId?: string) =>
    request<Clip[]>(`/jobs/${jobId}/render`, {
      method: "POST",
      body: JSON.stringify({ candidate_ids: candidateIds, export_preset_id: exportPresetId }),
    }),
  listExportPresets: () => request<ExportPresetList>("/export-presets"),
  // The owner's Export Presets: a built-in one is refused (409) a change or a delete.
  createExportPreset: (name: string, settings: ExportSettings) =>
    request<ExportPreset>("/export-presets", { method: "POST", body: JSON.stringify({ name, settings }) }),
  changeExportPreset: (id: string, name: string, settings: ExportSettings) =>
    request<ExportPreset>(`/export-presets/${id}`, { method: "PUT", body: JSON.stringify({ name, settings }) }),
  deleteExportPreset: (id: string) => request<void>(`/export-presets/${id}`, { method: "DELETE" }),
  useExportPresetAsDefault: (id: string) =>
    request<ExportPreset>("/export-presets/default", { method: "PUT", body: JSON.stringify({ preset_id: id }) }),
  // The bytes Clips `secs` long in all come to as `settings` say, at the Source's frame rate `fps`
  // when they keep it: the formula is the backend's alone.
  estimateExport: (settings: ExportSettings, secs: number, fps: number) =>
    request<{ bytes: number }>("/export-presets/estimate", { method: "POST", body: JSON.stringify({ settings, secs, fps }) }).then(
      (answer) => answer.bytes,
    ),
  // The Candidate's sound alone, at the Export Preset's loudness (the default's when left out).
  saveAudio: (jobId: string, candidateId: string, format: AudioFormat, exportPresetId?: string) =>
    request<SavedExport>(`/jobs/${jobId}/candidates/${candidateId}/audio`, {
      method: "POST",
      body: JSON.stringify({ format, export_preset_id: exportPresetId }),
    }),
  listClips: (jobId: string) => request<Clip[]>(`/jobs/${jobId}/clips`),
  listFonts: () => request<FontInfo[]>("/fonts"),
  importFont: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<FontImported>("/fonts", { method: "POST", body: form });
  },
  // The Candidate's Render Plan, or that of an unsaved draft of its edits.
  previewPlan: (jobId: string, id: string, draft?: CandidateChange, signal?: AbortSignal) =>
    request<PreviewPlan>(`/jobs/${jobId}/candidates/${id}/preview-plan`, {
      method: "POST",
      body: draft ? JSON.stringify(draft) : undefined,
      signal,
    }),
  // The frame at `at` (Timeline time) as the render draws it, of the Candidate or of an unsaved
  // draft, at an Export Preset's size (the default's), saved as a PNG in the Job (an Export file).
  saveFrame: (jobId: string, id: string, frame: { at: number; draft?: CandidateChange; export_preset_id?: string }) =>
    request<SavedExport>(`/jobs/${jobId}/candidates/${id}/frame`, { method: "POST", body: JSON.stringify(frame) }),
  // Compare render: the frame at `at` (Timeline time) as the render draws it at 1080x1920, of the
  // Candidate or of an unsaved draft, as a PNG; never kept in the Job.
  compareFrame: (jobId: string, id: string, frame: { at: number; draft?: CandidateChange }, signal?: AbortSignal) =>
    send(`/jobs/${jobId}/candidates/${id}/compare-frame`, { method: "POST", body: JSON.stringify(frame), signal }).then((response) =>
      response.blob(),
    ),
  // Save sound as WAV: the sound of the Candidate's item of `kind`, alone as heard in the Clip, from an
  // unsaved draft of its edits; the WAV, and the Content-Disposition that names the file.
  saveSound: async (jobId: string, id: string, kind: SoundKind, item: string, draft: CandidateChange) => {
    const response = await fetch(`/api/jobs/${jobId}/candidates/${id}/sound/${kind}/${encodeURIComponent(item)}`, {
      method: "POST",
      body: JSON.stringify(draft),
      headers: { "Content-Type": "application/json" },
    });
    if (!response.ok) {
      const [message, detail] = await errorMessage(response);
      throw new ApiError(response.status, message, detail);
    }
    return { wav: await response.blob(), disposition: response.headers.get("Content-Disposition") };
  },
  // The Effected copy of the Candidate's item of `kind` as an unsaved draft of its edits has it: made
  // (or waited for while it is made) before it answers.
  effectedCopy: (jobId: string, id: string, kind: SoundKind, item: string, draft: CandidateChange | null, signal?: AbortSignal) =>
    request<EffectedCopy>(`/jobs/${jobId}/candidates/${id}/effected/${kind}/${encodeURIComponent(item)}`, {
      method: "POST",
      body: draft ? JSON.stringify(draft) : undefined,
      signal,
    }),
  prepareCandidate: (jobId: string, id: string) =>
    request<Job>(`/jobs/${jobId}/candidates/${id}/prepare`, { method: "POST" }),
  // The Candidate's captions as an SRT or VTT file, from its saved state, without a render. Rejects
  // (409) for a Job with captions off, and while a captioned Segment's Words are still being transcribed.
  captionFile: (jobId: string, id: string, format: CaptionFormat) =>
    send(`/jobs/${jobId}/candidates/${id}/captions/${format}`).then((response) => response.text()),
  listPresets: () => request<StylePreset[]>("/presets"),
  createPreset: (preset: NewPreset) => request<StylePreset>("/presets", { method: "POST", body: JSON.stringify(preset) }),
  updatePreset: (id: string, preset: NewPreset) =>
    request<StylePreset>(`/presets/${id}`, { method: "PUT", body: JSON.stringify(preset) }),
  deletePreset: (id: string) => request<void>(`/presets/${id}`, { method: "DELETE" }),
  listTextPresets: () => request<TextPreset[]>("/text-presets"),
  // Every Audio Effect an item's stack can name, by group and order.
  listAudioEffects: () => request<AudioEffectKind[]>("/audio-effects"),
  listVideoEffects: () => request<VideoEffectKind[]>("/video-effects"),
  // Every Look, by its order.
  listLooks: () => request<Look[]>("/looks"),
  // A .cube file (a 3D table, 2 to 65 a side) as a new Imported Look; rejects naming its bad line.
  importLook: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<Look>("/looks", { method: "POST", body: form });
  },
  // Rejects with an ApiError of 409, saying which clips' grades use it, while any does.
  deleteLook: (id: string) => request<void>(`/looks/${encodeURIComponent(id)}`, { method: "DELETE" }),
  createTextPreset: (name: string, style: TextStyle) =>
    request<TextPreset>("/text-presets", { method: "POST", body: JSON.stringify({ name, style }) }),
  // One of the owner's renamed, or given another style.
  changeTextPreset: (id: string, change: { name?: string; style?: TextStyle }) =>
    request<TextPreset>(`/text-presets/${id}`, { method: "PATCH", body: JSON.stringify(change) }),
  deleteTextPreset: (id: string) => request<void>(`/text-presets/${id}`, { method: "DELETE" }),
  useTextPresetForNewTitles: (id: string) =>
    request<TextPreset>("/text-presets/default", { method: "PUT", body: JSON.stringify({ id }) }),
  listLogos: () => request<Logo[]>("/logos"),
  // A PNG, JPEG or WebP image of 5 MB at most; rejects with the backend's message otherwise.
  uploadLogo: (file: File) => {
    const form = new FormData();
    form.append("file", file);
    return request<Logo>("/logos", { method: "POST", body: form });
  },
  deleteLogo: (id: string) => request<void>(`/logos/${id}`, { method: "DELETE" }),
  listMedia: () => request<MediaItem[]>("/media"),
  // A video's language for its Media Words, in every Job (null: each Job's).
  setMediaLanguage: (id: string, language: string | null) =>
    request<MediaItem>(`/media/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ language }) }),
  // Retry a video's Media Words for the Job, or with `again`, transcribe them again.
  transcribeMediaWords: (jobId: string, mediaId: string, again = false) =>
    request<MediaWords>(`/jobs/${encodeURIComponent(jobId)}/media/${encodeURIComponent(mediaId)}/words`, {
      method: "POST",
      body: JSON.stringify({ again }),
    }),
  // Asks for the preview Retimed copy of a video's range (made in the background), and how it is coming along: poll it until it has a `url`.
  retimedCopy: (mediaId: string, range: RetimedRange, signal?: AbortSignal) =>
    request<RetimedCopy>(`/media/${encodeURIComponent(mediaId)}/retimed`, { method: "POST", body: JSON.stringify(range), signal }),
  // The same, of a range of the Job's Source.
  sourceRetimedCopy: (jobId: string, range: RetimedRange, signal?: AbortSignal) =>
    request<RetimedCopy>(`/jobs/${encodeURIComponent(jobId)}/retimed`, { method: "POST", body: JSON.stringify(range), signal }),
  // Rejects with an ApiError of 409 whose detail lists the clips using it.
  deleteMedia: (id: string) => request<void>(`/media/${id}`, { method: "DELETE" }),
};

export const logoUrl = (id: string) => `/api/logos/${encodeURIComponent(id)}`;
// A picture layer's picture (a Text Layer's or a Shape's), by the name its event gives: never stale.
export const layerPictureUrl = (jobId: string, name: string) => `/api/jobs/${encodeURIComponent(jobId)}/texts/${encodeURIComponent(name)}`;
// A Media Library item's normalized file, a video's small copy for the preview, and its still.
export const mediaItemUrl = (id: string) => `/api/media/${encodeURIComponent(id)}`;
export const mediaProxyUrl = (id: string) => `/api/media/${encodeURIComponent(id)}/proxy`;
export const mediaThumbnailUrl = (id: string) => `/api/media/${encodeURIComponent(id)}/thumbnail`;
// A video's Filmstrip chunk from `start` seconds, a multiple of 30 (docs/adr/0005-timeline-media-is-derived-per-chunk.md).
export const mediaFilmstripUrl = (id: string, start: number) => `/api/media/${encodeURIComponent(id)}/filmstrip/v1/${start}.jpg`;
// A video's or a song's Peaks chunk from `start` seconds, likewise.
export const mediaPeaksUrl = (id: string, start: number) => `/api/media/${encodeURIComponent(id)}/peaks/v1/${start}.peaks`;

// A file from the Job's directory (such as "clips/<id>.mp4"), served with range support for the
// player. `version` tells a file rendered again from the one the browser has cached.
export const mediaUrl = (jobId: string, file: string, version?: string) =>
  `/media/${jobId}/${file.split("/").map(encodeURIComponent).join("/")}` +
  (version ? `?v=${encodeURIComponent(version)}` : "");

// A still of the Source where a Candidate starts. Its range is in the URL, so a trim fetches the new
// still rather than the cached one.
export const candidateThumbnailUrl = (jobId: string, candidate: Pick<Candidate, "id" | "start" | "end">) =>
  `/api/jobs/${jobId}/candidates/${candidate.id}/thumbnail?v=${candidate.start}-${candidate.end}`;

// A Filmstrip chunk of the Job's Source from `start` seconds, a multiple of 30, made when first asked for.
export const jobFilmstripUrl = (jobId: string, start: number) => `/api/jobs/${encodeURIComponent(jobId)}/filmstrip/v1/${start}.jpg`;
// A Peaks chunk of the Job's Source from `start` seconds, likewise.
export const jobPeaksUrl = (jobId: string, start: number) => `/api/jobs/${encodeURIComponent(jobId)}/peaks/v1/${start}.peaks`;

export interface UploadProgress {
  loaded: number;
  total: number;
}

/**
 * Create a Job from a master file, streamed to the backend as multipart/form-data. XHR rather than
 * fetch, because only XHR reports upload progress. `abort()` cancels the upload, which then rejects
 * with an AbortError; the backend keeps nothing of it.
 */
export function uploadJob(
  file: File,
  options: Partial<JobOptions>,
  onProgress: (progress: UploadProgress) => void,
): { done: Promise<Job>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const done = new Promise<Job>((resolve, reject) => {
    xhr.upload.onprogress = (event) => onProgress({ loaded: event.loaded, total: event.total || file.size });
    xhr.onload = () => {
      let body: { detail?: unknown } | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // not JSON: fall through to the status line
      }
      if (xhr.status === 201 && body) return resolve(body as Job);
      const detail = body?.detail;
      const message =
        typeof detail === "string"
          ? detail
          : Array.isArray(detail)
            ? detail.map((error: { msg: string }) => error.msg).join("; ")
            : `${xhr.status} ${xhr.statusText}`;
      reject(new ApiError(xhr.status, message));
    };
    xhr.onerror = () => reject(new ApiError(0, "The upload stopped: the connection to AI Clipper was lost."));
    xhr.onabort = () => reject(new DOMException("The upload was cancelled", "AbortError"));
  });
  const form = new FormData();
  // The options go first: the backend checks them before it stores any of the file.
  form.append("options", JSON.stringify(options));
  form.append("file", file);
  xhr.open("POST", "/api/jobs/upload");
  xhr.send(form);
  return { done, abort: () => xhr.abort() };
}

export const jobEventsUrl = (id: string) => `/api/jobs/${id}/events`;
export const candidateEventsUrl = (id: string) => `/api/jobs/${id}/candidates/events`;

/**
 * Upload a video, song or image to the Media Library, with its upload progress (XHR, as uploadJob).
 * The backend converts it before it answers, so the upload reaching 100% isn't the end.
 */
export function uploadMedia(file: File, onProgress: (progress: UploadProgress) => void): { done: Promise<MediaItem>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const done = new Promise<MediaItem>((resolve, reject) => {
    xhr.upload.onprogress = (event) => onProgress({ loaded: event.loaded, total: event.total || file.size });
    xhr.onload = () => {
      let body: { detail?: unknown } | null = null;
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // not JSON: fall through to the status line
      }
      if (xhr.status === 201 && body) return resolve(body as MediaItem);
      reject(new ApiError(xhr.status, detailMessage(body?.detail) ?? `${xhr.status} ${xhr.statusText}`, body?.detail));
    };
    xhr.onerror = () => reject(new ApiError(0, "The upload stopped: the connection to AI Clipper was lost."));
    xhr.onabort = () => reject(new DOMException("The upload was cancelled", "AbortError"));
  });
  const form = new FormData();
  form.append("file", file);
  xhr.open("POST", "/api/media");
  xhr.send(form);
  return { done, abort: () => xhr.abort() };
}
