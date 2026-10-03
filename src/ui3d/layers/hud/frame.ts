/** Where on the screen a HUD piece hangs, in the view space the HUD lives in.
 *
 * Pure math (no three.js, no React) so it can be unit-tested and reasoned
 * about on paper. Conventions match ui3d/anchors.tsx: view space is +x
 * right, +y up, -z ahead, metres from the eye.
 *
 * Why this exists: a corner of the screen is not a fixed point in view
 * space — it moves with the aspect ratio. Sizing everything by the screen
 * HEIGHT (like pxFor) and placing by the actual edges keeps the HUD tucked
 * into the corners on a 16:10 laptop, a 21:9 monitor and a 4:3 tablet. */

/** tan(fov/2) for a vertical field of view in degrees. */
export function tanHalf(fovDeg: number): number {
  return Math.tan((fovDeg * Math.PI) / 360);
}

/** The view-space point that projects to NDC (x, y) at `distance` metres
 * ahead: the plane z = -distance, scaled to the frustum there. */
export function viewPoint(
  ndcX: number,
  ndcY: number,
  distance: number,
  aspect: number,
  tanHalfFov: number,
): [number, number, number] {
  const halfH = distance * tanHalfFov;
  return [ndcX * halfH * aspect, ndcY * halfH, -distance];
}

/** A point inset from a screen edge or corner.
 *
 * `h` / `v` pick the edge: -1 left/bottom, 0 centre, 1 right/top. Insets are
 * fractions of the screen HEIGHT (so a 0.05 inset is the same number of
 * pixels from the left edge as from the bottom), measured from that edge
 * toward the centre; for a centred axis the inset is a plain offset. */
export function edgeSpot(
  h: -1 | 0 | 1,
  v: -1 | 0 | 1,
  insetX: number,
  insetY: number,
  distance: number,
  aspect: number,
  tanHalfFov: number,
): [number, number, number] {
  // One screen height spans 2 NDC units vertically, 2/aspect horizontally.
  const ndcX = h === 0 ? (insetX * 2) / aspect : h * (1 - (insetX * 2) / aspect);
  const ndcY = v === 0 ? insetY * 2 : v * (1 - insetY * 2);
  return viewPoint(ndcX, ndcY, distance, aspect, tanHalfFov);
}

/** World size of `fraction` of the screen height at `distance` metres. */
export function screenToWorld(fraction: number, distance: number, tanHalfFov: number): number {
  return fraction * 2 * distance * tanHalfFov;
}

/** The anamorphic correction for a small solid object sitting at view-space
 * point (x, y, z) on a plane facing the eye.
 *
 * A rectilinear projection stretches solids toward the edges of a wide field
 * of view: a sphere at angle θ off the view axis images as an ellipse drawn
 * out RADIALLY (away from the screen centre) by 1/cos θ, while flat things
 * parallel to the screen (text) stay true. At the corners of a 104°-wide view
 * that's a 1.6× stretch — round flasks become eggs.
 *
 * The stretch comes from the object's extent along t̂, the direction
 * perpendicular to the view ray inside the plane holding the ray and the
 * view axis (t̂ = cos θ·radial + sin θ·ẑ): the image-plane size along the
 * radial is that extent / cos θ. Squashing the object by cos θ along t̂
 * cancels it exactly, for any shape.
 *
 * Returns the in-screen angle φ of the radial direction, the off-axis angle
 * θ, and the squash factor cos θ (1 = none). */
export function undistortion(x: number, y: number, z: number): { angle: number; tilt: number; squash: number } {
  const depth = Math.max(1e-6, -z);
  const r = Math.hypot(x, y);
  if (r < 1e-9) return { angle: 0, tilt: 0, squash: 1 };
  const tilt = Math.atan2(r, depth);
  return { angle: Math.atan2(y, x), tilt, squash: Math.cos(tilt) };
}
