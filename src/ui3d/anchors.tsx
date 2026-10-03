import { useFrame, useThree } from "@react-three/fiber";
import { useRef, type ReactNode } from "react";
import { Group, Quaternion, Vector3, type Camera } from "three";

/** Where in-world UI hangs.
 *
 *  - `<ViewAnchor offset>`: carried in front of the eye, like something held
 *    or worn — the HUD. It has a little inertia: turn fast and it trails a
 *    few degrees behind before catching up, walk and it sways. Physical, but
 *    capped so a flick never throws the HUD off screen.
 *  - `<WorldAnchor position>`: fixed in the world (a prompt above a chest),
 *    turning to face the eye.
 *  - `placeInFront(camera, distance)`: a world point ahead of the eye, for
 *    things that appear before you and then stay where they appeared.
 *
 * Offsets are in view space: +x right, +y up, -z ahead (metres). */

const tmpQ = new Quaternion();
const tmpV = new Vector3();

export function ViewAnchor({
  offset,
  children,
  follow = 16,
  maxLagDeg = 5,
}: {
  offset: readonly [number, number, number];
  children: ReactNode;
  /** Catch-up rate, 1/s. Higher = stiffer. Infinity = rigid. */
  follow?: number;
  /** Most the anchor may trail the view by, degrees. */
  maxLagDeg?: number;
}) {
  const group = useRef<Group>(null);
  const smoothed = useRef<Quaternion | null>(null);
  const camera = useThree((s) => s.camera);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const q = (smoothed.current ??= camera.quaternion.clone());
    if (!Number.isFinite(follow)) q.copy(camera.quaternion);
    else q.slerp(camera.quaternion, 1 - Math.exp(-follow * Math.min(dt, 0.1)));
    const lag = q.angleTo(camera.quaternion);
    const max = (maxLagDeg * Math.PI) / 180;
    if (lag > max) {
      // Pull the smoothed rotation back inside the cone around the view.
      tmpQ.copy(camera.quaternion).slerp(q, max / lag);
      q.copy(tmpQ);
    }
    tmpV.set(offset[0], offset[1], offset[2]).applyQuaternion(q);
    g.position.copy(camera.position).add(tmpV);
    g.quaternion.copy(q);
  }, -50);

  return <group ref={group}>{children}</group>;
}

export function WorldAnchor({
  position,
  children,
  billboard = "full",
}: {
  position: readonly [number, number, number];
  children: ReactNode;
  /** "full" faces the eye, "yaw" only turns about the vertical (signs,
   * nameplates), false keeps the group's own orientation. */
  billboard?: "full" | "yaw" | false;
}) {
  const group = useRef<Group>(null);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    g.position.set(position[0], position[1], position[2]);
    if (billboard === "full") g.quaternion.copy(camera.quaternion);
    else if (billboard === "yaw") g.rotation.set(0, Math.atan2(camera.position.x - g.position.x, camera.position.z - g.position.z), 0);
  }, -50);
  return <group ref={group}>{children}</group>;
}

/** A world point `distance` metres ahead of the eye, nudged by a view-space
 * offset (x right, y up). */
export function placeInFront(
  camera: Camera,
  distance: number,
  offset: readonly [number, number] = [0, 0],
  out = new Vector3(),
): Vector3 {
  return out
    .set(offset[0], offset[1], -distance)
    .applyQuaternion(camera.quaternion)
    .add(camera.position);
}

/** World size of one screen pixel at `distance` from the eye — for sizing
 * text so a font pixel lands on a whole number of screen pixels. */
export function worldPerScreenPixel(fovDeg: number, viewportHeight: number, distance: number): number {
  return (2 * distance * Math.tan((fovDeg * Math.PI) / 360)) / Math.max(1, viewportHeight);
}

/** The base field of view (GameScene's camera). UI sizes are designed
 * against it; transitions that warp the FOV warp the UI along with the
 * world, which is the point. */
export const BASE_FOV = 78;

/** Font-pixel size (world units) that makes a glyph's 7-pixel cap height
 * cover `fraction` of the viewport height at `distance` metres. Sizing by
 * viewport fraction keeps the in-world UI the same proportion of the screen
 * on a phone and a 4K monitor. */
export function pxFor(distance: number, fraction: number): number {
  return (fraction * 2 * distance * Math.tan((BASE_FOV * Math.PI) / 360)) / 7;
}
