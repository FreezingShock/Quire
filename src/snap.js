/**
 * Geometry for constrained and snapped drawing. Everything here works in
 * normalized page units and has no DOM, so it can be unit tested.
 *
 * Shift constrains: lines snap to 45 degree steps, and rectangles and ellipses
 * become perfect squares and circles. The View menu adds two optional snaps:
 * a grid for shape corners and freehand start points, and 15 degree steps for
 * lines.
 */

export const GRID_STEP = 25;
export const SHIFT_ANGLE_DEG = 45;
export const SNAP_ANGLE_DEG = 15;

const round1 = (v) => Math.round(v * 10) / 10;

/** Nearest grid node for a point. */
export function snapToGrid(p, step = GRID_STEP) {
  return [round1(Math.round(p[0] / step) * step), round1(Math.round(p[1] / step) * step)];
}

/**
 * Turns the line from `a` to `b` so its angle lands on the nearest multiple of
 * `stepDeg`. The length is kept, so the line still ends where the pointer is,
 * just on the closest allowed ray.
 */
export function constrainLine(a, b, stepDeg) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  if (len === 0) return [a[0], a[1]];
  const step = (stepDeg * Math.PI) / 180;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return [round1(a[0] + Math.cos(angle) * len), round1(a[1] + Math.sin(angle) * len)];
}

/**
 * Moves `b` so the box from `a` is a square. The side is the longer of the two
 * drags, and the box keeps the direction the pointer went.
 */
export function constrainSquare(a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const side = Math.max(Math.abs(dx), Math.abs(dy));
  return [
    round1(a[0] + (dx < 0 ? -side : side)),
    round1(a[1] + (dy < 0 ? -side : side)),
  ];
}

/**
 * Final end point for a shape drag. `options` holds the modifiers in force:
 * `shift` for the constraint, `grid` for grid snapping, and `angles` for 15
 * degree steps on lines. Shift wins over the angle snap on lines.
 */
export function shapeEnd(tool, a, b, { shift = false, grid = false, angles = false } = {}) {
  let end = grid ? snapToGrid(b) : [b[0], b[1]];
  if (tool === 'line' || tool === 'curve') {
    if (shift) end = constrainLine(a, end, SHIFT_ANGLE_DEG);
    else if (angles) end = constrainLine(a, end, SNAP_ANGLE_DEG);
  } else if (shift) {
    end = constrainSquare(a, end);
  }
  return end;
}
