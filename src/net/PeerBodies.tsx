import { useFrame } from "@react-three/fiber";
import {
  CapsuleCollider,
  interactionGroups,
  RigidBody,
  type RapierRigidBody,
} from "@react-three/rapier";
import { useRef, useState } from "react";
import { GROUPS, PLAYER } from "../core/config";
import { isHostileWizard } from "../game/hostility";
import { WIZARD_GROUPS } from "../sim/bodies";
import { estimatePeer, peerIds } from "./players";

/** Physical presence for the other wizards on the floor.
 *
 * A kinematic capsule per peer, driven by the freshest extrapolated pose.
 * This is why remote players can shove crates and body-block wisps: the
 * capsule pushes the AUTHORITY's dynamic bodies on the host's machine (and
 * everyone's predicted replicas locally), so a joined player's contact
 * physics exists in the simulation that matters — not just on their screen.
 * It also lets enemy bolts detonate on any wizard, not only the local one.
 *
 * Players deliberately do NOT collide with each other (no doorway blocking).
 *
 * A HOSTILE peer's capsule also carries PEER_HOSTILE and accepts our
 * FRIENDLY_PROJECTILEs, so our bolts burst on them (on our screen; the damage
 * itself is decided on their machine). A sworn ally's capsule lets our magic
 * pass straight through. */

const PEER_FILTER = [GROUPS.ENEMY, GROUPS.PROP, GROUPS.ENEMY_PROJECTILE];
/** The same capsule a headless floor host gives every wizard. */
const ALLY_GROUPS = WIZARD_GROUPS;
const HOSTILE_GROUPS = interactionGroups(
  [GROUPS.PLAYER, GROUPS.PEER_HOSTILE],
  [...PEER_FILTER, GROUPS.FRIENDLY_PROJECTILE],
);

/** Parked here (far below the world) until the peer's first pose arrives. */
const LIMBO = { x: 0, y: -999, z: 0 };

export function PeerBodies() {
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
        <PeerCapsule key={id} playerId={id} />
      ))}
    </>
  );
}

function PeerCapsule({ playerId }: { playerId: string }) {
  const body = useRef<RapierRigidBody>(null);
  const [hostile, setHostile] = useState(() => isHostileWizard(playerId));

  useFrame(() => {
    const b = body.current;
    if (!b) return;
    const est = estimatePeer(playerId);
    b.setNextKinematicTranslation(est ? { x: est.p[0], y: est.p[1], z: est.p[2] } : LIMBO);
    // Pacts change rarely; re-render only when this one flips.
    const now = isHostileWizard(playerId);
    if (now !== hostile) setHostile(now);
  });

  return (
    <RigidBody
      ref={body}
      type="kinematicPosition"
      position={[LIMBO.x, LIMBO.y, LIMBO.z]}
      colliders={false}
    >
      <CapsuleCollider
        args={[PLAYER.halfHeight, PLAYER.radius]}
        friction={0}
        collisionGroups={hostile ? HOSTILE_GROUPS : ALLY_GROUPS}
      />
    </RigidBody>
  );
}
