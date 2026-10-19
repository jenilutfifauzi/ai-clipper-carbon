import { PIXELIZE_BLOCKS, pixelizeFilter } from "./transitions";

/**
 * The SVG filters the Transition looks refer to (transitions.ts): Pixelize's, one per size of block.
 * Each keeps a dot of the picture at the middle of every block and spreads it over the block. Drawn
 * once wherever a look is shown: the preview, and the Transitions tab's cards. A browser without
 * them shows the look's crossfade alone.
 */
export function TransitionFilters() {
  return (
    <svg aria-hidden width={0} height={0} className="absolute">
      <defs>
        {PIXELIZE_BLOCKS.map((block, level) => (
          <filter key={block} id={pixelizeFilter(level)} x="0" y="0" width="100%" height="100%" colorInterpolationFilters="sRGB">
            <feFlood x={block / 2 - 1} y={block / 2 - 1} width={2} height={2} />
            <feComposite width={block} height={block} />
            <feTile result="dots" />
            <feComposite in="SourceGraphic" in2="dots" operator="in" />
            <feMorphology operator="dilate" radius={block / 2} />
          </filter>
        ))}
      </defs>
    </svg>
  );
}
