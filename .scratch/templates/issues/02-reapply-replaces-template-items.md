# 02: Reapply replaces Template items, and "No Template"

**Parent spec:** `../spec.md` (Apply steps 1 and 7, "No Template"). See also GLOSSARY (Template item) and ADR 0023.

**What to build:** applying a Template to a Candidate that already has one never doubles its layers. The old Template's items are replaced and the hand-made ones are kept, and "No Template" takes them off.

- **Apply first removes every Template item** (any mark), then puts in the new ones.
- **Notices count the Template items that were replaced after being changed by hand.** An item counts as changed when it differs from a fresh application of the Template it names. When that Template is gone, every one of its items counts as replaced.
- **`template_id: null`** (REST, and `apply_template`) is "No Template": it removes Template items only.
- **`get_candidate` and the `apply_template` dry run** show which items are Template items, and from which Template (its name, or "deleted").

**Blocked by:** 01.

**Status:** done

- [x] Pure tests:
  - Reapplying the same Template leaves one set of its layers.
  - Applying another Template replaces the first one's items.
  - A moved lower-third is counted as changed by hand and replaced.
  - Hand-made layers are kept.
  - "No Template" removes the Template items and nothing else.
- [x] HTTP and MCP: `apply_template` with null, and the dry run listing marks and notices.
