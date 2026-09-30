import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BoxGeometry,
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
import { playTabletBreak, playTabletBuild } from "../audio/uiSounds";
import { uiNow } from "./clock";
import { stoneMaterial } from "./materials";
import { PixelFrame } from "./PixelFrame";
import { frameFor, type FrameKind } from "./theme";
import { UiShow, useUiShow } from "./presence";
import { UiTextStyleProvider } from "./style";
import { emitUiSparks } from "./UiSparks";

/** A tablet: the physical surface every menu is written on.
 *
 * It doesn't fade in — it BUILDS. Fitted stones fly in out of the dark
 * behind it, tumbling, and lock together from the centre outward with a
 * little overshoot; then its brass trim (PixelFrame) forges itself around
 * the rim from the bottom, both ways, meeting at the top; only then do the
 * words write themselves onto the stone. Closing runs it backwards: the words burn off,
 * the stones break loose and fall away.
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
const RIM_START = 0.35;
const RIM_TIME = 0.55;
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

function buildStones(width: number, height: number, thickness: number, tile: number, seed: number): Stone[] {
  const cols = Math.max(1, Math.round(width / tile));
  const rows = Math.max(1, Math.round(height / tile));
  const tw = width / cols;
  const th = height / rows;
  const gap = Math.min(tw, th) * 0.02;
  const maxDist = Math.hypot(width / 2, height / 2) || 1;
  const stones: Stone[] = [];
  let k = seed * 131;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -width / 2 + tw * (c + 0.5);
      const y = height / 2 - th * (r + 0.5);
      const rnd = () => rand(k++);
      const depth = thickness * (0.85 + rnd() * 0.3);
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
        tint: 0.8 + rnd() * 0.35,
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

const unitBox = new BoxGeometry(1, 1, 1);
let backingMat: MeshStandardMaterial | null = null;
function backingMaterial(): MeshStandardMaterial {
  return (backingMat ??= new MeshStandardMaterial({ color: "#0d0a11", roughness: 0.95 }));
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
  /** Rune channel colour. */
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
    const m = new InstancedMesh(unitBox, stoneMaterial(tint), stones.length);
    m.frustumCulled = false;
    stones.forEach((s, i) => m.setColorAt(i, tmpColor.setScalar(s.tint)));
    return m;
  }, [stones, tint]);
  // The trim: `frame` wins; older callers pass an `accent` colour.
  const trim = frame ?? accent ?? "brass";
  const sparkColor = frameFor(trim).light;
  const texel = frameTexel ?? Math.min(0.0065, Math.min(width, height) * 0.03);
  const forge = useRef(0);
  const fade = useRef(1);
  useEffect(
    () => () => {
      mesh.dispose();
    },
    [mesh],
  );

  // Dark mortar behind the stones: the gaps read as depth, not as holes
  // onto the world. It grows from the centre as the first stones arrive.
  const backing = useMemo(() => {
    const m = new Mesh(unitBox, backingMaterial());
    m.position.z = -thickness * 0.55;
    m.scale.set(0.001, 0.001, thickness * 0.5);
    return m;
  }, [thickness]);
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
      forge.current = Math.min(1, Math.max(0, (t - RIM_START) / RIM_TIME));
      fade.current = 1;
      if (!contentShown && t >= CONTENT_AT) setContentShown(true);
      if (settled.current) return;
    } else {
      fade.current = Math.max(0, 1 - t * 3);
      if (settled.current) return;
    }

    // Backing: grows in over the first stones' flight, shrinks as they fall.
    const grow = closing ? Math.max(0, 1 - Math.max(0, t - 0.1) / 0.35) : Math.min(1, Math.max(0, (t - 0.12) / 0.4));
    const eg = 1 - (1 - grow) ** 3;
    backing.scale.set(Math.max(0.001, width * 0.98 * eg), Math.max(0.001, height * 0.98 * eg), thickness * 0.5);

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
      <PixelFrame
        width={width + texel * 2}
        height={height + texel * 2}
        frame={trim}
        texel={texel}
        progressRef={forge}
        fadeRef={fade}
        position={[0, 0, 0.004]}
      />
      <UiTextStyleProvider value={{ depth: -0.35 }}>
        <group position={[0, 0, 0.003]}>
          <UiShow show={contentShown && open}>{children}</UiShow>
        </group>
      </UiTextStyleProvider>
    </group>
  );
}
