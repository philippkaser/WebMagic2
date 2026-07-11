import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { CanvasTexture, Group, LinearFilter, Sprite, SpriteMaterial } from "three";
import { hashSeed } from "../core/rng";
import { getItemDef } from "../items/catalog";
import { WizardModel } from "../render/WizardModel";
import { netClock } from "./clock";
import { INTERP_DELAY_MS } from "./entities";
import { peerIds, peerName, peerStaffId, samplePeer } from "./players";
import { makeSampledPose } from "./snapshots";

/** Name tags as canvas sprites — no font downloads, fits the pixel look. */
const nameTagCache = new Map<string, SpriteMaterial>();

function nameTagMaterial(name: string): SpriteMaterial {
  const hit = nameTagCache.get(name);
  if (hit) return hit;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 48;
  const ctx = canvas.getContext("2d")!;
  ctx.font = "bold 26px 'Courier New', monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  const width = Math.min(ctx.measureText(name).width + 22, 250);
  ctx.fillRect(128 - width / 2, 6, width, 36);
  ctx.fillStyle = "#e8dfc8";
  ctx.fillText(name, 128, 25);
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  const material = new SpriteMaterial({ map: texture, depthWrite: false, transparent: true });
  nameTagCache.set(name, material);
  return material;
}

/** Renders the other wizards sharing this floor instance. Poses come from the
 * net layer's timestamped buffers, sampled ~140 ms in the past — smooth
 * motion at any packet jitter. With the loopback transport this renders
 * nothing — it lights up as soon as a real server is plugged in. */
export function RemoteWizards() {
  const [ids, setIds] = useState<string[]>([]);
  const pollClock = useRef(0);

  useFrame((_, dt) => {
    pollClock.current -= dt;
    if (pollClock.current > 0) return;
    pollClock.current = 0.5;
    const fresh = peerIds();
    setIds((prev) =>
      prev.length === fresh.length && prev.every((id, i) => id === fresh[i]) ? prev : fresh,
    );
  });

  return (
    <>
      {ids.map((id) => (
        <RemoteWizard key={id} playerId={id} />
      ))}
    </>
  );
}

const ROBE_COLORS = ["#3d5a8a", "#6a3d8a", "#8a3d50", "#3d8a5f"];

function RemoteWizard({ playerId }: { playerId: string }) {
  const group = useRef<Group>(null);
  const tag = useRef<Sprite>(null);
  const lastName = useRef("");
  const robeColor = ROBE_COLORS[hashSeed(playerId) % ROBE_COLORS.length];
  const bobT = useMemo(() => ({ t: 0 }), []);
  const pose = useMemo(() => makeSampledPose(), []);
  const staffColor = () => {
    try {
      const staffId = peerStaffId(playerId);
      return staffId ? getItemDef(staffId).color : "#7fd4ff";
    } catch {
      return "#7fd4ff";
    }
  };

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    // Hidden until their first pose arrives — no interpolating up from the void.
    const known = samplePeer(playerId, netClock.serverNow() - INTERP_DELAY_MS, pose);
    g.visible = known;
    if (!known) return;
    g.position.set(pose.p[0], pose.p[1], pose.p[2]);
    if (pose.a) g.rotation.y = pose.a[0];

    // Little walk bob scaled by how fast they're moving (children[0] = body).
    const speed = Math.hypot(pose.v[0], pose.v[2]);
    bobT.t += dt * Math.min(speed, 10);
    g.children[0].position.y = Math.abs(Math.sin(bobT.t * 1.4)) * Math.min(speed * 0.012, 0.06);

    // Keep the name tag fresh (peers can arrive before their hello lands).
    const name = peerName(playerId);
    if (tag.current && name && name !== lastName.current) {
      lastName.current = name;
      tag.current.material = nameTagMaterial(name);
    }
  });

  return (
    <group ref={group} visible={false}>
      {/* Body first: the walk bob targets children[0]. */}
      <WizardModel robeColor={robeColor} staffColor={staffColor()} castShadow />
      {/* Name tag */}
      <sprite ref={tag} position={[0, 1.85, 0]} scale={[1.6, 0.3, 1]} material={nameTagMaterial("…")} />
    </group>
  );
}
