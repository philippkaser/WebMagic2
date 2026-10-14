import { useStats } from "../../../state/useStats";
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import { Color, Vector3, type Group } from "three";
import { PLAYER } from "../../../core/config";
import { gameEvents } from "../../../core/events";
import { heart, releaseOf } from "../../../game/heart";
import { LAST_STAND } from "../../../game/vitality";
import { useGame } from "../../../state/gameStore";
import { uiNow } from "../../clock";
import { RuneText } from "../../text/RuneText";
import { emitUiSparks } from "../../UiSparks";
import { ink } from "../../theme";
import { apx, fontPx } from "./ap";
import { HUD_COLORS } from "./copy";
import { kickSlosh, makeGauge, makeSlosh, stepGauge, stepSlosh } from "./gauge";
import { glowQuad, makeGlowMaterial } from "./glow";
import { HudAnchor, Undistort } from "./HudAnchor";
import { HUD_LAYOUT, VITALS } from "./layout";
import { Materialize } from "./Materialize";
import { useCarrierMotion, type CarrierMotion } from "./motion";
import { heightForFill, makeGlassMaterial, makeLiquidMaterial, orbGeometry } from "./orbMaterials";
import { useEntryDelay, useSettled } from "./useSettled";

/** Health and mana as two glass orbs carried at the lower left — real
 * spheres lit by the UI's torch (orbMaterials.ts), their glowing liquid
 * covering exactly as much of the orb as the value (heightForFill: a
 * sphere is narrow at the bottom, so 30 % health holds 30 % of the glass,
 * not a quarter). Carry them and they slosh: the surface leans as you turn
 * and run, ripples when you land, bubbles (mana churns while it refills),
 * pours in as you heal. The glass turns slowly, and its little facets catch
 * the torch one pixel at a time. A blow jars the health orb, blanches its
 * liquid white-hot and leaves a pale ghost of what it took, fizzing away a
 * moment later.
 *
 * A brass line is etched round the health orb at the last stand (30 %).
 * Below it the liquid burns a brighter red and throbs with your one heart
 * (game/heart), in time with the vignette, the image and the thud in your
 * ears; heal back over it (a second wind) and the orb pours bright, sparks
 * ringing it. The numbers stand beside each orb, the max dim beneath. */

const L = HUD_LAYOUT.vitals;
const A = apx(L.distance);
const R = (VITALS.orb / 2) * A;
const NUM = fontPx(21, "body", L.distance);
const MAX = fontPx(13, "body", L.distance);

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

/** The last stand's red (copy.ts: the brighter fill under 30 %). */
const LOW_RED = new Color(HUD_COLORS.healthLow);
const sparkAt = new Vector3();

/** Max health follows worn gear and blessings; mana's is fixed. */
function useMax(kind: Kind): number {
  const stats = useStats();
  return kind === "health" ? stats.maxHealth : PLAYER.maxMana;
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
  const low = kind === "health" && value / max < LAST_STAND.below;
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

  // A second wind: the orb pours bright.
  const pour = useRef({ at: -10, amp: 0, sparks: false });
  const baseColor = useMemo(() => new Color(look.color), [look]);

  useEffect(() => {
    if (kind !== "health") return;
    const offs = [
      gameEvents.on("playerHurt", ({ amount }) => {
        const amp = Math.min(1, 0.35 + amount / 30);
        const side = Math.random() < 0.5 ? -1 : 1;
        kickSlosh(slosh.current, side * (2 + amp * 5), (Math.random() - 0.5) * 4, 0.6 * amp + 0.2);
      }),
      gameEvents.on("wizardHealed", ({ from, to, max }) => {
        const r = releaseOf(from / max, to / max);
        if (r <= 0) return;
        pour.current = { at: uiNow(), amp: r, sparks: true };
        kickSlosh(slosh.current, 0, 0, 0.7);
      }),
    ];
    // The last-stand line, etched on the glass where the liquid stands at 30 %.
    const line = heightForFill(LAST_STAND.below);
    for (const m of [glass, glassBack]) {
      m.uniforms.uMark.value = line;
      m.uniforms.uMarkOn.value = 1;
    }
    return () => offs.forEach((off) => off());
  }, [kind, glass, glassBack]);

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
    u.uLevel.value = heightForFill(gauge.current.level);
    u.uGhost.value = heightForFill(gauge.current.ghost);
    u.uTilt.value.set(slosh.current.x, slosh.current.z);
    u.uWave.value = slosh.current.wave;
    const isHealth = kind === "health";
    // A second wind pouring in: bright, churning, a ring of sparks.
    const sincePour = now - pour.current.at;
    const poured = isHealth && sincePour < 1.2 ? Math.exp(-sincePour * 3) * pour.current.amp : 0;
    // Mana is a living thing: it churns while it refills.
    u.uBubbles.value =
      kind === "mana" ? (frac < 0.999 ? 0.9 : 0.35) : 0.2 + (gauge.current.ghost - gauge.current.level) * 2 + poured * 1.6;

    // Damage: a flare and a shudder, both decaying fast.
    const since = now - hit.current.at;
    const flare = isHealth && since < 0.6 ? Math.exp(-since * 7) * hit.current.amp : 0;
    // The last stand: the liquid's glow beats with the one heart, and it
    // burns a brighter red the nearer death.
    const lowBeat = isHealth ? heart.beat * (0.12 + 0.3 * heart.felt) : 0;
    if (isHealth) u.uColor.value.lerpColors(baseColor, LOW_RED, heart.low > 0 ? 0.45 + 0.55 * heart.low : 0);
    u.uFlash.value = Math.max(flare, lowBeat, poured * 0.65);
    glass.uniforms.uFlash.value = Math.max(flare, poured * 0.5);
    glass.uniforms.uTime.value = now;
    halo.uniforms.uIntensity.value = 0.04 + gauge.current.level * 0.1 + flare * 0.7 + lowBeat + poured * 0.6;
    const sh0 = shaker.current;
    if (pour.current.sparks && sh0) {
      pour.current.sparks = false;
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        sparkAt.set(Math.cos(a) * 1.15, Math.sin(a) * 1.15, 0.2);
        sh0.localToWorld(sparkAt);
        emitUiSparks({ position: [sparkAt.x, sparkAt.y, sparkAt.z], color: i % 2 ? "#ff9a7a" : "#ffe0c0", count: 2, speed: 0.05, up: 0.04, size: R * 0.14, spread: R * 0.1, ttl: 0.9 });
      }
    }
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
        font="body"
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
