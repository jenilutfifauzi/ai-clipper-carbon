import { useEffect, useState, type RefObject } from "react";
import type { RenderPlan } from "../../../api";
import { eyedropper, mediaPointOf, pickedColour, useEyedropper } from "./eyedropper";
import { pictureAt } from "./picture";
import { framePoint } from "./pictureGestures";
import type { Playback } from "./playback";

/**
 * While Chroma key's eyedropper is armed (eyedropper.ts), a layer over the whole stage that takes the
 * next click: over one of the Overlays it is armed for (the topmost there, as drawn at the time
 * shown), the colour of its media at that point, through its Grade, goes to the Inspector; elsewhere
 * it says so and stays armed. The playback is paused while it is. Escape puts it away.
 */
export function EyedropperLayer({ plan, playback, stage }: { plan: RenderPlan | null; playback: Playback; stage: RefObject<HTMLDivElement | null> }) {
  const request = useEyedropper();
  const [missed, setMissed] = useState(false);

  useEffect(() => {
    if (!request) return;
    playback.pause();
    setMissed(false);
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      eyedropper.cancel();
    };
    window.addEventListener("keydown", escape, true);
    return () => window.removeEventListener("keydown", escape, true);
  }, [request, playback]);

  if (!request || !plan) return null;
  return (
    <div
      role="button"
      tabIndex={-1}
      aria-label="Pick the key colour: click the Overlay"
      className="absolute inset-0 z-20 cursor-crosshair"
      onPointerDown={(event) => {
        event.stopPropagation();
        event.preventDefault();
      }}
      onClick={(event) => {
        event.stopPropagation();
        const element = stage.current;
        if (!element) return;
        const point = framePoint(element.getBoundingClientRect(), event, plan);
        const time = playback.shownTime;
        // The topmost of the Overlays armed for, showing now and under the point.
        const hit = plan.overlays
          .filter((overlay) => request.overlays.includes(overlay.id) && overlay.start <= time && time < overlay.end)
          .map((overlay) => ({ overlay, at: mediaPointOf(pictureAt(overlay.picture, time), point) }))
          .findLast(({ at }) => at !== null);
        const media = hit && element.querySelector<HTMLImageElement | HTMLVideoElement>(`[data-overlay-media="${CSS.escape(hit.overlay.id)}"]`);
        const colour = hit && media ? pickedColour(media, hit.overlay.picture.item_size, hit.at!, hit.overlay.grade) : null;
        if (!colour) {
          setMissed(true);
          return;
        }
        request.onPick(colour);
        eyedropper.cancel();
      }}
    >
      <p
        role="status"
        className="absolute inset-x-0 top-[4%] mx-auto w-fit max-w-[90%] rounded-full bg-black/75 px-3 py-1 text-center text-white"
        style={{ fontSize: "max(12px, calc(var(--scale) * 32px))" }}
      >
        {missed ? "Click on the keyed Overlay, where it shows" : "Click the Overlay to pick its key colour · Esc to cancel"}
      </p>
    </div>
  );
}
