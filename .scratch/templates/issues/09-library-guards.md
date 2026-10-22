# 09: Library guards

**Parent spec:** `../spec.md` (Server: validation, delete guards). See also GLOSSARY (Template, Media Library, Imported Look, Face).

**What to build:** a Template never points at a missing item. Saving one that names a missing item is refused, and deleting an item a Template uses is refused with that Template named.

- **Saving a Template validates its media, Looks, Faces and Logo** as an edit is validated. Missing or unusable items give 422.
- **The media, Look and Face use lists** also scan the Template store, with a `template` use kind naming the Template. A delete then gives 409.
  - The editor's existing "in use" messages show Template uses too.
- **Deleting a Logo stays unguarded.** A Template showing it then applies with no Watermark, as Presets and Candidates do.

**Blocked by:** 01.

**Status:** ready-for-agent

- [ ] HTTP:
  - Saving a Template naming a missing media item or Face gives 422.
  - Deleting a song, a Look or a Face used only by a Template gives 409 with a `template` use naming it.
  - After the Template is deleted, the item can be deleted.
  - A Template with a deleted Logo applies with no Watermark.
- [ ] Vitest: the Media Library's "in use" message names a Template.
