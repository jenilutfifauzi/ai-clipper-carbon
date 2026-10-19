import { PIXELIZE_BLOCKS, pixelizeFilter, RGBSPLIT_LEVELS, rgbsplitFilter } from "./transitions";

// Colour matrices keeping one of a picture's red, green and blue (and its alpha).
const ONLY = {
  red: "1 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 1 0",
  green: "0 0 0 0 0  0 1 0 0 0  0 0 0 0 0  0 0 0 1 0",
  blue: "0 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 1 0",
};

/**
 * The SVG filters the Transition looks refer to (transitions.ts):
 * - Pixelize's, one per size of block. Each keeps a dot of the picture at the middle of every block
 *   and spreads it over the block.
 * - RGB split's, one per tenth of strength. Each parts the red picture to the left and the blue to
 *   the right, by a share of the picture's width (in its bounding box's units), and adds the three
 *   back up.
 *
 * Drawn once wherever a look is shown: the preview, and the Transitions tab's cards. A browser
 * without them shows the look's crossfade alone.
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
        {Array.from({ length: RGBSPLIT_LEVELS }, (_, i) => i + 1).map((level) => {
          const spread = level / RGBSPLIT_LEVELS / 27;
          return (
            <filter key={level} id={rgbsplitFilter(level)} x="0" y="0" width="1" height="1" primitiveUnits="objectBoundingBox" colorInterpolationFilters="sRGB">
              <feColorMatrix in="SourceGraphic" values={ONLY.red} />
              <feOffset dx={-spread} result="red" />
              <feColorMatrix in="SourceGraphic" values={ONLY.green} result="green" />
              <feColorMatrix in="SourceGraphic" values={ONLY.blue} />
              <feOffset dx={spread} result="blue" />
              <feComposite in="red" in2="green" operator="arithmetic" k2={1} k3={1} result="redgreen" />
              <feComposite in="redgreen" in2="blue" operator="arithmetic" k2={1} k3={1} />
            </filter>
          );
        })}
      </defs>
    </svg>
  );
}
