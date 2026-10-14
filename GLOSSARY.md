# Glossary

Use these terms in code, UI copy, tickets and commit messages.

## Jobs and selection

- **Job:** one episode being processed, from its URL or upload to its Clips.
- **Source:** the episode video. Times "on the Source's timeline" are seconds into it.
- **Transcript / Words:** the episode's normalized text with per-Word timing.
- **Window:** a Transcript slice scored by the AI.
- **Candidate:** a proposed clip under review: a range of the Source, its hook text, Layout, style and edits.
- **Clip:** a rendered output of a Candidate.
- **Channel Profile / Brief:** standing and per-Job steering for Selection.
- **Reference Set:** past clips used for evaluation and few-shot examples.

## Rendering

- **Layout:** how a Scene is framed: Track, Split or Blur (Auto: chosen per Scene by its faces).
- **Scene:** a shot between two cuts.
- **Render Plan:** the planner's output for one Clip (Scenes with their panels, caption events, and the hook event). It is everything the renderer draws.
- **Hook:** the opening overlay: the Candidate's hook text (with any Emphasis) and its Kicker, drawn as its Hook Style says.

## Clip editor

- **Style Preset:** a named, global look for captions and the hook: a Caption Style and a Hook Style. Built-in Presets can't be changed or deleted.
- **Caption Style:** how captions look and are broken into lines: font, size, colours, outline, shadow, case, highlight, position, and line limits.
- **Hook Style:** how the hook looks and moves: Shape, font, size, case, lines, alignment, colours, outline, shadow, Quote Mark, Kicker colours, position, and animations.
- **Hook Shape:** how the hook's box is drawn: one block behind all its lines, a strip per line, or none.
- **Emphasis:** words of the hook text marked `*like this*`, drawn in the Hook Style's Emphasis colour.
- **Kicker:** an optional short label (at most 24 characters) in a pill above the hook, such as "TERBONGKAR!".
- **Quote Mark:** a badge with quote marks on the hook's top-left corner.
- **Style Override:** a field of the Preset's style replaced on one Candidate.
- **Word Edit:** a correction of one caption Word, keyed by a time on the Source's timeline. It gives new text, removes the Word (empty text), or starts a new line before it.
- **Layout Override:** a Layout for the one Scene that holds a time on the Source's timeline, replacing the Candidate's Layout there.
- **Preview Plan:** the Render Plan of a Candidate, or of an unsaved draft of its edits, computed for the editor's preview without rendering.
- **Timeline:** the editor's tracks under the preview: the clip's range, Scenes, caption lines and the hook.
