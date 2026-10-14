import { useState } from "react";
import { useOnVisible } from "./useOnVisible";

// How many of a list already at hand to draw: a batch, then one more each time the end comes into
// reach, and never fewer than `atLeast` (say, up to the item opened from a link). `sentinelRef`
// goes on what stands at the end while `more` remain.
export function useReveal(total: number, batch: number, atLeast = 0) {
  const [count, setCount] = useState(batch);
  const shown = Math.min(total, Math.max(count, atLeast));
  const more = shown < total;
  const sentinelRef = useOnVisible(() => setCount(shown + batch), more, shown);
  return { shown, more, sentinelRef };
}
