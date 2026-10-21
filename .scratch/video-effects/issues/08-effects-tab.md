# 08: The Effects tab

**Parent spec:** `../spec.md` ("Solution", "Effects tab", "Editor actions"); ADR 0014.

**What to build:** a new Effects tab in the Asset Panel, beside the Filters tab and like it.
- **Cards:** Video Effect cards by category, with a search. Each card shows the frame at the playhead with its effect at its defaults, drawn by the same SVG imitation as the preview.
- **Hover:** hovering a card tries the effect on the preview, on the Pick, or on the whole frame with nothing picked. Leaving the card takes it off. Hovering is never saved and never undone.
- **Click:** adds the effect to the Pick's stacks, with the same rules as "Add effect":
  - an item that already has the effect is skipped;
  - a Cutout effect is skipped on a Segment or an Adjustment Layer.
- **Drag onto the Timeline:** makes an Adjustment Layer at the drop point, with a neutral Grade and that effect, as dropping a Look does. A Cutout card can't be dropped there.

**Blocked by:** 03.

**Status:** done

- [x] The tab lists every catalogue video effect by category, and the search filters them.
- [x] Each card shows the playhead frame with its effect.
- [x] Hovering a card shows the effect on the preview and leaves no change in the Candidate or the undo history.
- [x] A click adds the effect to the picked items as one step of undo, skipping duplicates and Cutout on Segments.
- [x] Dropping a card on the Timeline makes an Adjustment Layer carrying the effect.
- [x] Vitest: the drop action makes the Adjustment Layer, and the click action follows the skipping rules.

## Comments

Built the Effects tab, desktop only, beside the Filters tab.
- **Tab:** `AssetTab` has `"effects"` (`ASSET_TABS`, icon WandSparkles). The phone's toolbar leaves it out (`PHONE_ASSET_TABS` in `Chrome.tsx`). `AssetPanel` takes an `effects` slot.
- **Cards:** `EffectsPanel` and `EffectCards` in `advanced/EffectsPanel.tsx`, modelled on `LookPanel`/`LookCards`.
  - The cards come from `videoLibraryOf(kinds, query, keys)`, by category, with a search field. `keys` is `keysPicked`, so the Cutout cards show only with an Overlay picked.
  - The picture is `lookFrameAt` (the Filters tab's frame, through the now exported `frameStyle`). The effect is `videoEffectOf(kind)` imitated on `CARD_BOX` (1080×608, a 16:9 picture fitted to the frame's width) via `EffectFilters`. No `EffectsClock`, so timed effects draw as at time 0.
  - A Cutout card is not draggable.
- **Click:** `addVideoEffect({ edits, pick }, kind)`, one `history.set`. With no picture picked it tells `EFFECT_GOES_ON`. When every picked item already has the effect, it does nothing.
- **Hover:** `effectAudition` state in `AdvancedEdit`.
  - With a Pick, the drafted edits are `addVideoEffect`'s, drawn through `draftVideoEffects`.
  - With nothing picked, `auditionedPlan(plan, effect)` (`editor/videoEffects.ts`) appends a whole-Clip Adjustment Layer of a neutral Grade (`AUDITION_LAYER`) to the shown plan.
  - The audition ends with the tab, and nothing is saved.
- **Drop:** `DRAG_EFFECT` (`drag.ts`). The Adjust lanes in `Tracks.tsx` take it (`onDropEffect`), and `addEffectAdjustment` in AdvancedEdit calls `addEffectLayer(scene, kind, at)` in `actions.ts`.
  - `addEffectLayer` makes a layer with `NEUTRAL_GRADE` and the effect at its defaults, and returns null for a key. It shares `newAdjustmentLayer` with `addAdjustmentLayer`.
  - The Timeline names an effect-only layer by its first effect.
- **For 09:** stars and the Starred chip go on `EffectCards` (and the Add effect popover).
- **Not verified in a browser:** the hover and the drag. vitest (`effectsTab.test.tsx`) covers the actions, the audition plan and the cards' markup.
