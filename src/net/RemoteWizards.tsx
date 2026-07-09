import { useFrame } from "@react-three/fiber";
import { useRef, useState } from "react";
import { Group } from "three";
import { hashSeed } from "../core/rng";
import { getItemDef } from "../items/catalog";
import { session } from "./session";

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
  const robeColor = ROBE_COLORS[hashSeed(playerId) % ROBE_COLORS.length];
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
    const k = Math.min(1, dt * 12);
    g.position.x += (peer.position.x - g.position.x) * k;
    g.position.y += (peer.position.y - g.position.y) * k;
    g.position.z += (peer.position.z - g.position.z) * k;
    let dyaw = peer.yaw - g.rotation.y;
    dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
    g.rotation.y += dyaw * k;
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
