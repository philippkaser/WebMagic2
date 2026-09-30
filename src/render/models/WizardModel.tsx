import { createPortal, useFrame } from "@react-three/fiber";
import { useMemo, type MutableRefObject } from "react";
import {
  BoxGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  Mesh,
  SphereGeometry,
  TorusGeometry,
} from "three";
import { glow, lathe, part, std } from "./kit";
import { StaffModel } from "./StaffModel";

/** A hooded wizard: bell-hemmed robe, cape, deep cowl with nothing inside
 * but two glowing eyes, belt with pouches, and their actual staff in hand.
 * Origin is the body capsule's center (feet at y = -0.9, facing +Z).
 *
 * Animation is driven by a `motion` ref the owner updates each frame —
 * the model itself turns that into walk bob, lean, arm swing, cape flare
 * and a cast thrust, so the owner never touches the rig. */

export interface WizardMotion {
  /** Horizontal speed, m/s. */
  speed: number;
  /** Cast pose weight 0..1 — set to 1 on a cast, the model lets it decay. */
  cast: number;
}

const FEET = -0.9;
const STAFF_SCALE = 1.05;
const STAFF_GRIP = 0.64;

// Shared geometries: every wizard on the floor draws from the same buffers.
const G = {
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
};

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
  cape: Mesh;
  eyes: Mesh[];
}

function buildWizard(robeColor: string, eyeColor: string): Rig {
  const robe = std(robeColor, { tex: "cloth", roughness: 0.95 });
  const robeDark = std(shade(robeColor, 0.55), { tex: "cloth", roughness: 0.95, doubleSide: true });
  const trim = std("#b08a48", { metalness: 0.7, roughness: 0.45 });
  const leather = std("#4a3222", { tex: "leather", roughness: 0.8 });
  const glove = std("#2e221a", { tex: "leather", roughness: 0.8 });
  const void_ = std("#040306", { roughness: 1 });

  const body = new Group();
  body.position.y = FEET;
  body.add(part(G.robe, robe));
  body.add(part(G.hemTrim, robeDark));
  // The cape is authored in body space; hang it from a collar pivot so
  // rotating the pivot flares it about the shoulders.
  const capePivot = new Group();
  capePivot.position.set(0, 1.4, -0.02);
  const cape = part(G.cape, robeDark, [0, -1.4, 0]);
  capePivot.add(cape);
  body.add(capePivot);

  // Belt, buckle, pouches and a glowing vial.
  body.add(part(G.belt, leather, [0, 0.9, 0], [Math.PI / 2, 0, 0], [1, 0.92, 1]));
  body.add(part(G.buckle, trim, [0, 0.9, 0.245]));
  const pouch = (x: number, z: number, ry: number) => {
    const g = new Group();
    g.position.set(x, 0.82, z);
    g.rotation.y = ry;
    g.add(part(G.pouch, leather));
    g.add(part(G.pouchFlap, std("#3a2618", { tex: "leather" }), [0, 0.045, 0.004]));
    return g;
  };
  body.add(pouch(0.2, 0.12, 0.9), pouch(-0.22, 0.06, -1.2));
  body.add(part(G.vial, glow(eyeColor === "#ff6b5a" ? "#c86bff" : "#7fd4ff", 1.8), [-0.14, 0.78, 0.2], [0, 0, 0.2], 1, false));

  // Shoulder mantle over the robe.
  body.add(part(G.mantle, robeDark, [0, 1.38, 0]));

  // Head: cowl, the dark inside, two eyes.
  const head = new Group();
  head.position.set(0, 1.46, 0.02);
  head.add(part(G.face, void_, [0, 0.16, 0.02], [0, 0, 0], [1, 1.1, 0.95], false));
  head.add(part(G.hood, robe, [0, 0, 0], [0.12, 0, 0]));
  head.add(part(G.hoodTip, robe, [0, 0.52, -0.12], [-0.7, 0, 0], [1, 1, 0.8]));
  const eyeMat = glow(eyeColor, 3.4);
  const eyes = [-0.055, 0.055].map((x) => {
    const e = part(G.eye, eyeMat, [x, 0.15, 0.15], [0, 0, x > 0 ? -0.2 : 0.2], 1, false);
    head.add(e);
    return e;
  });
  body.add(head);

  // Arms hang from the shoulders; the right hand carries the staff.
  const arm = (side: 1 | -1) => {
    const g = new Group();
    g.position.set(0.27 * side, 1.34, 0.02);
    g.rotation.z = 0.18 * side;
    g.add(part(G.sleeve, robe));
    g.add(part(G.hand, glove, [0, -0.54, 0.02], [0, 0, 0], [1, 1.2, 1]));
    return g;
  };
  const armL = arm(-1);
  const armR = arm(1);
  const staffSocket = new Group();
  staffSocket.position.set(0, -0.54, 0.03);
  // Keep the staff upright against the arm's resting splay.
  staffSocket.rotation.z = -0.18;
  armR.add(staffSocket);
  body.add(armL, armR);

  const root = new Group();
  root.add(body);
  return { root, body, head, armL, armR, staffSocket, cape, eyes };
}

export function WizardModel({
  robeColor,
  eyeColor = "#bfe8ff",
  staffId,
  motion,
}: {
  robeColor: string;
  /** Allies' eyes burn green, strangers' red — read at a glance. */
  eyeColor?: string;
  staffId: string;
  motion?: MutableRefObject<WizardMotion>;
}) {
  const rig = useMemo(() => buildWizard(robeColor, eyeColor), [robeColor, eyeColor]);
  const anim = useMemo(() => ({ phase: 0, stride: 0, blink: 3 + Math.random() * 3 }), []);

  useFrame(({ clock }, dt) => {
    const m = motion?.current;
    const t = clock.elapsedTime;
    const speed = m?.speed ?? 0;
    const stride = Math.min(speed / 7, 1);
    anim.stride += (stride - anim.stride) * Math.min(1, dt * 6);
    const s = anim.stride;
    anim.phase += dt * (1.5 + speed * 1.25);
    const cast = m ? (m.cast = Math.max(0, m.cast - dt * 2.2)) : 0;
    const castPose = Math.sin(Math.min(cast, 1) * Math.PI * 0.5);

    const { body, head, armL, armR, staffSocket, cape, eyes } = rig;
    body.position.y = FEET + Math.abs(Math.sin(anim.phase)) * 0.05 * s + Math.sin(t * 1.7) * 0.006;
    body.rotation.x = s * 0.13 - castPose * 0.06;
    body.rotation.z = Math.sin(anim.phase) * 0.035 * s;
    head.rotation.x = Math.sin(t * 0.9) * 0.04 - s * 0.08;
    head.rotation.y = Math.sin(t * 0.37) * 0.12 * (1 - s);
    armL.rotation.x = Math.sin(anim.phase) * 0.4 * s;
    // Cast: the staff arm swings up and forward, hoisting the staff aloft
    // with its head canted toward the target.
    armR.rotation.x = -Math.sin(anim.phase) * 0.18 * s - castPose * 1.7;
    staffSocket.rotation.x = castPose * 1.25;
    cape.parent!.rotation.x = 0.06 + s * 0.38 + Math.sin(t * 2.1 + anim.phase) * 0.03 * (0.3 + s);

    // Occasional blink.
    anim.blink -= dt;
    const shut = anim.blink < 0.12;
    if (anim.blink < 0) anim.blink = 2.5 + Math.random() * 4;
    for (const e of eyes) e.scale.y = shut ? 0.15 : 1;
  });

  return (
    <>
      <primitive object={rig.root} />
      {createPortal(
        <group position={[0, -STAFF_GRIP * STAFF_SCALE, 0]} scale={STAFF_SCALE}>
          <StaffModel key={staffId} defId={staffId} />
        </group>,
        rig.staffSocket,
      )}
    </>
  );
}
