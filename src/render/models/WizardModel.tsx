import { createPortal, useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import {
  AdditiveBlending,
  BackSide,
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  OctahedronGeometry,
  RingGeometry,
  SphereGeometry,
  TorusGeometry,
  Vector3,
} from "three";
import { glow, lathe, part, std } from "./modelKit";
import { shared } from "./shared";
import { StaffModel, staffKindForColor } from "./StaffModel";

/** THE wizard body: a hooded wizard — bell-hemmed robe with a ragged hem,
 * cape, shoulder mantle, a deep cowl with nothing inside but two glowing
 * eyes, belt with pouches and a glowing vial, and their actual staff in hand.
 * One component renders both the remote wizards on shared floors and your
 * own figure on the inventory shrine, so "what a wizard looks like" has
 * exactly one definition. Grave light takes the robe colour too
 * (game/wizardLook), so a fallen wizard's grave glows in what they wore.
 *
 * Origin is the body capsule's centre (the robe's hem at y = −0.85, facing
 * +Z). The root is a single group on purpose: RemoteWizards bobs
 * `children[0]` of its own group — this root — for its walk cycle.
 *
 * The model animates itself: it measures how fast its root moves through
 * the world and turns that into stride bob, lean, arm swing and cape flare,
 * with breathing and blinking at rest; `cast` (optional ref) raises the
 * staff arm. Allocation-free per frame. */

export interface WizardMotion {
  /** Cast pose weight 0..1 — set to 1 on a cast, the model lets it decay. */
  cast: number;
}

const FEET = -0.85;
const STAFF_SCALE = 1.05;
const STAFF_GRIP = 0.64;

// Shared geometries: every wizard on the floor draws from the same buffers.
const G = shared(() => ({
  robe: jaggedHem(
    lathe(
      [
        [0.0, 0.0],
        [0.44, 0.0],
        [0.4, 0.2],
        [0.3, 0.62],
        [0.25, 0.9],
        [0.27, 1.14],
        [0.25, 1.3],
        [0.16, 1.42],
        [0.08, 1.47],
      ],
      9,
    ),
  ),
  hemTrim: lathe(
    [
      [0.45, 0.0],
      [0.43, 0.09],
    ],
    9,
  ),
  cape: lathe(
    [
      [0.21, 1.4],
      [0.3, 1.25],
      [0.38, 0.7],
      [0.48, 0.08],
    ],
    6,
    Math.PI * 0.62,
    Math.PI * 0.76,
  ),
  belt: new TorusGeometry(0.26, 0.03, 4, 10),
  buckle: new BoxGeometry(0.08, 0.07, 0.03),
  pouch: new BoxGeometry(0.1, 0.11, 0.07),
  pouchFlap: new BoxGeometry(0.105, 0.04, 0.075),
  vial: new CylinderGeometry(0.022, 0.028, 0.09, 5),
  // Cowl: a lathed shell open at the front (phi 0 = +Z).
  hood: lathe(
    [
      [0.0, 0.5],
      [0.07, 0.44],
      [0.15, 0.36],
      [0.2, 0.24],
      [0.21, 0.1],
      [0.19, -0.02],
      [0.22, -0.08],
    ],
    9,
    0.62,
    Math.PI * 2 - 1.24,
  ),
  hoodTip: new ConeGeometry(0.1, 0.3, 6),
  face: new SphereGeometry(0.16, 7, 5),
  eye: new BoxGeometry(0.045, 0.03, 0.02),
  mantle: lathe(
    [
      [0.1, 0.1],
      [0.24, -0.02],
      [0.29, -0.12],
    ],
    9,
  ),
  sleeve: lathe(
    [
      [0.06, 0.02],
      [0.08, -0.1],
      [0.1, -0.34],
      [0.15, -0.52],
    ],
    7,
  ),
  hand: new SphereGeometry(0.055, 5, 4),
  chain: new TorusGeometry(0.13, 0.008, 3, 12),
  gem: new OctahedronGeometry(0.05),
  bootToe: new ConeGeometry(0.06, 0.2, 6),
  auraRing: new RingGeometry(0.52, 0.68, 24),
  auraShell: new SphereGeometry(1, 12, 10),
}));

/** Tattered hem: nudge the bottom ring of the robe up and down per vertex. */
function jaggedHem<T extends Mesh["geometry"]>(geo: T): T {
  const pos = geo.getAttribute("position");
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0.25) continue;
    const a = Math.atan2(pos.getX(i), pos.getZ(i));
    const w = 1 - y / 0.25;
    pos.setY(i, y + (Math.sin(a * 5) * 0.5 + Math.sin(a * 11 + 1.3) * 0.5) * 0.035 * w);
  }
  geo.computeVertexNormals();
  return geo;
}

function shade(hex: string, k: number): string {
  return `#${new Color(hex).multiplyScalar(k).getHexString()}`;
}

interface Rig {
  root: Group;
  body: Group;
  head: Group;
  armL: Group;
  armR: Group;
  staffSocket: Group;
  capePivot: Group;
  eyes: Mesh[];
}

function buildWizard(o: {
  robeColor: string;
  eyeColor: string;
  vialColor: string;
  bootsColor: string | null;
  amuletColor: string | null;
  castShadow: boolean;
}): Rig {
  const g = G();
  const robe = std(o.robeColor, { tex: "cloth", roughness: 0.95 });
  const robeDark = std(shade(o.robeColor, 0.55), { tex: "cloth", roughness: 0.95, doubleSide: true });
  const trim = std("#b08a48", { metalness: 0.7, roughness: 0.45 });
  const leather = std("#4a3222", { tex: "leather", roughness: 0.8 });
  const glove = std("#2e221a", { tex: "leather", roughness: 0.8 });
  const void_ = std("#040306", { roughness: 1 });

  const body = new Group();
  body.position.y = FEET;
  body.add(part(g.robe, robe));
  body.add(part(g.hemTrim, robeDark));
  // The cape is authored in body space; hang it from a collar pivot so
  // rotating the pivot flares it about the shoulders.
  const capePivot = new Group();
  capePivot.position.set(0, 1.4, -0.02);
  capePivot.add(part(g.cape, robeDark, [0, -1.4, 0]));
  body.add(capePivot);

  // Belt, buckle, pouches and a glowing vial.
  body.add(part(g.belt, leather, [0, 0.9, 0], [Math.PI / 2, 0, 0], [1, 0.92, 1]));
  body.add(part(g.buckle, trim, [0, 0.9, 0.245]));
  const flap = std("#3a2618", { tex: "leather" });
  const pouch = (x: number, z: number, ry: number) => {
    const p = new Group();
    p.position.set(x, 0.82, z);
    p.rotation.y = ry;
    p.add(part(g.pouch, leather));
    p.add(part(g.pouchFlap, flap, [0, 0.045, 0.004]));
    return p;
  };
  body.add(pouch(0.2, 0.12, 0.9), pouch(-0.22, 0.06, -1.2));
  body.add(part(g.vial, glow(o.vialColor, 1.8), [-0.14, 0.78, 0.2], [0, 0, 0.2], 1, false));

  // Shoulder mantle over the robe.
  body.add(part(g.mantle, robeDark, [0, 1.38, 0]));

  // An amulet on its chain, its stone burning on the chest.
  if (o.amuletColor) {
    body.add(part(g.chain, trim, [0, 1.3, 0.14], [1.25, 0, 0], [1, 1.35, 1], false));
    body.add(part(g.gem, glow(o.amuletColor, 2.6), [0, 1.17, 0.27], [0, 0, 0], [1, 1.3, 0.7], false));
  }
  // Curled boot toes peeking out from under the hem.
  if (o.bootsColor) {
    const boot = std(shade(o.bootsColor, 0.8), { tex: "leather", roughness: 0.8 });
    for (const x of [-0.14, 0.14]) body.add(part(g.bootToe, boot, [x, 0.05, 0.38], [1.35, 0, 0], [1, 1, 0.7]));
  }

  // Head: cowl, the dark inside, two eyes.
  const head = new Group();
  head.position.set(0, 1.46, 0.02);
  head.add(part(g.face, void_, [0, 0.16, 0.02], [0, 0, 0], [1, 1.1, 0.95], false));
  head.add(part(g.hood, robe, [0, 0, 0], [0.12, 0, 0]));
  head.add(part(g.hoodTip, robe, [0, 0.52, -0.12], [-0.7, 0, 0], [1, 1, 0.8]));
  const eyeMat = glow(o.eyeColor, 3.4);
  const eyes = [-0.055, 0.055].map((x) => {
    const e = part(g.eye, eyeMat, [x, 0.15, 0.15], [0, 0, x > 0 ? -0.2 : 0.2], 1, false);
    head.add(e);
    return e;
  });
  body.add(head);

  // Arms hang from the shoulders; the right hand carries the staff.
  const arm = (side: 1 | -1) => {
    const a = new Group();
    a.position.set(0.27 * side, 1.34, 0.02);
    a.rotation.z = 0.18 * side;
    a.add(part(g.sleeve, robe));
    a.add(part(g.hand, glove, [0, -0.54, 0.02], [0, 0, 0], [1, 1.2, 1]));
    return a;
  };
  const armL = arm(-1);
  const armR = arm(1);
  const staffSocket = new Group();
  staffSocket.position.set(0, -0.54, 0.03);
  // Keep the staff upright against the arm's resting splay.
  staffSocket.rotation.z = -0.18;
  armR.add(staffSocket);
  body.add(armL, armR);

  body.traverse((n) => {
    if (n instanceof Mesh && n.castShadow) n.castShadow = o.castShadow;
  });

  const root = new Group();
  root.add(body);
  return { root, body, head, armL, armR, staffSocket, capePivot, eyes };
}

const lastPos = new Vector3();

export function WizardModel({
  robeColor,
  staffColor,
  staffId,
  bootsColor,
  amuletColor,
  castShadow = false,
  aura = null,
  eyeColor = "#bfe8ff",
  motion,
}: {
  robeColor: string;
  /** The staff crystal's colour; picks the staff model when `staffId` is
   * not given (every staff burns its own colour). */
  staffColor: string;
  /** The exact staff item to hold, when known. */
  staffId?: string;
  /** Omit for bare feet under the hem (remote wizards). */
  bootsColor?: string | null;
  amuletColor?: string | null;
  castShadow?: boolean;
  /** A soft halo in this color (e.g. marking a pact ally). Null/omitted = none. */
  aura?: string | null;
  eyeColor?: string;
  /** Optional cast pose driver (see WizardMotion). */
  motion?: { current: WizardMotion };
}) {
  const rig = useMemo(
    () =>
      buildWizard({
        robeColor,
        eyeColor,
        vialColor: staffColor,
        bootsColor: bootsColor ?? null,
        amuletColor: amuletColor ?? null,
        castShadow,
      }),
    [robeColor, eyeColor, staffColor, bootsColor, amuletColor, castShadow],
  );
  const staff = staffId ?? staffKindForColor(staffColor);
  const auraRing = useRef<MeshBasicMaterial>(null);
  const auraShell = useRef<MeshBasicMaterial>(null);
  // Desync idle motion between wizards standing together.
  const anim = useMemo(
    () => ({ phase: Math.random() * 10, stride: 0, blink: 3 + Math.random() * 3, speed: 0, pos: new Vector3(), init: false }),
    [],
  );
  useEffect(() => {
    anim.init = false;
  }, [anim, rig]);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime + anim.phase;
    // How fast are we really going? (Remote poses and shrine turns alike.)
    rig.root.getWorldPosition(lastPos);
    if (anim.init && dt > 0) {
      const dx = lastPos.x - anim.pos.x;
      const dz = lastPos.z - anim.pos.z;
      const v = Math.min(12, Math.hypot(dx, dz) / dt);
      anim.speed += (v - anim.speed) * Math.min(1, dt * 8);
    }
    anim.pos.copy(lastPos);
    anim.init = true;

    const speed = anim.speed;
    const stride = Math.min(speed / 7, 1);
    anim.stride += (stride - anim.stride) * Math.min(1, dt * 6);
    const s = anim.stride;
    anim.phase += dt * (speed * 1.25);
    const walk = t * 1.5 + anim.phase;
    const m = motion?.current;
    const cast = m ? (m.cast = Math.max(0, m.cast - dt * 2.2)) : 0;
    const castPose = Math.sin(Math.min(cast, 1) * Math.PI * 0.5);

    const { body, head, armL, armR, staffSocket, capePivot, eyes } = rig;
    body.position.y = FEET + Math.abs(Math.sin(walk)) * 0.05 * s + Math.sin(t * 1.7) * 0.006;
    body.rotation.x = s * 0.13 - castPose * 0.06;
    body.rotation.z = Math.sin(walk) * 0.035 * s;
    head.rotation.x = Math.sin(t * 0.9) * 0.04 - s * 0.08;
    head.rotation.y = Math.sin(t * 0.37) * 0.12 * (1 - s);
    armL.rotation.x = Math.sin(walk) * 0.4 * s;
    // Cast: the staff arm swings up and forward, hoisting the staff aloft
    // with its head canted toward the target.
    armR.rotation.x = -Math.sin(walk) * 0.18 * s - castPose * 1.7;
    staffSocket.rotation.x = castPose * 1.25;
    capePivot.rotation.x = 0.06 + s * 0.38 + Math.sin(t * 2.1 + walk) * 0.03 * (0.3 + s);

    // Occasional blink.
    anim.blink -= dt;
    const shut = anim.blink < 0.12;
    if (anim.blink < 0) anim.blink = 2.5 + Math.random() * 4;
    for (const e of eyes) e.scale.y = shut ? 0.15 : 1;

    if (auraRing.current) auraRing.current.opacity = 0.42 + Math.sin(t * 2.4) * 0.14;
    if (auraShell.current) auraShell.current.opacity = 0.08 + Math.sin(t * 2.4) * 0.03;
  });

  const g = G();
  return (
    <group>
      <primitive object={rig.root} />
      {createPortal(
        <group position={[0, -STAFF_GRIP * STAFF_SCALE, 0]} scale={STAFF_SCALE}>
          <StaffModel key={staff} itemId={staff} shadows={castShadow} />
        </group>,
        rig.staffSocket,
      )}
      {/* Aura: a breathing ring at the feet and a faint additive haze. The
          haze is back-faces only, so it glows around the silhouette rather
          than fogging the wizard's front. */}
      {aura && (
        <>
          <mesh geometry={g.auraRing} position={[0, FEET + 0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
            <meshBasicMaterial
              ref={auraRing}
              color={aura}
              transparent
              opacity={0.42}
              blending={AdditiveBlending}
              depthWrite={false}
              side={DoubleSide}
              toneMapped={false}
            />
          </mesh>
          <mesh geometry={g.auraShell} position={[0, 0.2, 0]} scale={[0.62, 1.2, 0.62]}>
            <meshBasicMaterial
              ref={auraShell}
              color={aura}
              transparent
              opacity={0.08}
              blending={AdditiveBlending}
              depthWrite={false}
              side={BackSide}
              toneMapped={false}
            />
          </mesh>
        </>
      )}
    </group>
  );
}
