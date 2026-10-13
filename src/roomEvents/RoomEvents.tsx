import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Color } from "three";
import { gameEvents } from "../core/events";
import { addLightSource, flashLight, removeLightSource, type DynamicLightSource } from "../fx/DynamicLights";
import { soulRiseFx } from "../fx/effects";
import { spawnBurst } from "../fx/Particles";
import { offerInteraction } from "../game/interactions";
import { playerPosition } from "../game/player-state";
import { getBuffDef } from "../items/buffs";
import { registerSyncProvider } from "../net/entities";
import { useNet } from "../net/netStore";
import {
  buildFountain,
  buildShrine,
  buildVault,
  buildWard,
  disposeBuilt,
  WARD_RUNES,
} from "../render/models/roomEventModels";
import { playBubble } from "../audio/stationSounds";
import { playGraveRise, playPactBroken, playPactSworn, playSealBreak } from "../audio/sound";
import type { RoomEventSpawn } from "../world/types";
import { ROOM_EVENT_RULES, roomEventDef, shrineBoon } from "./catalog";
import { requestRoomAct, resetRoomEvents, tickRoomEvents, useRoomEvents } from "./net";
import { initialRoomState, type RoomEventState } from "./rules";

/** The room events on a floor: the authority's tick, late-join sync, and one
 * view per event. Mounted by the dungeon floor with the layout's events. */
export function RoomEvents({ events, floor }: { events: readonly RoomEventSpawn[]; floor: number }) {
  useEffect(() => {
    // A new floor starts every event afresh; a late joiner's sync then lands.
    resetRoomEvents();
    const unregister = registerSyncProvider("roomEvents", {
      collect: () => useRoomEvents.getState().states,
      apply: (data) => resetRoomEvents((data as Record<string, RoomEventState>) ?? {}),
    });
    return unregister;
  }, [events]);

  // Rule time is real time (a slow frame mustn't slow a ward's fill); only a
  // long hitch is capped.
  useFrame((_, dt) => tickRoomEvents(events, Math.min(dt, 0.5), floor));

  // Moments everyone sees: bursts, light and sound where it happened.
  useEffect(
    () =>
      gameEvents.on("roomEvent", ({ kind, phase, at }) => {
        const color = roomEventDef(kind).color;
        const top: [number, number, number] = [at[0], 1.4, at[2]];
        if (phase === "guarded") {
          playGraveRise(top);
          flashLight(top, "#ff3b3b", 18, 9);
        } else if (phase === "open" || phase === "won") {
          playSealBreak();
          flashLight(top, color, 30, 12);
          spawnBurst({ position: top, count: 40, color: [color, "#ffffff"], speed: 5, ttl: 0.9, size: 0.09, style: "glow" });
          soulRiseFx(top, color, 18);
        } else if (phase === "kindled") {
          playPactSworn();
          flashLight(top, color, 20, 10);
        } else if (phase === "broken") {
          playPactBroken();
          spawnBurst({ position: top, count: 24, color: ["#5a5662", "#2a2830"], speed: 2.5, ttl: 1.2, size: 0.1, gravity: -4 });
        }
      }),
    [],
  );

  return (
    <>
      {events.map((e) => (
        <RoomEventView key={e.id} spawn={e} />
      ))}
    </>
  );
}

function RoomEventView({ spawn }: { spawn: RoomEventSpawn }) {
  const state = useRoomEvents((s) => s.states[spawn.id]) ?? initialRoomState(spawn);
  return (
    <group position={spawn.pos} rotation={[0, spawn.facing, 0]}>
      {state.kind === "vault" && <Vault spawn={spawn} state={state} />}
      {state.kind === "ward" && <Ward spawn={spawn} state={state} />}
      {(state.kind === "shrine" || state.kind === "fountain") && <Offering spawn={spawn} state={state} />}
    </group>
  );
}

// ── Shared bits ──────────────────────────────────────────────────────────────

/** Squared distance at which an event offers its prompt. */
const PROMPT_RANGE_SQ = 2.6 * 2.6;

function nearSq(spawn: RoomEventSpawn): number {
  return (playerPosition.x - spawn.pos[0]) ** 2 + (playerPosition.z - spawn.pos[2]) ** 2;
}

/** A light that follows the event's state (null: dark). */
function useEventLight(spawn: RoomEventSpawn, color: string | null, intensity: number, y = 1.4): void {
  useEffect(() => {
    if (!color || intensity <= 0) return;
    const src: DynamicLightSource = addLightSource({ position: [spawn.pos[0], y, spawn.pos[2]], color, intensity, distance: 8, priority: 1 });
    return () => removeLightSource(src);
  }, [spawn, color, intensity, y]);
}

/** One E per press: the authority answers; don't spam it while we wait. */
function useAct(spawn: RoomEventSpawn): () => void {
  const wait = useRef(0);
  return () => {
    const now = performance.now();
    if (now < wait.current) return;
    wait.current = now + 600;
    requestRoomAct(spawn.id);
  };
}

// ── Vault ────────────────────────────────────────────────────────────────────

type VaultState = Extract<RoomEventState, { kind: "vault" }>;

const LID_OPEN: Record<VaultState["phase"], number> = { sealed: 0, guarded: 0, open: 0.35, looted: 1.85 };

function Vault({ spawn, state }: { spawn: RoomEventSpawn; state: VaultState }) {
  const parts = useMemo(() => buildVault(), []);
  useEffect(() => () => disposeBuilt(parts), [parts]);
  const act = useAct(spawn);
  const sealed = state.phase === "sealed" || state.phase === "guarded";
  parts.chains.visible = sealed;
  parts.hoard.visible = state.phase === "open";
  // A faint red glow asleep (so it's found in a dark room), hard red while
  // guarded, gold once open, dark when emptied.
  useEventLight(
    spawn,
    state.phase === "looted" ? null : state.phase === "open" ? "#ffcf6a" : "#ff3b3b",
    state.phase === "open" ? 5 : state.phase === "guarded" ? 3 : 1.4,
    1.1,
  );
  const tmp = useMemo(() => new Color(), []);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    const lid = parts.lid;
    lid.rotation.x += (-LID_OPEN[state.phase] - lid.rotation.x) * 0.12;
    // The seal: a slow red pulse asleep, a hard flicker while guarded, gold once open.
    const seal = parts.seal;
    if (state.phase === "sealed") seal.emissiveIntensity = 1.6 + Math.sin(t * 2) * 0.6;
    else if (state.phase === "guarded") seal.emissiveIntensity = 2.5 + (Math.sin(t * 17) > 0 ? 1.5 : 0);
    else seal.emissiveIntensity = state.phase === "open" ? 2.4 : 0.3;
    seal.emissive.copy(tmp.set(sealed ? "#ff3b3b" : "#ffcf6a"));

    const d2 = nearSq(spawn);
    if (d2 > PROMPT_RANGE_SQ) return;
    const at: [number, number, number] = [spawn.pos[0], 1.5, spawn.pos[2]];
    if (state.phase === "sealed") offerInteraction("Sealed — something sleeps beside it", d2, () => {}, at);
    else if (state.phase === "guarded") offerInteraction("Sealed — its guardians must fall", d2, () => {}, at);
    else if (state.phase === "open") offerInteraction("E — Open the vault", d2, act, at);
  });

  return <primitive object={parts.root} />;
}

// ── Ward circle ──────────────────────────────────────────────────────────────

type WardState = Extract<RoomEventState, { kind: "ward" }>;

function Ward({ spawn, state }: { spawn: RoomEventSpawn; state: WardState }) {
  const color = roomEventDef("ward").color;
  const parts = useMemo(() => buildWard(ROOM_EVENT_RULES.wardRadius, color), [color]);
  useEffect(() => () => disposeBuilt(parts), [parts]);
  const act = useAct(spawn);
  const shown = useRef(state.progress);
  const live = state.phase === "kindled";
  useEventLight(spawn, state.phase === "broken" ? null : color, state.phase === "won" ? 4 : state.phase === "dormant" ? 1.4 : 2 + state.progress * 4, 1.2);

  useEffect(() => {
    if (state.phase !== "broken") return;
    // The stones lean and go dark.
    parts.stones.forEach((s, i) => {
      s.rotation.z += (i % 2 ? 1 : -1) * 0.25;
      s.position.y -= 0.15;
    });
  }, [state.phase, parts]);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    // Progress arrives a few times a second: ease toward it.
    shown.current += (state.progress - shown.current) * Math.min(1, dt * 6);
    const p = state.phase === "won" ? 1 : state.phase === "broken" ? 0 : shown.current;
    const lit = Math.round(p * WARD_RUNES);
    parts.runes.forEach((r, i) => (r.material = i < lit ? parts.runeOn : parts.runeOff));
    parts.glyphs.emissiveIntensity = state.phase === "broken" ? 0 : state.phase === "dormant" ? 0.7 + Math.sin(t * 1.3) * 0.25 : 1 + p * 2.6;
    parts.heart.rotation.y = t * (0.6 + p * 4);
    parts.heart.position.y = 1.1 + Math.sin(t * 2) * 0.06 + p * 0.5;
    parts.heart.visible = state.phase !== "broken";
    const beam = parts.beam;
    const h = live ? 0.4 + p * 7 : state.phase === "won" ? 7.5 : 0.001;
    beam.scale.y += (h - beam.scale.y) * 0.08;
    beam.position.y = beam.scale.y / 2;
    beam.visible = beam.scale.y > 0.01;

    const d2 = nearSq(spawn);
    const at: [number, number, number] = [spawn.pos[0], 1.8, spawn.pos[2]];
    if (state.phase === "dormant" && d2 < PROMPT_RANGE_SQ) offerInteraction("E — Kindle the ward · then hold the circle", d2, act, at);
    else if (live && d2 < ROOM_EVENT_RULES.wardRadius ** 2) offerInteraction(`Hold the circle · ${Math.floor(p * 100)}%`, d2, () => {}, at);
  });

  return <primitive object={parts.root} />;
}

// ── Shrine and fountain ──────────────────────────────────────────────────────

type OfferingState = Extract<RoomEventState, { kind: "shrine" | "fountain" }>;

function Offering({ spawn, state }: { spawn: RoomEventSpawn; state: OfferingState }) {
  const me = useNet((s) => s.playerId) || "self";
  const mine = state.takenBy.includes(me) || state.takenBy.includes("self");
  return state.kind === "shrine" ? <Shrine spawn={spawn} spent={mine} /> : <Fountain spawn={spawn} spent={mine} />;
}

function Shrine({ spawn, spent }: { spawn: RoomEventSpawn; spent: boolean }) {
  const boon = getBuffDef(shrineBoon(spawn.variant));
  const parts = useMemo(() => buildShrine(boon.color), [boon.color]);
  useEffect(() => () => disposeBuilt(parts), [parts]);
  const act = useAct(spawn);
  useEventLight(spawn, spent ? null : boon.color, 2.5, 1.3);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (spent) {
      playPactSworn();
      const top: [number, number, number] = [spawn.pos[0], 1.5, spawn.pos[2]];
      spawnBurst({ position: top, count: 30, color: [boon.color, "#ffffff"], speed: 3, ttl: 0.8, size: 0.08, style: "glow" });
    }
  }, [spent, spawn, boon.color]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    parts.flame.visible = !spent;
    parts.flame.scale.set(1 + Math.sin(t * 13) * 0.08, 1 + Math.sin(t * 7.3) * 0.15, 1);
    parts.eyes.emissiveIntensity = spent ? 0.2 : 2.2 + Math.sin(t * 2.2) * 0.8;
    const d2 = nearSq(spawn);
    if (d2 > PROMPT_RANGE_SQ) return;
    const at: [number, number, number] = [spawn.pos[0], 2.2, spawn.pos[2]];
    if (spent) offerInteraction("The shrine has nothing more for you", d2, () => {}, at);
    else offerInteraction(`E — Kneel: ${boon.name} (${boon.terms})`, d2, act, at);
  });

  return <primitive object={parts.root} />;
}

function Fountain({ spawn, spent }: { spawn: RoomEventSpawn; spent: boolean }) {
  const parts = useMemo(() => buildFountain(), []);
  useEffect(() => () => disposeBuilt(parts), [parts]);
  const act = useAct(spawn);
  useEventLight(spawn, spent ? null : "#5db9ff", 2, 0.8);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    if (spent) {
      playBubble([spawn.pos[0], 0.6, spawn.pos[2]]);
      spawnBurst({ position: [spawn.pos[0], 0.6, spawn.pos[2]], count: 26, color: ["#5db9ff", "#ffffff"], speed: 2.5, ttl: 0.9, size: 0.07, gravity: -3 });
    }
  }, [spent, spawn]);

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    parts.water.emissiveIntensity = spent ? 0.15 : 0.7 + Math.sin(t * 1.7) * 0.25;
    parts.fall.visible = !spent;
    const d2 = nearSq(spawn);
    if (d2 > PROMPT_RANGE_SQ) return;
    const at: [number, number, number] = [spawn.pos[0], 1.6, spawn.pos[2]];
    if (spent) offerInteraction("You have drunk your fill", d2, () => {}, at);
    else offerInteraction("E — Drink (mends body and mana)", d2, act, at);
  });

  return <primitive object={parts.root} />;
}
