/*
 * The thinking orb's geometry: a dotted sphere that turns and wobbles, now and then twisting bands
 * of its dots in quarter turns like a Rubik's cube, then twisting them back.
 *
 * From thinking-orbs@0.3.1 (© Jakub Antalik, MIT, https://github.com/Jakubantalik/thinking-orbs),
 * as open-design vendors it: the `solving` orb (its `rubik` draw) at the 20 px inline preset, here
 * with that preset already resolved. See THIRD_PARTY_NOTICES.md.
 */

/** A dot of a frame, in canvas pixels; `ink` 0 is the strongest (nearest), 1 the faintest. */
export interface OrbDot {
  x: number;
  y: number;
  z: number;
  r: number;
  ink: number;
}

// The 20 px preset of the `solving` orb, resolved: its rings and dots thinned (counts × 0.088, as
// the square root on each axis), its dot radii × 1.9.
const LAT_RINGS = 4;
const LON_DENSITY = 12;
const MOVE_COUNT = 14;
const MOVE_S = 0.42;
const REST_S = 1.2;
const R_BASE = 1.14;
const R_DEPTH = 3.23;
const R_ACTIVE = 0.57;
const R_MIN = 0.3;
const INK_FAR = 0.62;
const INK_SPAN = 0.54;

/** How fast the orb's own time runs against the clock's seconds. */
export const ORB_SPEED = 1.95;

interface Move {
  axis: number;
  lo: number;
  hi: number;
  ang: number;
}

// A deterministic hash in [0, 1).
function hash(a: number, b: number): number {
  const t = Math.sin(a * 12.9898 + b * 78.233) * 43758.5453;
  return t - Math.floor(t);
}

// The scramble: each move turns one band (a quarter of an axis) a quarter turn.
const MOVES: Move[] = Array.from({ length: MOVE_COUNT }, (_, i) => {
  const lo = -1 + 0.5 * Math.min(3, Math.floor(hash(i, 5.9) * 4));
  return { axis: Math.min(2, Math.floor(hash(i, 2.3) * 3)), lo, hi: lo + 0.5, ang: ((hash(i, 7.7) < 0.5 ? 1 : -1) * Math.PI) / 2 };
});

// How far each move has turned at `t`: the moves play forward, then back, then rest; each eases
// out (cubic) over the first 70% of its time.
function phase(t: number): { amount: number[]; active: number } {
  const playing = 2 * MOVE_COUNT * MOVE_S;
  const local = t % (playing + REST_S);
  const amount = new Array<number>(MOVE_COUNT).fill(0);
  if (local >= playing) return { amount, active: -1 };
  const step = Math.floor(local / MOVE_S);
  const eased = 1 - (1 - Math.min(1, (local - step * MOVE_S) / MOVE_S / 0.7)) ** 3;
  const forward = step < MOVE_COUNT;
  const at = forward ? step : 2 * MOVE_COUNT - 1 - step;
  amount.fill(1, 0, at);
  amount[at] = forward ? eased : 1 - eased;
  return { amount, active: at };
}

// The point after the moves so far, and whether the moving band holds it.
function twist([x, y, z]: [number, number, number], { amount, active }: ReturnType<typeof phase>): [number, number, number, boolean] {
  let onActive = false;
  MOVES.forEach((move, i) => {
    if (amount[i] <= 0) return;
    const coord = move.axis === 0 ? x : move.axis === 1 ? y : z;
    if (coord < move.lo || coord >= move.hi) return;
    if (i === active) onActive = true;
    const [c, s] = [Math.cos(move.ang * amount[i]), Math.sin(move.ang * amount[i])];
    if (move.axis === 0) [y, z] = [y * c - z * s, y * s + z * c];
    else if (move.axis === 1) [x, z] = [x * c + z * s, -x * s + z * c];
    else [x, y] = [x * c - y * s, x * s + y * c];
  });
  return [x, y, z, onActive];
}

/** The orb at its own time `t`, on a canvas `size` px square: its dots sorted far to near. */
export function orbFrame(size: number, t: number): OrbDot[] {
  const centre = size / 2;
  const radius = (size / 2) * 0.82;
  const [yaw, tilt] = [t * 0.55, 0.35 + 0.1 * Math.sin(t * 0.9)];
  const [sy, cy, st, ct] = [Math.sin(yaw), Math.cos(yaw), Math.sin(tilt), Math.cos(tilt)];
  const scale = (size / 300) ** 0.6;
  const at = phase(t);
  const dots: OrbDot[] = [];
  for (let ring = 0; ring <= LAT_RINGS; ring++) {
    const lat = -Math.PI / 2 + (ring / LAT_RINGS) * Math.PI;
    const count = Math.max(1, Math.round(Math.abs(Math.cos(lat)) * LON_DENSITY));
    for (let i = 0; i < count; i++) {
      const lon = (i / count) * 2 * Math.PI;
      const [x, y, z, onActive] = twist([Math.cos(lat) * Math.cos(lon), Math.sin(lat), Math.cos(lat) * Math.sin(lon)], at);
      // Spin about the vertical, tilt towards the viewer, project straight on.
      const [rx, rz] = [x * cy + z * sy, -x * sy + z * cy];
      const [ty, tz] = [y * ct - rz * st, y * st + rz * ct];
      const depth = (tz + 1) / 2;
      dots.push({
        x: centre + rx * radius,
        y: centre - ty * radius,
        z: tz,
        r: Math.max(R_MIN, (R_BASE + R_DEPTH * depth + (onActive ? R_ACTIVE : 0)) * scale),
        ink: Math.min(1, Math.max(0, INK_FAR - INK_SPAN * depth - (onActive ? 0.14 : 0))),
      });
    }
  }
  return dots.sort((a, b) => a.z - b.z);
}
