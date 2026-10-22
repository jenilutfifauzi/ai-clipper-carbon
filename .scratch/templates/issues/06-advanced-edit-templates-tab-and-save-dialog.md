# 06: Advanced Edit: Templates tab and the save dialog

**Parent spec:** `../spec.md` (Editor, Server: poster). See also GLOSSARY (Asset Panel, Template).

**What to build:** in the Advanced Edit I save my edit as a Template with a poster and Anchors I can check, and I apply one from a tab with one step of undo, on a desktop or a phone.

- **The Templates tab in the Asset Panel** (desktop) shows cards: the poster, the name, the intro and outro lengths, and a star on the default.
  - Apply to this Candidate: the editor fetches the dry run and puts the result in as one draft change (one step of undo), saved like any edit. Notices show as a toast.
  - "No Template".
  - Rename and delete. Make default comes with 08; until then the action is absent.
- **The poster** is the frame at the playhead from the existing save-frame pipeline, with the draft, made at a card size. It is stored beside the Template store and served by `/templates/{id}/poster`.
- **"Save as Template…"** in the Advanced Edit's menu, on desktop only, opens a dialog with:
  - a name;
  - "Save over", a choice of the owner's Templates;
  - the layer list, each with its guessed Anchor (Start, End, Span) and a control to change it;
  - the capture notices.

  Saving sends the draft and the overrides.
- **Inspector:** a Template item shows "From Template ‹name›" (or "deleted").
- **Phone:** a Templates sheet offers Apply and "No Template" only.
- Follow the editor's existing patterns for tabs, sheets, dialogs and toasts. Desktop and phone layouts are both checked.

**Blocked by:** 02, 03.

**Status:** ready-for-agent

- [ ] Vitest:
  - Applying from the tab is one undo step, and undo restores the Candidate's previous items.
  - The save dialog shows the guessed Anchors and posts an override.
  - "Save over" keeps the id.
  - The Inspector shows "From Template".
  - The phone sheet has no Save, Rename or Delete.
- [ ] HTTP: the poster PNG exists after saving and is replaced on save over.
- [ ] Checked in the running app on a desktop and a phone width.
