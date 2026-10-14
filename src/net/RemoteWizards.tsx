import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { CanvasTexture, Group, LinearFilter, Sprite, SpriteMaterial, Vector3 } from "three";
import { playPeerBrink } from "../audio/heartSounds";
import { torchEmberFx } from "../fx/effects";
import { kickBrink, newHeart, stepHeart } from "../game/heart";
import { playerPosition } from "../game/player-state";
import { relationOf, type WizardRelation } from "../game/hostility";
import { NAME_RANGE, robeColorOf, TAG_COLORS } from "../game/wizardLook";
import { getItemDef } from "../items/catalog";
import { WizardModel } from "../render/models/WizardModel";
import { netClock } from "./clock";
import { INTERP_DELAY_MS } from "./entities";
import { dropPeerMark, peerMark } from "./peerVitals";
import { peerAtBrink, peerIds, peerLife, peerName, peerStaffId, samplePeer } from "./players";
import { makeSampledPose } from "./snapshots";

/** Name tags as canvas sprites — no font downloads, fits the pixel look.
 * Tinted by relation: pale for strangers, green for sworn allies, red for
 * an oathbreaker. */
const nameTagCache = new Map<string, SpriteMaterial>();

function nameTagMaterial(name: string, relation: WizardRelation = "stranger"): SpriteMaterial {
  const key = `${relation}:${name}`;
  const hit = nameTagCache.get(key);
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
  ctx.fillStyle = TAG_COLORS[relation];
  ctx.fillText(relation === "oathbreaker" ? `✗ ${name}` : name, 128, 25);
  const texture = new CanvasTexture(canvas);
  texture.minFilter = LinearFilter;
  const material = new SpriteMaterial({ map: texture, depthWrite: false, transparent: true });
  nameTagCache.set(key, material);
  return material;
}

/** A floor-mate's pixel heart: blood red for a stranger, their pact's green
 * for an ally, a sick violet for an oathbreaker. */
const HEART_TINT: Record<WizardRelation, string> = { stranger: "#ff4a3a", ally: "#7fe39a", oathbreaker: "#c05aff" };
const emberAt = new Vector3();

/** Renders the other wizards sharing this floor instance. Poses come from the
 * net layer's timestamped buffers, sampled ~90 ms in the past — smooth
 * motion at any packet jitter. With the loopback transport this renders
 * nothing — it lights up as soon as a real server is plugged in.
 *
 * A stranger's name only shows once they're within NAME_RANGE: at a
 * distance, another wizard is just a silhouette with a glowing staff.
 *
 * Death's door: each floor-mate's pose carries their life (net/players),
 * and a heart of their own (game/heart) beats here at their rate. In their
 * last stand embers sputter round them and leak away, a pixel heart beats
 * over their head (the HUD's life marks, via net/peerVitals), and their
 * Brink rings out where they stand. Every floor-mate shows it, sworn or
 * not: in co-op it says "cover me", in PvP it's the cracked shield. */
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

function RemoteWizard({ playerId }: { playerId: string }) {
  const group = useRef<Group>(null);
  const tag = useRef<Sprite>(null);
  const lastTag = useRef("");
  const robeColor = robeColorOf(playerId);
  // Sworn allies wear a soft halo — the one thing that tells friend from
  // stranger at a glance in the dark. Re-renders only when the pact flips.
  const [ally, setAlly] = useState(() => relationOf(playerId) === "ally");
  const bobT = useMemo(() => ({ t: 0 }), []);
  const pose = useMemo(() => makeSampledPose(), []);
  // Their heart, beating at their rate; how near death it reads (the
  // model's ember shell); when they last leaked an ember; their Brink.
  const heart = useMemo(newHeart, []);
  const dying = useRef(0);
  const vital = useRef({ ember: 0, brink: false, relation: "" });
  useEffect(() => () => dropPeerMark(playerId), [playerId]);
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
    const mark = peerMark(playerId);
    mark.shown = false;
    if (!known) return;
    g.position.set(pose.p[0], pose.p[1], pose.p[2]);
    if (pose.a) g.rotation.y = pose.a[0];

    // Little walk bob scaled by how fast they're moving (children[0] = body).
    const speed = Math.hypot(pose.v[0], pose.v[2]);
    bobT.t += dt * Math.min(speed, 10);
    g.children[0].position.y = Math.abs(Math.sin(bobT.t * 1.4)) * Math.min(speed * 0.012, 0.06);

    // Name tag: fresh name (peers can arrive before their hello lands),
    // relation tint, and hidden beyond NAME_RANGE unless sworn to us.
    const name = peerName(playerId);
    const relation = relationOf(playerId);
    if ((relation === "ally") !== ally) setAlly(relation === "ally");
    const t = tag.current;
    if (t) {
      const key = `${relation}:${name}`;
      if (name && key !== lastTag.current) {
        lastTag.current = key;
        t.material = nameTagMaterial(name, relation);
      }
      const d2 = playerPosition.distanceToSquared(g.position);
      t.visible = !!name && (relation === "ally" || d2 < NAME_RANGE * NAME_RANGE);
    }

    // Death's door.
    const v = vital.current;
    const life = peerLife(playerId);
    const brink = peerAtBrink(playerId);
    if (brink && !v.brink) {
      kickBrink(heart);
      playPeerBrink([g.position.x, g.position.y + 0.4, g.position.z]);
    }
    v.brink = brink;
    stepHeart(heart, dt, life < 0 ? 1 : life);
    dying.current = heart.low > 0 ? heart.low * (0.55 + 0.45 * heart.beat) : 0;
    if (heart.low > 0) {
      v.ember -= dt;
      if (v.ember <= 0) {
        v.ember = 0.28 - 0.18 * heart.low;
        emberAt.set(g.position.x + (Math.random() - 0.5) * 0.5, g.position.y + Math.random() * 0.9, g.position.z + (Math.random() - 0.5) * 0.5);
        torchEmberFx(emberAt, "#ff5a2a");
      }
    }
    mark.x = g.position.x;
    // Just over the hood, under the name tag (and any prompt above it).
    mark.y = g.position.y + 1.3;
    mark.z = g.position.z;
    mark.shown = life >= 0 && heart.low > 0;
    mark.alpha = mark.shown ? 1 : 0;
    mark.beat = heart.beat;
    mark.brink = heart.brink > 0.6 ? 1 : 0;
    if (v.relation !== relation) {
      v.relation = relation;
      mark.tint.set(HEART_TINT[relation]);
    }
  });

  return (
    <group ref={group} visible={false}>
      {/* Body first: the walk bob targets children[0]. */}
      <WizardModel
        robeColor={robeColor}
        staffColor={staffColor()}
        aura={ally ? TAG_COLORS.ally : null}
        castShadow
        dying={dying}
      />
      {/* Name tag */}
      <sprite ref={tag} position={[0, 1.85, 0]} scale={[1.6, 0.3, 1]} material={nameTagMaterial("…")} />
    </group>
  );
}
