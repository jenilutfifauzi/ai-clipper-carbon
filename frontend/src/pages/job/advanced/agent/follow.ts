import { useContext, useEffect, useRef } from "react";
import type { Picture } from "../../../../api";
import { rememberedSwitch } from "../../../../remembered";
import type { Playback } from "../../editor/playback";
import type { TimelineView } from "../AdvancedTimeline";
import { revealScroll } from "../playhead";
import { PresenceContext } from "./presence";
import type { PresenceTarget } from "./touched";

/**
 * Follow agent (ADR 0029): the Timeline goes where the Agent last changed something, and the stage
 * outlines what it changed. Remembered by the browser, on until turned off; scrolling or zooming the
 * Timeline by hand rests it for the rest of the turn (the presence store's `followHeld`).
 */
export const rememberedFollow = rememberedSwitch("agent.follow.v1", true);

/**
 * What Follow agent does for `target` on a Timeline showing `left` to `right` pixels from 0 s at
 * `pps` pixels a second, the playhead at `playhead` seconds: the scroll that brings the target into
 * view (null while it is in view), and the time to move the playhead to when it would be out of view
 * (null when it wouldn't). Null when there is nothing to do, or Follow is off.
 */
export function followStep(
  { left, right, pps, follow }: { left: number; right: number; pps: number; follow: boolean },
  target: Pick<PresenceTarget, "time"> | null,
  playhead: number,
): { scroll: number | null; seek: number | null } | null {
  if (!follow || !target) return null;
  const x = target.time * pps;
  const width = right - left;
  const scrolled = revealScroll(x, { scroll: left, width });
  const scroll = scrolled === left ? null : scrolled;
  const shown = scroll ?? left;
  const at = playhead * pps;
  const seek = at < shown || at > shown + width ? target.time : null;
  return scroll === null && seek === null ? null : { scroll, seek };
}

// The stage's pictures that are a Text Layer's, a Shape's or an Overlay's, by the id the stage gives them.
const OUTLINED = /^(?:text|shape|overlay):(.+)$/;

/**
 * The pictures to outline on the stage while a Revision's items flash: the Text Layers, Shapes and
 * Overlays among `pictures` (those on the stage now, by the stage's ids) whose item is `flashing`
 * and that are drawn. Never picked by it.
 */
export function agentOutlines<T extends { id: string; picture: Picture | null }>(
  pictures: readonly T[],
  flashing: ReadonlySet<string>,
): (T & { picture: Picture })[] {
  if (!flashing.size) return [];
  return pictures.filter((each): each is T & { picture: Picture } => {
    const item = each.id.match(OUTLINED)?.[1];
    return !!item && !!each.picture && flashing.has(item);
  });
}

/**
 * Follow agent on a Timeline drawn by `view` at `pps`: each new target of the presence store is
 * scrolled to (smoothly, but with reduced motion) and the paused playhead moved to it when it would
 * be out of view, while Follow is on and wasn't rested in this turn. A scroll or a zoom by hand rests it.
 */
export function useAgentFollow(view: TimelineView, pps: number, playback: Playback) {
  const store = useContext(PresenceContext);
  const follow = rememberedFollow.use();
  const ppsRef = useRef(pps);
  ppsRef.current = pps;

  useEffect(() => {
    if (!store) return;
    return view.byHand(() => store.holdFollow());
  }, [store, view]);

  useEffect(() => {
    if (!store) return;
    let last = store.getSnapshot().target;
    return store.subscribe(() => {
      const { target, followHeld } = store.getSnapshot();
      if (target === last) return;
      last = target;
      const step = followStep({ ...view.visible(), pps: ppsRef.current, follow: follow && !followHeld }, target, playback.time);
      if (step?.scroll != null) view.scrollTo(step.scroll);
      if (step?.seek != null && !playback.playing) playback.seek(step.seek);
    });
  }, [store, view, playback, follow]);
}

/** Follow agent on the Timeline it is drawn in (`useAgentFollow`): draws nothing. */
export function AgentFollow({ view, pps, playback }: { view: TimelineView; pps: number; playback: Playback }) {
  useAgentFollow(view, pps, playback);
  return null;
}
