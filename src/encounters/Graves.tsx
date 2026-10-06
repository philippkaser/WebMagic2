import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { create } from "zustand";
import type { Group } from "three";
import { playGraveRise } from "../audio/sound";
import { gameEvents } from "../core/events";
import { addLightSource, flashLight, removeLightSource } from "../fx/DynamicLights";
import { soulRiseFx } from "../fx/effects";
import { offerInteraction } from "../game/interactions";
import { playerPosition } from "../game/player-state";
import { wizardDistSqTo } from "../game/targets";
import { robeColorOf } from "../game/wizardLook";
import { netBus } from "../net/bus";
import { hostCommand, hostEvent } from "../net/channels";
import {
  FLOOR,
  GRAVE_LOOT_RANGE_SQ,
  GRAVE_RAISE_RANGE_SQ,
  SYNC,
  type GraveDropMsg,
  type GraveLootedMsg,
  type GraveLootMsg,
  type LiveGrave,
} from "../net/floorProtocol";
import { registerSyncProvider } from "../net/entities";
import { useNet } from "../net/netStore";
import { session } from "../net/session";
import { GraveModel } from "../render/models/GraveModel";
import { useGame } from "../state/gameStore";
import {
  graveIsEmpty,
  graveItemCount,
  planGravePicks,
  sanitizeGraveContents,
  sanitizePicks,
  takeFromGrave,
} from "./graveRules";

/** Grave chests, live — see graveRules.ts for the rules and the lore.
 *
 * Flow: the dying wizard (still on the floor) asks the host to raise a grave
 * with what the death took → the host validates and announces it to the
 * whole floor → anyone standing at it presses E to plunder what fits → the
 * host grants each taken copy (the same provenance path as any pickup) and
 * announces the take, so every machine agrees on what's left. Graves ride the
 * late-join world sync and survive host migration (every client holds the
 * full list). They vanish with the floor. */


const useGraves = create<{ graves: LiveGrave[] }>(() => ({ graves: [] }));

// Dev-only inspection for end-to-end scripts.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__graves = () => useGraves.getState().graves;
}

const PROMPT_RANGE_SQ = 2.4 * 2.4;

let graveCounter = 1;

function selfId(): string {
  return useNet.getState().playerId || "self";
}

const graveSpawned = hostEvent<LiveGrave>(FLOOR.graveSpawned, (g) => {
  if (useGraves.getState().graves.some((x) => x.id === g.id)) return;
  useGraves.setState({ graves: [...useGraves.getState().graves, g] });
  announceFall(g);
});

const graveLooted = hostEvent<GraveLootedMsg>(FLOOR.graveLooted, (d) => {
  const graves = useGraves.getState().graves;
  const grave = graves.find((g) => g.id === d.graveId);
  if (!grave) return;
  const { grave: left, taken, gold } = takeFromGrave(grave, d.picks, d.gold);
  useGraves.setState({ graves: graves.map((g) => (g.id === grave.id ? left : g)) });
  if (d.by === selfId()) {
    const game = useGame.getState();
    for (const t of taken) for (let n = 0; n < t.qty; n++) game.acquireItem(t.id);
    if (gold > 0) game.addGold(gold);
  }
  // What was left behind rises out of the grave as soul-light.
  soulRiseFx([grave.pos[0], grave.pos[1] + 0.8, grave.pos[2]], grave.color, 20);
});

/** Host: raise a grave for a wizard who just fell on this floor. */
const graveDrop = hostCommand<GraveDropMsg>(FLOOR.graveDrop, (d, meta) => {
  const contents = sanitizeGraveContents(d);
  if (!contents) return;
  const pos = d?.pos;
  if (!Array.isArray(pos) || pos.length !== 3 || !pos.every((n) => Number.isFinite(n))) return;
  if (wizardDistSqTo(meta.from, pos[0], pos[1], pos[2]) > GRAVE_RAISE_RANGE_SQ) return;
  const roster = useNet.getState().roster;
  const killerId = typeof d.killerId === "string" && roster[d.killerId] ? d.killerId : null;
  graveSpawned.announce({
    id: `grave_${graveCounter++}_${Math.random().toString(36).slice(2, 6)}`,
    ownerId: meta.from,
    ownerName: roster[meta.from] ?? "A wizard",
    killerId,
    killerName: killerId ? roster[killerId] : null,
    pos: [pos[0], pos[1], pos[2]],
    color: robeColorOf(meta.from),
    ...contents,
  });
});

/** Host: someone at a grave wants what fits in their pack. */
const lootGrave = hostCommand<GraveLootMsg>(FLOOR.lootGrave, (d, meta) => {
  const grave = useGraves.getState().graves.find((g) => g.id === d?.graveId);
  if (!grave) return;
  if (wizardDistSqTo(meta.from, grave.pos[0], grave.pos[1], grave.pos[2]) > GRAVE_LOOT_RANGE_SQ) return;
  const picks = sanitizePicks(grave, d.picks);
  const gold = d.gold === true && grave.gold > 0;
  if (picks.length === 0 && !gold) return;
  const { taken, gold: goldTaken } = takeFromGrave(grave, picks, gold);
  graveLooted.announce({ graveId: grave.id, by: meta.from, picks, gold });
  // Plunder is a pickup like any other: bankable only by host attestation —
  // and the server honors grave grants only against what the dead were
  // actually granted in this instance (a forged grave mints nothing).
  for (const t of taken) for (let n = 0; n < t.qty; n++) session.attestGrave(meta.from, t.id);
  if (goldTaken > 0) session.attestGraveGold(meta.from, goldTaken);
});

function announceFall(g: LiveGrave): void {
  const me = selfId();
  const text =
    g.ownerId === me
      ? "Your grave rises behind you."
      : g.killerId === me
        ? `You slew ${g.ownerName}. Their grave holds what they carried.`
        : g.killerName
          ? `${g.ownerName} was slain by ${g.killerName}. A grave rises where they fell.`
          : `${g.ownerName} has fallen. A grave rises where they fell.`;
  gameEvents.emit("message", text);
  playGraveRise(g.pos);
  flashLight([g.pos[0], g.pos[1] + 1, g.pos[2]], g.color, 24);
  soulRiseFx([g.pos[0], g.pos[1] + 0.5, g.pos[2]], g.color, 26);
}

// The dying wizard's side: raise the grave while still on the floor.
gameEvents.on("wizardFell", ({ items, gold, killerId, shared }) => {
  if (!shared || (items.length === 0 && gold <= 0)) return;
  graveDrop.request({
    items,
    gold,
    killerId,
    pos: [playerPosition.x, Math.max(0, playerPosition.y - 0.9), playerPosition.z],
  });
});

/** Mounted once in the scene (inside Physics is not required). */
export function Graves() {
  const graves = useGraves((s) => s.graves);
  const floorSeed = useGame((s) => s.floorSeed);
  const phase = useGame((s) => s.phase);

  useEffect(
    () =>
      registerSyncProvider(SYNC.graves, {
        collect: () => useGraves.getState().graves,
        apply: (data) => {
          if (Array.isArray(data)) useGraves.setState({ graves: data as LiveGrave[] });
        },
      }),
    [],
  );

  // Graves belong to their floor — gone with a new floor, and gone the
  // moment we leave the dungeon (walking home, a feather, our own death).
  useEffect(() => useGraves.setState({ graves: [] }), [floorSeed]);
  useEffect(() => netBus.on("leftDungeon", () => useGraves.setState({ graves: [] })), []);
  if (phase !== "dungeon") return null;

  return (
    <>
      {graves.map((g) => (
        <GraveChest key={g.id} grave={g} />
      ))}
    </>
  );
}

function GraveChest({ grave }: { grave: LiveGrave }) {
  const group = useRef<Group>(null);
  const requested = useRef(0);
  const empty = graveIsEmpty(grave);
  const count = graveItemCount(grave);
  const [x, y, z] = grave.pos;

  useEffect(() => {
    if (empty) return;
    const src = addLightSource({
      position: [x, y + 1, z],
      color: grave.color,
      intensity: 3.2,
      distance: 7,
      priority: 2,
    });
    return () => removeLightSource(src);
  }, [empty, grave.color, x, y, z]);

  const lootText = useMemo(() => {
    const parts: string[] = [];
    if (count > 0) parts.push(`${count} item${count === 1 ? "" : "s"}`);
    if (grave.gold > 0) parts.push(`${grave.gold} gold`);
    return parts.join(", ");
  }, [count, grave.gold]);

  useFrame((_, dt) => {
    requested.current -= dt;
    if (empty) return;

    const d2 = (playerPosition.x - x) ** 2 + (playerPosition.z - z) ** 2;
    if (d2 > PROMPT_RANGE_SQ || useGame.getState().phase !== "dungeon") return;
    const state = useGame.getState();
    const picks = planGravePicks(
      { equipment: state.equipment, bag: state.bag, belt: state.belt, chest: state.chest },
      grave,
    );
    const whose = grave.ownerId === selfId() ? "your own" : `${grave.ownerName}'s`;
    if (picks.length === 0 && grave.gold <= 0) {
      offerInteraction(`Your pack is full — ${whose} grave keeps its ${lootText}`, d2, () => {}, [x, y + 1.3, z]);
      return;
    }
    offerInteraction(
      `E — Plunder ${whose} grave (${lootText})`,
      d2,
      () => {
        if (requested.current > 0) return;
        requested.current = 0.6; // throttle while the grant round-trips
        lootGrave.request({ graveId: grave.id, picks, gold: grave.gold > 0 });
      },
      [x, y + 1.3, z],
    );
  });

  return (
    <group ref={group} position={grave.pos}>
      <GraveModel color={grave.color} opened={empty} motes={!empty} castShadow />
    </group>
  );
}
