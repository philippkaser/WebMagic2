import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { Group } from "three";
import { PLAYER } from "../../../core/config";
import { gameEvents } from "../../../core/events";
import { computeStats } from "../../../items/catalog";
import { useGame } from "../../../state/gameStore";
import { uiNow } from "../../clock";
import { RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { apx, fontPx } from "./ap";
import { HUD_COLORS } from "./copy";
import { kickSlosh, makeGauge, makeSlosh, stepGauge, stepSlosh } from "./gauge";
import { glowQuad, makeGlowMaterial } from "./glow";
import { HudAnchor, Undistort } from "./HudAnchor";
import { HUD_LAYOUT, VITALS } from "./layout";
import { Materialize } from "./Materialize";
import { useCarrierMotion, type CarrierMotion } from "./motion";
import { levelToHeight, makeGlassMaterial, makeLiquidMaterial, orbGeometry } from "./orbMaterials";
import { useEntryDelay, useSettled } from "./useSettled";

/** Health and mana as two glass orbs carried at the lower left — real
 * spheres lit by the UI's torch (orbMaterials.ts), their glowing liquid
 * standing exactly as high as the value. Carry them and they slosh: the
 * surface leans as you turn and run, ripples when you land, bubbles
 * (mana churns while it refills), pours in as you heal. The glass turns
 * slowly, and its little facets catch the torch one pixel at a time. A
 * blow jars the health orb, blanches its liquid white-hot and leaves a pale
 * ghost of what it took, fizzing away a moment later; under 30 % the liquid
 * throbs like a pulse. The numbers stand beside each orb, the max dim
 * beneath. */

const L = HUD_LAYOUT.vitals;
const A = apx(L.distance);
const R = (VITALS.orb / 2) * A;
const NUM = fontPx(21, "body", L.distance);
const MAX = fontPx(10, "label", L.distance);

type Kind = "health" | "mana";

const LOOK: Record<Kind, { color: string; deep: string; tint: string }> = {
  health: { color: "#e0302c", deep: "#3a060c", tint: "#ffd0c8" },
  mana: { color: "#3f86ff", deep: "#0a1442", tint: "#cfe2ff" },
};

export function Vitals() {
  const motion = useCarrierMotion();
  const hit = useRef({ at: -10, amp: 0 });
  useEffect(
    () =>
      gameEvents.on("playerHurt", ({ amount }) => {
        hit.current = { at: uiNow(), amp: Math.min(1, 0.35 + amount / 30) };
      }),
    [],
  );
  return (
    <HudAnchor h={L.h} v={L.v} inset={L.inset} distance={L.distance}>
      <OrbBlock kind="health" x={0} motion={motion} hit={hit} />
      <OrbBlock kind="mana" x={(VITALS.blockW + VITALS.between) * A} motion={motion} hit={hit} />
    </HudAnchor>
  );
}

/** Max health follows worn gear; mana's is fixed. */
function useMax(kind: Kind): number {
  const equipment = useGame((s) => s.equipment);
  return useMemo(() => (kind === "health" ? computeStats(equipment).maxHealth : PLAYER.maxMana), [kind, equipment]);
}

function OrbBlock({
  kind,
  x,
  motion,
  hit,
}: {
  kind: Kind;
  x: number;
  motion: MutableRefObject<CarrierMotion>;
  hit: MutableRefObject<{ at: number; amp: number }>;
}) {
  const max = useMax(kind);
  const maxRef = useRef(max);
  maxRef.current = max;
  // Integer selector: mana regenerates every frame, but the number only
  // re-renders (and re-writes its last digit) when the integer changes.
  const raw = useGame((s) => Math.max(0, Math.ceil((kind === "health" ? s.health : s.mana) - 1e-6)));
  const value = useSettled(raw, 750);
  const low = kind === "health" && value / max < 0.3;
  const d = useEntryDelay(0.35);

  const look = LOOK[kind];
  const g = orbGeometry();
  const liquid = useMemo(() => makeLiquidMaterial(look.color, look.deep), [look]);
  const glass = useMemo(() => makeGlassMaterial(look.tint, false), [look]);
  const glassBack = useMemo(() => makeGlassMaterial(look.tint, true), [look]);
  const halo = useMemo(() => makeGlowMaterial(look.color, 0.15), [look]);
  useEffect(
    () => () => {
      liquid.dispose();
      glass.dispose();
      glassBack.dispose();
      halo.dispose();
    },
    [liquid, glass, glassBack, halo],
  );

  // Starts empty: the orb fills as it materializes.
  const gauge = useRef(makeGauge(0));
  const slosh = useRef(makeSlosh());
  const last = useRef(-1);
  const shaker = useRef<Group>(null);
  const spin = useRef<Group>(null);
  const facing = useRef<Group>(null);

  useEffect(() => {
    if (kind !== "health") return;
    return gameEvents.on("playerHurt", ({ amount }) => {
      const amp = Math.min(1, 0.35 + amount / 30);
      const side = Math.random() < 0.5 ? -1 : 1;
      kickSlosh(slosh.current, side * (2 + amp * 5), (Math.random() - 0.5) * 4, 0.6 * amp + 0.2);
    });
  }, [kind]);

  useFrame(({ camera }, dt) => {
    // Held square to the eye: the orb (and its liquid's "up") faces the
    // eye along the line of sight, so the level reads from the side rather
    // than as a surface seen from above.
    const f = facing.current;
    if (f) {
      f.quaternion.identity();
      f.parent?.updateWorldMatrix(true, false);
      f.lookAt(camera.position);
    }
    const s = useGame.getState();
    const v = kind === "health" ? s.health : s.mana;
    const frac = v / Math.max(1, maxRef.current);
    // A spell's mana leaving is a small shove too.
    if (last.current >= 0 && frac < last.current - 0.04) kickSlosh(slosh.current, (Math.random() - 0.5) * 3, 1.5, 0.3);
    last.current = frac;
    const m = motion.current;
    stepGauge(gauge.current, frac, dt);
    stepSlosh(slosh.current, m.fx, m.fz, dt);
    if (m.jolt > 0) kickSlosh(slosh.current, 0, 0, m.jolt);

    const now = uiNow();
    const u = liquid.uniforms;
    u.uTime.value = now;
    u.uLevel.value = levelToHeight(gauge.current.level);
    u.uGhost.value = levelToHeight(gauge.current.ghost);
    u.uTilt.value.set(slosh.current.x, slosh.current.z);
    u.uWave.value = slosh.current.wave;
    // Mana is a living thing: it churns while it refills.
    u.uBubbles.value = kind === "mana" ? (frac < 0.999 ? 0.9 : 0.35) : 0.2 + (gauge.current.ghost - gauge.current.level) * 2;

    // Damage: a flare and a shudder, both decaying fast.
    const since = now - hit.current.at;
    const flare = kind === "health" && since < 0.6 ? Math.exp(-since * 7) * hit.current.amp : 0;
    // Low health: the liquid's glow beats like a pulse.
    const lowBeat = kind === "health" && frac < 0.3 ? Math.max(0, Math.sin(now * 7)) ** 6 * 0.35 * (1 - frac / 0.3) : 0;
    u.uFlash.value = Math.max(flare, lowBeat);
    glass.uniforms.uFlash.value = flare;
    glass.uniforms.uTime.value = now;
    halo.uniforms.uIntensity.value = 0.04 + gauge.current.level * 0.1 + flare * 0.7 + lowBeat;
    const sh = shaker.current;
    if (sh) {
      const a = since < 0.5 ? Math.exp(-since * 9) * hit.current.amp : 0;
      sh.position.set(Math.sin(now * 83) * a * R * 0.18, Math.sin(now * 61) * a * R * 0.08, 0);
      sh.rotation.z = Math.sin(now * 57) * a * 0.14;
    }
    // The glass turns slowly, so its facets catch the torch one by one.
    if (spin.current) spin.current.rotation.y = now * 0.35 + (kind === "mana" ? 2 : 0);
  });

  const color = kind === "health" ? (low ? HUD_COLORS.lowText : "#f6d2c8") : "#cfe0ff";
  const numX = x + (VITALS.orb + VITALS.gap) * A;
  return (
    <>
      <Undistort at={[x + R, R, 0]}>
        <Materialize delay={0.1 + (kind === "mana" ? 0.12 : 0)} color={look.color} size={R * 1.6} from={[0, -R * 0.8, -R * 5]}>
          <mesh geometry={glowQuad()} material={halo} position={[0, 0, -R * 1.3]} scale={R * 5} renderOrder={0} />
          <group ref={facing}>
            <group ref={shaker} scale={R}>
              <mesh geometry={g.liquid} material={liquid} renderOrder={1} />
              <group ref={spin}>
                <mesh geometry={g.glass} material={glassBack} renderOrder={2} />
                <mesh geometry={g.glass} material={glass} renderOrder={4} />
              </group>
            </group>
          </group>
        </Materialize>
      </Undistort>
      <RuneText
        text={`${value}`}
        px={NUM}
        color={color}
        anchor={[0, 0.5]}
        align="left"
        position={[numX, R * 1.22, 0]}
        inDuration={0.2}
        stagger={0.04}
        glow={low ? 1.2 : 0.3}
        outline={0.6}
        delay={d}
      />
      <RuneText
        text={`/ ${Math.round(max)}`}
        font="label"
        px={MAX}
        color={ink.faded}
        anchor={[0, 0.5]}
        align="left"
        position={[numX, R * 0.62, 0]}
        glow={0.3}
        outline={0.6}
        delay={d * 1.3}
      />
    </>
  );
}
