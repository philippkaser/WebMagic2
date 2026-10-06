import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AdditiveBlending,
  Color,
  CylinderGeometry,
  DoubleSide,
  Group,
  MeshStandardMaterial,
  PlaneGeometry,
  ShaderMaterial,
  Vector3,
} from "three";
import { gameEvents } from "../core/events";
import {
  addLightSource,
  removeLightSource,
  type DynamicLightSource,
} from "../fx/DynamicLights";
import { spawnBurst } from "../fx/Particles";
import { offerInteraction } from "../game/interactions";
import { playerPosition } from "../game/player-state";
import { wizardDistSqTo } from "../game/targets";
import { netBus } from "../net/bus";
import { hostCommand, hostEvent } from "../net/channels";
import { registerSyncProvider } from "../net/entities";
import { isHost, useNet } from "../net/netStore";
import { session } from "../net/session";
import { ItemModel } from "../ui3d/ItemModel";
import { ENCHANT_COLOR } from "./affixes";
import { getItemDef, resolveItem } from "./catalog";
import type { LootSource } from "./dropTables";
import { DROPPED_ORB_PREFIX } from "./lootBook";
import { useGame } from "../state/gameStore";
import type { Slot } from "./types";
import type { Vec3 } from "../world/types";

/** Loot on the floor, as orbs. The floor's LOOT BOOK (items/lootBook.ts —
 * kept by the server's ledger online, by the offline loopback in
 * single-player) is the authority over what falls: the host only reports
 * what died or broke (`reportLoot`), the book rolls it and answers with the
 * orbs, and the host spawns them for everyone. A pickup is arbitrated by the
 * host (first come, first served, at arm's length) and CLAIMED from the book
 * by orb id, which grants what the orb holds exactly once. Dropped copies
 * and the floor treasure are book orbs too.
 *
 * Two orb families share the pipeline: ITEM orbs (E to take, routed into the
 * inventory) and GOLD orbs (vacuumed automatically by walking close). */

interface Orb {
  /** The book's orb id ("o12", or "d3" for a dropped copy). */
  id: string;
  /** Item orb when set; gold orb when null. */
  defId: string | null;
  gold: number;
  position: Vec3;
}

let pushOrb: ((orb: Orb) => void) | null = null;
let takeOrbLocal: ((orbId: string, by: string) => void) | null = null;
let liveOrbs: (() => Orb[]) | null = null;

const orbSpawned = hostEvent<{ orbId: string; defId: string | null; gold: number; pos: Vec3 }>(
  "orbSpawned",
  (d) => pushOrb?.({ id: d.orbId, defId: d.defId ?? null, gold: d.gold ?? 0, position: d.pos }),
);

const orbTaken = hostEvent<{ orbId: string; by: string }>("orbTaken", (d) =>
  takeOrbLocal?.(d.orbId, d.by),
);

/** Grant radius. Pickups are offered within ~2.3 m; the slack covers the
 * requester's movement during one round trip. Anything farther is a client
 * trying to vacuum loot across the map. */
const TAKE_RANGE_SQ = 6 * 6;

const takeOrb = hostCommand<{ orbId: string }>("takeOrb", (d, meta) => {
  // First come, first served — only if the orb still exists and the
  // requesting wizard is actually standing at it.
  const orb = liveOrbs?.().find((o) => o.id === d.orbId);
  if (!orb) return;
  if (wizardDistSqTo(meta.from, orb.position[0], orb.position[1], orb.position[2]) > TAKE_RANGE_SQ)
    return;
  orbTaken.announce({ orbId: d.orbId, by: meta.from });
  // The book grants what it put in this orb, once — whatever this host says.
  session.claimOrb(meta.from, orb.id);
});

/** A dropped copy becomes a real orb at the dropper's feet — anyone on the
 * floor can take it, which makes dropping double as gifting. The dropper
 * gave the copy up to the book first and spawns the orb id it got back; the
 * host checks only that it IS a dropped copy's id and lies at the dropper's
 * feet (the book still decides what claiming it grants). */
const dropOrb = hostCommand<{ orbId: string; defId: string; pos: Vec3 }>("dropOrb", (d, meta) => {
  if (typeof d.orbId !== "string" || !d.orbId.startsWith(DROPPED_ORB_PREFIX)) return;
  if (typeof d.defId !== "string" || !Array.isArray(d.pos)) return;
  try {
    resolveItem(d.defId); // validates base AND affix
  } catch {
    return; // unknown id from a hacked/newer client — refuse to spawn it
  }
  if (wizardDistSqTo(meta.from, d.pos[0], d.pos[1], d.pos[2]) > TAKE_RANGE_SQ) return;
  orbSpawned.announce({ orbId: d.orbId, defId: d.defId, gold: 0, pos: d.pos });
});

/** Host only: `id` died or broke at `at` — the book rolls what it drops. */
export function reportLoot(id: string, source: LootSource, at: Vec3): void {
  if (!isHost()) return;
  session.requestLoot(id, source, at);
}

/** Where the i-th of n orbs from one source lands: the first on the spot,
 * the rest in a small ring around it. */
function spread(at: readonly number[], i: number, n: number): Vec3 {
  if (i === 0 || n < 2) return [at[0], at[1], at[2]];
  const a = (i / (n - 1)) * Math.PI * 2;
  return [at[0] + Math.cos(a) * 0.7, at[1], at[2] + Math.sin(a) * 0.7];
}

// The book answered a report: spawn its orbs for the floor (host only — a
// reply that arrives after a migration is the old host's to drop).
netBus.on("lootRolled", ({ at, orbs }) => {
  if (!isHost()) return;
  orbs.forEach((o, i) =>
    orbSpawned.announce({ orbId: o.orbId, defId: o.itemId, gold: o.gold, pos: spread(at, i, orbs.length) }),
  );
});

// Dev-only hook for end-to-end scripts: the host asks the book for a
// specific orb (item or gold). A real server honors it only when started
// for testing (DEV_LOOT=1); the pickup is claimed like any other.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__spawnOrb = (
    defId: string | null,
    gold: number,
    pos: Vec3,
  ) => {
    if (!isHost()) return false;
    session.requestLoot("dev", { kind: "dev", itemId: defId, gold }, pos);
    return true;
  };
  // The live orbs on this client (id, item or gold, where).
  (window as unknown as Record<string, unknown>).__orbs = () => liveOrbs?.() ?? [];
}

export function LootOrbs() {
  const [orbs, setOrbs] = useState<Orb[]>([]);
  const orbsRef = useRef<Orb[]>([]);
  orbsRef.current = orbs;
  const floorSeed = useGame((s) => s.floorSeed);

  useEffect(() => {
    pushOrb = (orb) => setOrbs((prev) => (prev.some((o) => o.id === orb.id) ? prev : [...prev, orb]));
    takeOrbLocal = (orbId, by) => {
      // Gone from the authority's list NOW, not at the next render: a second
      // take request landing in between must find nothing to grant (one orb,
      // one grant).
      orbsRef.current = orbsRef.current.filter((o) => o.id !== orbId);
      setOrbs((prev) => {
        const orb = prev.find((o) => o.id === orbId);
        if (!orb) return prev;
        const myId = useNet.getState().playerId;
        if (by === myId || by === "self") {
          if (orb.defId) useGame.getState().acquireItem(orb.defId);
          else if (orb.gold > 0) useGame.getState().addGold(orb.gold);
        }
        spawnBurst({
          position: [orb.position[0], orb.position[1] + 0.5, orb.position[2]],
          count: orb.defId ? 18 : 10,
          color: orb.defId ? [getItemDef(orb.defId).color, "#ffffff"] : ["#ffd24d", "#ffefb0"],
          speed: 3.5,
          ttl: 0.6,
          size: 0.07,
          gravity: -2,
        });
        return prev.filter((o) => o.id !== orbId);
      });
    };
    liveOrbs = () => orbsRef.current;
    // Late-join sync: ship the live orb list; the joiner spawns them silently.
    const unregister = registerSyncProvider("orbs", {
      collect: () => orbsRef.current,
      apply: (data) => {
        for (const orb of (data as Orb[]) ?? []) pushOrb?.(orb);
      },
    });
    // Inventory drops: each copy is given up to the book first; the orb it
    // comes back as lands around the player's feet.
    const offDrop = gameEvents.on("dropItems", ({ defId, qty, runLoot }) => {
      for (let i = 0; i < Math.min(qty, 8); i++) session.releaseItem(defId, runLoot);
    });
    const offReleased = netBus.on("released", (orb) => {
      if (!orb.itemId) return;
      const a = Math.random() * Math.PI * 2;
      dropOrb.request({
        orbId: orb.orbId,
        defId: orb.itemId,
        pos: [
          playerPosition.x + Math.cos(a) * (0.6 + Math.random() * 0.4),
          Math.max(playerPosition.y - 0.5, 0.4),
          playerPosition.z + Math.sin(a) * (0.6 + Math.random() * 0.4),
        ],
      });
    });
    return () => {
      pushOrb = null;
      takeOrbLocal = null;
      liveOrbs = null;
      unregister();
      offDrop();
      offReleased();
    };
  }, []);

  // Loot left behind vanishes when the floor changes.
  useEffect(() => setOrbs([]), [floorSeed]);

  return (
    <>
      {orbs.map((orb) =>
        orb.defId ? <ItemOrb key={orb.id} orb={orb} /> : <GoldOrb key={orb.id} orb={orb} />,
      )}
    </>
  );
}

function ItemOrb({ orb }: { orb: Orb }) {
  const group = useRef<Group>(null);
  const light = useRef<DynamicLightSource | null>(null);
  const requested = useRef(0);
  const item = resolveItem(orb.defId!);
  const def = item.def;
  const [x, y, z] = orb.position;
  // Orbs hover gently DOWN to the floor — kills mid-air leave no sky loot.
  const fallY = useRef(y);

  useEffect(() => {
    const src = addLightSource({
      position: [x, y + 0.5, z],
      color: def.color,
      intensity: 2.4,
      distance: 5,
      priority: 1,
    });
    light.current = src;
    return () => {
      removeLightSource(src);
      light.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    const t = clock.elapsedTime;
    fallY.current = Math.max(0, fallY.current - dt * 1.7);
    g.position.set(x, fallY.current + 0.35 + Math.sin(t * 2.4) * 0.12, z);
    g.rotation.y = t * 1.6;
    light.current?.position.copy(g.position);
    requested.current -= dt;

    const d2 = playerPosition.distanceToSquared(g.position);
    if (d2 < 5.5) {
      // A full inventory blocks the request client-side, BEFORE the grant —
      // a granted orb is gone forever, so never ask for what can't be held.
      if (!useGame.getState().canAcquire(orb.defId!)) {
        offerInteraction(`Inventory full — can't take ${item.name}`, d2, () => {}, [
          g.position.x,
          g.position.y + 0.7,
          g.position.z,
        ]);
        return;
      }
      const desc = item.affix ? `${item.affix.desc} · ${def.desc}` : def.desc;
      const at: [number, number, number] = [g.position.x, g.position.y + 0.7, g.position.z];
      offerInteraction(`E — Take ${item.name}  (${desc})`, d2, () => {
        if (requested.current > 0) return;
        requested.current = 0.6; // throttle re-requests while awaiting grant
        takeOrb.request({ orbId: orb.id });
      }, at);
    }
  });

  return (
    <group ref={group} position={orb.position}>
      <LootBeacon color={item.affix ? ENCHANT_COLOR : def.color} tier={def.tier} enchanted={!!item.affix} />
      <group scale={LOOT_SCALE[def.slot]} rotation={[0, 0, def.slot === "staff" ? -0.35 : 0]}>
        <ItemModel itemId={orb.defId!} />
      </group>
    </group>
  );
}

/** Coins don't ask questions — walk close and they're yours. */
const GOLD_VACUUM_RANGE_SQ = 1.7 * 1.7;
const GOLD_COLOR = "#ffcf4d";

function GoldOrb({ orb }: { orb: Orb }) {
  const group = useRef<Group>(null);
  const light = useRef<DynamicLightSource | null>(null);
  const requested = useRef(0);
  const [x, y, z] = orb.position;
  const fallY = useRef(y);

  useEffect(() => {
    const src = addLightSource({
      position: [x, y + 0.4, z],
      color: GOLD_COLOR,
      intensity: 1.6,
      distance: 4,
      priority: 0,
    });
    light.current = src;
    return () => {
      removeLightSource(src);
      light.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useFrame(({ clock }, dt) => {
    const g = group.current;
    if (!g) return;
    const t = clock.elapsedTime;
    fallY.current = Math.max(0, fallY.current - dt * 1.7);
    g.position.set(x, fallY.current + 0.22 + Math.sin(t * 3.1 + x) * 0.06, z);
    g.rotation.y = t * 2.2;
    light.current?.position.copy(g.position);
    requested.current -= dt;

    if (requested.current <= 0 && playerPosition.distanceToSquared(g.position) < GOLD_VACUUM_RANGE_SQ) {
      requested.current = 0.6; // throttle while the grant round-trips
      takeOrb.request({ orbId: orb.id });
    }
  });

  return (
    <group ref={group} position={orb.position}>
      <CoinPile amount={orb.gold} />
    </group>
  );
}

// ── Presentation ─────────────────────────────────────────────────────────────
// Dropped loot shows the item itself — the same ItemModel the inventory
// holds — turning above the floor inside a soft column of its own light,
// with a halo on the flagstones and motes rising through it: a beacon you
// see from across the room. Rarer finds burn taller and brighter;
// enchanted ones in the enchant violet. Gold is a little heap of coins.
//
// The world canvas renders at a third of the resolution with bloom, so the
// shapes are broad and soft (they survive the pixelation) and the cores are
// bright enough to bloom without blowing out.

/** How big each family floats (ItemModel is ~1 m tall at scale 1). */
const LOOT_SCALE: Record<Slot, number> = {
  staff: 0.72,
  amulet: 0.6,
  cloak: 0.58,
  boots: 0.54,
  consumable: 0.55,
};

const BEACON_VERT = /* glsl */ `
uniform float uWidth;
uniform float uHeight;
varying vec2 vUv;
void main() {
  vUv = uv;
  // A billboard that only turns about the vertical: a column of light
  // stays upright however you look at it.
  vec3 origin = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  right.y = 0.0;
  right = normalize(right + vec3(1e-5, 0.0, 0.0));
  vec3 p = origin + right * position.x * uWidth + vec3(0.0, (position.y + 0.5) * uHeight, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const BEACON_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uStrength;
uniform float uAspect;
varying vec2 vUv;
float hash(float n) { return fract(sin(n) * 43758.5453); }
void main() {
  float x = (vUv.x - 0.5) * 2.0;
  float y = vUv.y;
  float core = exp(-x * x * 22.0);
  float body = exp(-x * x * 3.2);
  float fade = pow(1.0 - y, 1.8) * smoothstep(0.0, 0.05, y);
  float shimmer = 0.82 + 0.18 * sin(y * 16.0 - uTime * 3.2);
  float beam = (core * 0.85 + body * 0.3) * fade * shimmer;
  // Motes rising through the column.
  float motes = 0.0;
  for (int i = 0; i < 7; i++) {
    float fi = float(i);
    float my = fract(hash(fi * 1.7) + uTime * (0.1 + hash(fi + 7.0) * 0.12));
    float mx = (hash(fi + 3.0) - 0.5) * 1.1 + sin(uTime * 1.3 + fi * 2.1) * 0.12;
    vec2 d = vec2(x - mx, (y - my) * uAspect);
    motes += exp(-dot(d, d) * 260.0) * (1.0 - my) * smoothstep(0.0, 0.1, my);
  }
  gl_FragColor = vec4(uColor * (beam + motes * 1.4) * uStrength, 1.0);
}
`;

const HALO_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
uniform float uStrength;
varying vec2 vUv;
void main() {
  vec2 c = (vUv - 0.5) * 2.0;
  float r = length(c);
  float pool = exp(-r * r * 5.0) * 0.55;
  float ringR = 0.62 + sin(uTime * 2.0) * 0.03;
  float ring = exp(-pow((r - ringR) * 16.0, 2.0));
  // Rune notches turning slowly around the ring.
  float a = atan(c.y, c.x) / 6.28318 + 0.5;
  float notch = step(0.55, fract(a * 10.0 + uTime * 0.08)) * exp(-pow((r - 0.8) * 22.0, 2.0));
  float fade = smoothstep(1.0, 0.85, r);
  gl_FragColor = vec4(uColor * (pool + ring * 0.7 + notch * 0.45) * fade * uStrength, 1.0);
}
`;

const HALO_VERT = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

let quadGeo: PlaneGeometry | null = null;
const quad = () => (quadGeo ??= new PlaneGeometry(1, 1));
const tmpBeacon = new Vector3();

function additive(vertexShader: string, fragmentShader: string, uniforms: Record<string, { value: unknown }>): ShaderMaterial {
  return new ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
  });
}

/** The column of light and the halo under an item on the floor. Sits at
 * floor level whatever its bobbing parent does (the orb logic keeps the
 * floor at y = 0 and floats the item above it). */
function LootBeacon({ color, tier, enchanted }: { color: string; tier: number; enchanted: boolean }) {
  const strength = (0.55 + tier * 0.22) * (enchanted ? 1.25 : 1);
  const height = 1.5 + tier * 0.45 + (enchanted ? 0.5 : 0);
  const width = 0.55 + tier * 0.05;
  const { beam, halo } = useMemo(() => {
    const c = new Color(color);
    return {
      beam: additive(BEACON_VERT, BEACON_FRAG, {
        uColor: { value: c },
        uTime: { value: 0 },
        uStrength: { value: strength },
        uWidth: { value: width },
        uHeight: { value: height },
        uAspect: { value: height / width },
      }),
      halo: additive(HALO_VERT, HALO_FRAG, { uColor: { value: c }, uTime: { value: 0 }, uStrength: { value: strength } }),
    };
  }, [color, strength, height, width]);
  useEffect(
    () => () => {
      beam.dispose();
      halo.dispose();
    },
    [beam, halo],
  );
  const self = useRef<Group>(null);
  const born = useRef(-1);
  useFrame(({ clock }) => {
    const b = self.current;
    if (!b?.parent) return;
    const t = clock.elapsedTime;
    if (born.current < 0) born.current = t;
    // Stay on the floor: undo the parent's height (it floats the item).
    b.parent.getWorldPosition(tmpBeacon);
    b.position.y = -tmpBeacon.y + 0.02;
    // Kindles over a second as the item settles.
    const k = Math.min(1, (t - born.current) / 1.2);
    beam.uniforms.uTime!.value = t;
    halo.uniforms.uTime!.value = t;
    beam.uniforms.uStrength!.value = strength * k * (0.9 + Math.sin(t * 2.6) * 0.1);
    halo.uniforms.uStrength!.value = strength * k;
  });
  return (
    <group ref={self}>
      <mesh geometry={quad()} material={beam} frustumCulled={false} renderOrder={2} />
      <mesh geometry={quad()} material={halo} rotation={[-Math.PI / 2, 0, 0]} scale={1.3 + tier * 0.15} renderOrder={1} />
    </group>
  );
}

// ── Coins ────────────────────────────────────────────────────────────────────

let coinGeo: CylinderGeometry | null = null;
let coinMat: MeshStandardMaterial | null = null;
const coin = () => (coinGeo ??= new CylinderGeometry(0.085, 0.085, 0.022, 12));
const coinMaterial = () =>
  (coinMat ??= new MeshStandardMaterial({
    color: "#d9a93a",
    emissive: GOLD_COLOR,
    emissiveIntensity: 0.45,
    metalness: 0.6,
    roughness: 0.32,
  }));

/** A few coins in a tumble, one standing on its rim — more for bigger
 * purses. */
const COIN_LAYOUT: { p: Vec3; r: Vec3 }[] = [
  { p: [0, -0.1, 0], r: [0, 0, 0] },
  { p: [0.1, -0.08, 0.05], r: [0.25, 0.4, 0.1] },
  { p: [-0.09, -0.09, 0.06], r: [-0.2, 1.1, 0.15] },
  { p: [0.02, -0.06, -0.08], r: [0.3, 2, -0.2] },
  { p: [0.01, 0.04, 0.02], r: [Math.PI / 2, 0.3, 0] },
  { p: [-0.05, -0.05, -0.02], r: [0.35, 0.6, 0.3] },
  { p: [0.07, -0.03, -0.04], r: [-0.3, 2.4, 0.25] },
];

function CoinPile({ amount }: { amount: number }) {
  const n = Math.max(3, Math.min(COIN_LAYOUT.length, Math.round(2 + Math.log2(1 + amount))));
  return (
    <group>
      {COIN_LAYOUT.slice(0, n).map((c, i) => (
        <mesh key={i} geometry={coin()} material={coinMaterial()} position={c.p} rotation={c.r} />
      ))}
    </group>
  );
}
