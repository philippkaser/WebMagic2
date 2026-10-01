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
import { useStepFade } from "./fade";
import { kickSlosh, makeGauge, makeSlosh, stepGauge, stepSlosh } from "./gauge";
import { HudAnchor } from "./HudAnchor";
import { HUD_LAYOUT, VITALS } from "./layout";
import { useCarrierMotion, type CarrierMotion } from "./motion";
import { makeOrbMaterial, ORB_PALETTES, PixelOrb } from "./PixelOrb";
import { useEntryDelay, useSettled } from "./useSettled";

/** Health and mana as two glass orbs carried at the lower left — real
 * spheres, shaded in gritty pixels (PixelOrb) — their liquid standing
 * exactly as high as the value and level with the world (look down and
 * you see its surface from above). Carry them and they slosh: the surface
 * leans as you turn and run, ripples when you land, bubbles and sparks
 * (mana churns while it refills), pours in as you heal. A blow jars the
 * health orb, blanches its liquid white-hot and leaves a pale ghost of
 * what it took, fizzing away a moment later; under 30 % the liquid throbs
 * like a pulse. The numbers stand beside each orb, the max dim beneath. */

const L = HUD_LAYOUT.vitals;
const A = apx(L.distance);
const R = (VITALS.orb / 2) * A;
const NUM = fontPx(21, "body", L.distance);
const MAX = fontPx(10, "label", L.distance);

type Kind = "health" | "mana";

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
      <FlaskBlock kind="health" x={0} motion={motion} hit={hit} />
      <FlaskBlock kind="mana" x={(VITALS.blockW + VITALS.between) * A} motion={motion} hit={hit} />
    </HudAnchor>
  );
}

/** Max health follows worn gear; mana's is fixed. */
function useMax(kind: Kind): number {
  const equipment = useGame((s) => s.equipment);
  return useMemo(() => (kind === "health" ? computeStats(equipment).maxHealth : PLAYER.maxMana), [kind, equipment]);
}

function FlaskBlock({
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

  const material = useMemo(() => makeOrbMaterial(ORB_PALETTES[kind]), [kind]);
  // Starts empty: the orb fills once its glass has popped in.
  const gauge = useRef(makeGauge(0));
  const slosh = useRef(makeSlosh());
  const last = useRef(-1);
  const shaker = useRef<Group>(null);
  const reveal = useStepFade({ delay: 0.1 + (kind === "mana" ? 0.12 : 0), inTime: 0.45, outTime: 0.35, steps: 14 });

  useEffect(() => {
    if (kind !== "health") return;
    return gameEvents.on("playerHurt", ({ amount }) => {
      const amp = Math.min(1, 0.35 + amount / 30);
      const side = Math.random() < 0.5 ? -1 : 1;
      kickSlosh(slosh.current, side * (2 + amp * 5), (Math.random() - 0.5) * 4, 0.6 * amp + 0.2);
    });
  }, [kind]);

  useFrame((_, dt) => {
    const s = useGame.getState();
    const v = kind === "health" ? s.health : s.mana;
    const frac = v / Math.max(1, maxRef.current);
    // A spell's mana leaving is a small shove too.
    if (last.current >= 0 && frac < last.current - 0.04) kickSlosh(slosh.current, (Math.random() - 0.5) * 3, 1.5, 0.3);
    last.current = frac;
    const m = motion.current;
    stepGauge(gauge.current, reveal.current >= 1 ? frac : 0, dt);
    stepSlosh(slosh.current, m.fx, m.fz, dt);
    if (m.jolt > 0) kickSlosh(slosh.current, 0, 0, m.jolt);

    const now = uiNow();
    const u = material.uniforms;
    u.uTime.value = now;
    u.uReveal.value = reveal.current;
    u.uLevel.value = gauge.current.level;
    u.uGhost.value = gauge.current.ghost;
    u.uTilt.value.set(slosh.current.x, slosh.current.z);
    u.uWave.value = slosh.current.wave;
    // Mana is a living thing: it fizzes while it refills.
    u.uBubbles.value = kind === "mana" ? (frac < 0.999 ? 0.9 : 0.3) : 0.15 + (gauge.current.ghost - gauge.current.level) * 3;
    const since = now - hit.current.at;
    // A blow blanches the health orb, in three hard steps.
    const flare = kind === "health" && since < 0.35 ? hit.current.amp * (1 - since / 0.35) : 0;
    u.uFlash.value = Math.ceil(flare * 3) / 3;
    // Low health: the liquid throbs like a pulse (stepped).
    const beat = kind === "health" && frac < 0.3 ? Math.max(0, Math.sin(now * 7)) ** 4 : 0;
    u.uBright.value = 1 + (Math.round(beat * 3) / 3) * 0.5;

    // The blow jars the orb.
    const g = shaker.current;
    if (g) {
      const a = kind === "health" && since < 0.35 ? hit.current.amp * (1 - since / 0.35) : 0;
      g.position.set(Math.sin(now * 83) * a * R * 0.09, Math.sin(now * 61) * a * R * 0.05, 0);
    }
  });

  const color = kind === "health" ? (low ? HUD_COLORS.lowText : "#f6d2c8") : "#cfe0ff";
  const numX = x + (VITALS.orb + VITALS.gap) * A;
  return (
    <>
      <group position={[x + R, R, 0]}>
        <group ref={shaker}>
          <PixelOrb material={material} radius={R} />
        </group>
      </group>
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
