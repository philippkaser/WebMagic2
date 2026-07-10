import { useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState } from "react";
import { CanvasTexture, Group, LinearFilter, Sprite, SpriteMaterial } from "three";
import { hashSeed } from "../core/rng";
import { getItemDef } from "../items/catalog";
import { session } from "./session";

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

/** Renders the other wizards sharing this floor instance. Membership comes
 * from the session peer map (kept fresh by server snapshots); positions are
 * smoothed toward the latest snapshot. With the loopback transport this
 * renders nothing — it lights up as soon as a real server is plugged in. */
export function RemoteWizards() {
  const [peerIds, setPeerIds] = useState<string[]>([]);
  const pollClock = useRef(0);

  useFrame((_, dt) => {
    pollClock.current -= dt;
    if (pollClock.current > 0) return;
    pollClock.current = 0.5;
    const ids = [...session.peers.keys()].filter((id) => id !== session.playerId);
    setPeerIds((prev) =>
      prev.length === ids.length && prev.every((id, i) => id === ids[i]) ? prev : ids,
    );
  });

  return (
    <>
      {peerIds.map((id) => (
        <RemoteWizard key={id} playerId={id} />
      ))}
    </>
  );
}

const ROBE_COLORS = ["#3d5a8a", "#6a3d8a", "#8a3d50", "#3d8a5f"];

function RemoteWizard({ playerId }: { playerId: string }) {
  const group = useRef<Group>(null);
  const tag = useRef<Sprite>(null);
  const initialized = useRef(false);
  const lastName = useRef("");
  const robeColor = ROBE_COLORS[hashSeed(playerId) % ROBE_COLORS.length];
  const bobT = useMemo(() => ({ t: 0 }), []);
  const staffColor = () => {
    const peer = session.peers.get(playerId);
    try {
      return peer ? getItemDef(peer.staffId).color : "#7fd4ff";
    } catch {
      return "#7fd4ff";
    }
  };

  useFrame((_, dt) => {
    const g = group.current;
    const peer = session.peers.get(playerId);
    if (!g || !peer) return;
    // Placeholder until their first broadcast: keep them hidden below the
    // world instead of interpolating up from the void.
    const known = peer.position.y > -100;
    g.visible = known;
    if (!known) return;
    if (!initialized.current) {
      initialized.current = true;
      g.position.set(peer.position.x, peer.position.y, peer.position.z);
      g.rotation.y = peer.yaw;
      return;
    }
    const k = Math.min(1, dt * 12);
    const dx = peer.position.x - g.position.x;
    const dz = peer.position.z - g.position.z;
    g.position.x += dx * k;
    g.position.y += (peer.position.y - g.position.y) * k;
    g.position.z += dz * k;
    let dyaw = peer.yaw - g.rotation.y;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    g.rotation.y += dyaw * k;

    // Little walk bob scaled by how fast they're moving.
    const speed = Math.hypot(dx, dz) / Math.max(dt, 0.001);
    bobT.t += dt * Math.min(speed, 10);
    g.children[0].position.y = -0.1 + Math.abs(Math.sin(bobT.t * 1.4)) * Math.min(speed * 0.01, 0.06);

    // Keep the name tag fresh (peers can arrive before their hello lands).
    if (tag.current && peer.name !== lastName.current) {
      lastName.current = peer.name;
      tag.current.material = nameTagMaterial(peer.name);
    }
  });

  return (
    <group ref={group}>
      {/* Robe */}
      <mesh position={[0, -0.1, 0]} castShadow>
        <coneGeometry args={[0.45, 1.5, 8]} />
        <meshStandardMaterial color={robeColor} roughness={0.85} />
      </mesh>
      {/* Head */}
      <mesh position={[0, 0.8, 0]} castShadow>
        <sphereGeometry args={[0.22, 10, 8]} />
        <meshStandardMaterial color="#d8b894" roughness={0.8} />
      </mesh>
      {/* Hat */}
      <mesh position={[0, 1.12, 0]} castShadow>
        <coneGeometry args={[0.32, 0.62, 8]} />
        <meshStandardMaterial color={robeColor} roughness={0.9} />
      </mesh>
      {/* Name tag */}
      <sprite ref={tag} position={[0, 1.85, 0]} scale={[1.6, 0.3, 1]} material={nameTagMaterial("…")} />
      {/* Staff */}
      <group position={[0.42, 0.1, 0.1]} rotation={[0, 0, -0.12]}>
        <mesh>
          <cylinderGeometry args={[0.03, 0.04, 1.5, 6]} />
          <meshStandardMaterial color="#4a3526" roughness={0.85} />
        </mesh>
        <mesh position={[0, 0.85, 0]}>
          <octahedronGeometry args={[0.09]} />
          <meshStandardMaterial
            color="#0a0a12"
            emissive={staffColor()}
            emissiveIntensity={2}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  );
}
