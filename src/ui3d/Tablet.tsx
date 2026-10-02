import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  Euler,
} from "three";
import { RoundedBoxGeometry } from "three/examples/jsm/geometries/RoundedBoxGeometry.js";
import { playTabletBreak, playTabletBuild } from "../audio/uiSounds";
import { uiNow } from "./clock";
import { stoneMaterial } from "./materials";
import { slabGeometry } from "./slab";
import { frameFor, holoColor, type FrameKind } from "./theme";
import { UiShow, useUiShow } from "./presence";
import { UiTextStyleProvider } from "./style";
import { emitUiSparks } from "./UiSparks";

/** A tablet: the physical surface every menu is written on.
 *
 * It doesn't fade in — it BUILDS. Fitted stones fly in out of the dark
 * behind it, tumbling, and lock together from the centre outward with a
 * little overshoot; only then do the words write themselves onto the
 * stone. Closing runs it backwards: the words burn off, the stones break
 * loose and fall away.
 *
 * No frame and no square box: the stones are worn round at their edges,
 * the tablet's outline is a rounded slab (the corner stones are left out,
 * the rim's stones sit a little proud or sunk, a little lighter where the
 * torch catches them), and the mortar behind them is rounded too. Its
 * `frame` colour no longer draws a trim; it only tints the light that
 * leaks from the mortar's seams.
 *
 * Visibility comes from the enclosing `<UiPresence>` (presence.tsx), so a
 * menu is simply:
 *
 *   <UiPresence show={phase === "dead"} exit={TABLET_EXIT}>
 *     <ViewAnchor offset={[0, 0, -1.6]}>
 *       <Tablet width={1.1} height={0.8}> …RuneText, RuneButton… </Tablet>
 *     </ViewAnchor>
 *   </UiPresence>
 *
 * Children are placed on the tablet's front face (local z = 0 is the face,
 * origin at its centre) and only become visible once it has assembled. */

/** Seconds a closing tablet needs before it may unmount. */
export const TABLET_EXIT = 1.15;

const FLY = 0.55; // seconds one stone takes to arrive
const SPREAD = 0.3; // centre → rim arrival stagger
const CONTENT_AT = 0.6;

interface Stone {
  target: Vector3;
  scale: Vector3;
  start: Vector3;
  startQ: Quaternion;
  delay: number;
  fallDelay: number;
  fallVel: Vector3;
  spin: Vector3;
  tint: number;
}

function rand(seed: number): number {
  const s = Math.sin(seed * 91.345 + 17.1) * 47453.5453;
  return s - Math.floor(s);
}

/** Signed distance from (x, y) to a rounded rectangle centred on the origin
 * (half extents hw, hh; corner radius cr): negative inside. */
export function roundRectDist(x: number, y: number, hw: number, hh: number, cr: number): number {
  const qx = Math.abs(x) - (hw - cr);
  const qy = Math.abs(y) - (hh - cr);
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - cr;
}

/** The tablet's corner radius. */
export function tabletCorner(width: number, height: number, tile: number): number {
  return Math.min(Math.min(width, height) * 0.22, Math.max(tile * 1.1, Math.min(width, height) * 0.1));
}

function buildStones(width: number, height: number, thickness: number, tile: number, seed: number): Stone[] {
  const cols = Math.max(1, Math.round(width / tile));
  const rows = Math.max(1, Math.round(height / tile));
  const tw = width / cols;
  const th = height / rows;
  const gap = Math.min(tw, th) * 0.025;
  const maxDist = Math.hypot(width / 2, height / 2) || 1;
  const cr = tabletCorner(width, height, tile);
  const stones: Stone[] = [];
  let k = seed * 131;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -width / 2 + tw * (c + 0.5);
      const y = height / 2 - th * (r + 0.5);
      // Rounded outline: a stone whose centre falls outside it is left out
      // (the mortar's rounded corner shows there instead).
      const edge = roundRectDist(x, y, width / 2, height / 2, cr);
      if (edge > -Math.min(tw, th) * 0.35) continue;
      const rim = edge > -Math.min(tw, th) * 1.4;
      const rnd = () => rand(k++);
      const depth = thickness * (rim ? 0.75 + rnd() * 0.5 : 0.85 + rnd() * 0.3);
      const out = new Vector3(x, y, 0).normalize();
      const reach = 0.25 + rnd() * 0.55;
      stones.push({
        target: new Vector3(x, y, -depth / 2 + (rnd() - 0.5) * 0.004),
        scale: new Vector3(tw - gap, th - gap, depth),
        start: new Vector3(x + out.x * reach + (rnd() - 0.5) * 0.3, y + out.y * reach + (rnd() - 0.5) * 0.3, -0.5 - rnd() * 1.1),
        startQ: new Quaternion().setFromEuler(new Euler((rnd() - 0.5) * 3, (rnd() - 0.5) * 3, (rnd() - 0.5) * 3)),
        delay: (Math.hypot(x, y) / maxDist) * SPREAD + rnd() * 0.08,
        fallDelay: 0.12 + rnd() * 0.3,
        fallVel: new Vector3(out.x * (0.2 + rnd() * 0.4), 0.3 + rnd() * 0.5, 0.1 + rnd() * 0.5),
        spin: new Vector3((rnd() - 0.5) * 8, (rnd() - 0.5) * 8, (rnd() - 0.5) * 8),
        tint: (rim ? 0.95 : 0.8) + rnd() * 0.35,
      });
    }
  }
  return stones;
}

/** A back-out ease: arrives, overshoots a touch, settles. */
function backOut(t: number): number {
  const s = 1.4;
  const u = t - 1;
  return 1 + u * u * ((s + 1) * u + s);
}

// ─────────────────────────────────────────────────────────────────────────────

/** A stone: a unit box worn round at every edge. */
const unitStone = new RoundedBoxGeometry(1, 1, 1, 2, 0.07);
const backingMats = new Map<string, MeshStandardMaterial>();
/** The mortar: near-black, with the faintest glow of the tablet's colour
 * leaking from its seams. */
function backingMaterial(glow: string): MeshStandardMaterial {
  let m = backingMats.get(glow);
  if (!m) {
    m = new MeshStandardMaterial({ color: "#0d0a11", roughness: 0.95, emissive: glow, emissiveIntensity: 0 });
    backingMats.set(glow, m);
  }
  return m;
}
const tmpM = new Matrix4();
const tmpP = new Vector3();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpE = new Euler();
const identityQ = new Quaternion();
const tmpColor = new Color();

export interface TabletProps {
  width: number;
  height: number;
  thickness?: number;
  /** Stone size, m (the grid of fitted stones). */
  tile?: number;
  /** Stone tint. */
  tint?: string;
  /** The trim: a named frame (brass, arcane, iron, blood, gold, violet) or
   * any colour. */
  frame?: FrameKind | string;
  /** World size of one frame texel (the trim is 4 texels deep). */
  frameTexel?: number;
  /** Older name for `frame`. */
  accent?: string;
  /** Idle hover bob. */
  float?: boolean;
  /** Lean toward the pointer (menus you click on). */
  tilt?: boolean;
  /** Varies the stone pattern between tablets. */
  seed?: number;
  /** Silent build (e.g. many small tablets at once). */
  quiet?: boolean;
  children?: ReactNode;
}

export function Tablet({
  width,
  height,
  thickness = 0.045,
  tile = 0.13,
  tint = "#3a3342",
  accent,
  frame,
  frameTexel,
  float = true,
  tilt = false,
  seed = 1,
  quiet = false,
  children,
}: TabletProps) {
  const open = useUiShow();
  const stones = useMemo(() => buildStones(width, height, thickness, tile, seed), [width, height, thickness, tile, seed]);
  const mesh = useMemo(() => {
    const m = new InstancedMesh(unitStone, stoneMaterial(tint), stones.length);
    m.frustumCulled = false;
    stones.forEach((s, i) => m.setColorAt(i, tmpColor.setScalar(s.tint)));
    return m;
  }, [stones, tint]);
  // `frame` (or the older `accent`) only colours the seams and the sparks.
  const trim = frame ?? accent ?? "brass";
  const sparkColor = frameFor(trim).light;
  void frameTexel;
  useEffect(
    () => () => {
      mesh.dispose();
    },
    [mesh],
  );

  // Dark mortar behind the stones: the gaps read as depth, not as holes
  // onto the world — a rounded slab, so the corners are round. It grows
  // from the centre as the first stones arrive.
  const backing = useMemo(() => {
    const m = new Mesh(slabGeometry(width * 0.985, height * 0.985, thickness * 0.5, tabletCorner(width, height, tile)), backingMaterial(holoColor(trim)));
    m.position.z = -thickness * 0.3;
    m.scale.set(0.001, 0.001, 1);
    return m;
  }, [width, height, thickness, tile, trim]);
  const group = useRef<Group>(null);
  const tOpen = useRef(uiNow());
  const tClose = useRef<number | null>(open ? null : uiNow() - 10);
  const settled = useRef(false);
  const [contentShown, setContentShown] = useState(false);
  const pointer = useThree((s) => s.pointer);
  const tiltRef = useRef({ x: 0, y: 0 });

  const wasOpen = useRef(open);
  useEffect(() => {
    if (open) {
      tOpen.current = uiNow();
      tClose.current = null;
      settled.current = false;
      if (!quiet) playTabletBuild();
    } else if (wasOpen.current) {
      // Only a tablet that WAS open breaks apart; one mounted hidden (a
      // delayed wing, a closed screen) stays as it is — nothing.
      tClose.current = uiNow();
      settled.current = false;
      setContentShown(false);
      if (!quiet) setTimeout(playTabletBreak, 200);
    }
    wasOpen.current = open;
  }, [open, quiet]);

  useFrame((_, dt) => {
    const now = uiNow();
    const g = group.current;
    if (g) {
      g.position.y = float ? Math.sin(now * 1.3 + seed) * 0.004 : 0;
      const k = 1 - Math.exp(-dt * 5);
      const tx = tilt && open ? -pointer.y * 0.05 : 0;
      const ty = tilt && open ? pointer.x * 0.08 : 0;
      tiltRef.current.x += (tx - tiltRef.current.x) * k;
      tiltRef.current.y += (ty - tiltRef.current.y) * k;
      g.rotation.set(tiltRef.current.x + (float ? Math.sin(now * 0.9 + seed) * 0.006 : 0), tiltRef.current.y, 0);
    }

    const closing = tClose.current !== null;
    const t = closing ? now - tClose.current! : now - tOpen.current;
    if (!closing) {
      if (!contentShown && t >= CONTENT_AT) setContentShown(true);
      if (settled.current) return;
    } else if (settled.current) {
      return;
    }

    // Backing: grows in over the first stones' flight, shrinks as they fall.
    const grow = closing ? Math.max(0, 1 - Math.max(0, t - 0.1) / 0.35) : Math.min(1, Math.max(0, (t - 0.12) / 0.4));
    const eg = 1 - (1 - grow) ** 3;
    backing.scale.set(Math.max(0.001, eg), Math.max(0.001, eg), 1);

    let moving = grow > 0 && grow < 1;
    for (let i = 0; i < stones.length; i++) {
      const s = stones[i]!;
      if (!closing) {
        const p = Math.min(1, Math.max(0, (t - s.delay) / FLY));
        if (p < 1) moving = true;
        if (p <= 0) {
          tmpS.setScalar(0);
          tmpM.compose(s.start, identityQ, tmpS);
        } else {
          const e = backOut(p);
          const eo = 1 - (1 - p) ** 3;
          tmpP.lerpVectors(s.start, s.target, e);
          tmpQ.slerpQuaternions(s.startQ, identityQ, eo);
          tmpS.copy(s.scale).multiplyScalar(0.35 + 0.65 * eo);
          tmpM.compose(tmpP, tmpQ, tmpS);
        }
      } else {
        const q = Math.max(0, t - s.fallDelay);
        if (q < 1.2) moving = true;
        const f = Math.min(1, q / 0.9);
        tmpP.set(
          s.target.x + s.fallVel.x * q,
          s.target.y + s.fallVel.y * q - 2.2 * q * q,
          s.target.z + s.fallVel.z * q,
        );
        tmpE.set(s.spin.x * q * 0.3, s.spin.y * q * 0.3, s.spin.z * q * 0.3);
        tmpQ.setFromEuler(tmpE);
        tmpS.copy(s.scale).multiplyScalar(Math.max(0, 1 - f * f));
        tmpM.compose(tmpP, tmpQ, tmpS);
        // The break sheds a few embers from the rim.
        if (q > 0 && q < dt * 1.5 && Math.random() < 0.5 && g) {
          tmpP.applyMatrix4(g.matrixWorld);
          emitUiSparks({ position: [tmpP.x, tmpP.y, tmpP.z], color: sparkColor, count: 3, speed: 0.2, size: 0.01 });
        }
      }
      mesh.setMatrixAt(i, tmpM);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (!moving) settled.current = true;
  });

  return (
    <group ref={group}>
      <primitive object={backing} />
      <primitive object={mesh} />
      <UiTextStyleProvider value={{ depth: -0.35 }}>
        <group position={[0, 0, 0.003]}>
          <UiShow show={contentShown && open}>{children}</UiShow>
        </group>
      </UiTextStyleProvider>
    </group>
  );
}
