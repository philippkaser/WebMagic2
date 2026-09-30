import { useFrame, useThree } from "@react-three/fiber";
import { createContext, useContext, useMemo, useRef, type ReactNode } from "react";
import type { Group } from "three";
import { BASE_FOV, ViewAnchor } from "../../anchors";
import { useUiShow } from "../../presence";
import { edgeSpot, screenToWorld, tanHalf, undistortion } from "./frame";

/** How HUD pieces hang in front of the eye.
 *
 *  - `<HudAnchor h v inset distance>` carries a piece at a screen edge or
 *    corner (placed by the real viewport aspect, sized by its height), with
 *    a stiffer, shorter lag than a plain ViewAnchor so corner pieces never
 *    swing off screen on a flick. While the HUD is stepped back (an overlay
 *    screen is open) the piece sinks toward its edge and away from the eye.
 *  - `<Undistort at>` wraps a SOLID object (flask, coin heap, item) so the
 *    wide field of view doesn't stretch it into an egg at the corners —
 *    see frame.ts#undistortion. Text never needs it: flat and parallel to
 *    the screen, it projects true.
 *  - `hudUnit(distance)` is one screen height in metres at that distance:
 *    lay pieces out in screen-height fractions × hudUnit and they keep their
 *    proportions whatever the display. */

export const HUD_TAN = tanHalf(BASE_FOV);

/** Metres spanned by the full screen height at `distance`. */
export function hudUnit(distance: number): number {
  return screenToWorld(1, distance, HUD_TAN);
}

/** The viewport's aspect ratio (re-renders on resize only). */
export function useViewAspect(): number {
  const size = useThree((s) => s.size);
  return size.width / Math.max(1, size.height);
}

type Vec3 = readonly [number, number, number];

/** The anchor's view-space offset, for Undistort below it. */
const SpotContext = createContext<Vec3>([0, 0, -1]);

export function HudAnchor({
  h,
  v,
  inset = [0, 0],
  distance,
  follow = 22,
  maxLagDeg = 2,
  children,
}: {
  h: -1 | 0 | 1;
  v: -1 | 0 | 1;
  /** From the chosen edge toward the centre, in screen-height fractions. */
  inset?: readonly [number, number];
  distance: number;
  follow?: number;
  maxLagDeg?: number;
  children: ReactNode;
}) {
  const aspect = useViewAspect();
  const offset = useMemo(
    () => edgeSpot(h, v, inset[0], inset[1], distance, aspect, HUD_TAN),
    [h, v, inset, distance, aspect],
  );
  return (
    <ViewAnchor offset={offset} follow={follow} maxLagDeg={maxLagDeg}>
      <SpotContext.Provider value={offset}>
        <StepBack distance={distance} toward={v === 0 ? -1 : v}>
          {children}
        </StepBack>
      </SpotContext.Provider>
    </ViewAnchor>
  );
}

/** Sinks the piece toward its edge (`toward` = -1 down, 1 up) and away while
 * the HUD is hidden, and brings it back when it returns — so a stepped-back
 * HUD visibly RETREATS rather than merely fading. */
function StepBack({ distance, toward, children }: { distance: number; toward: number; children: ReactNode }) {
  const shown = useUiShow();
  const group = useRef<Group>(null);
  const k = useRef(shown ? 0 : 1);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const target = shown ? 0 : 1;
    if (Math.abs(target - k.current) < 1e-4) {
      k.current = target;
    } else {
      k.current += (target - k.current) * (1 - Math.exp(-dt * (shown ? 7 : 3.2)));
    }
    const e = k.current * k.current;
    g.position.set(0, toward * e * 0.05 * distance, -e * 0.3 * distance);
  });
  return <group ref={group}>{children}</group>;
}

/** Keeps a solid object round wherever it sits on screen (frame.ts). The
 * four nested rotations realize a squash along one 3D direction without the
 * shear three.js's TRS transforms can't express. */
export function Undistort({ at = [0, 0, 0], children }: { at?: Vec3; children: ReactNode }) {
  const spot = useContext(SpotContext);
  const u = useMemo(() => undistortion(spot[0] + at[0], spot[1] + at[1], spot[2] + at[2]), [spot, at]);
  return (
    <group position={at as [number, number, number]}>
      <group rotation={[0, 0, u.angle]}>
        <group rotation={[0, -u.tilt, 0]}>
          <group scale={[u.squash, 1, 1]}>
            <group rotation={[0, u.tilt, 0]}>
              <group rotation={[0, 0, -u.angle]}>{children}</group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}
