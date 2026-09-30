import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { Group } from "three";
import { PLAYER } from "../../../core/config";
import { gameEvents } from "../../../core/events";
import { computeStats } from "../../../items/catalog";
import { useGame } from "../../../state/gameStore";
import { palette } from "../../../ui/theme";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { metalMaterial } from "../../materials";
import { RuneText } from "../../text/RuneText";
import { HUD_COLORS, vitalNumbers } from "./copy";
import { corkMaterial, flaskGeometry, FLASK_TOP, makeGlassMaterial, makeLiquidMaterial } from "./flaskMaterials";
import { kickSlosh, levelToHeight, makeGauge, makeSlosh, stepGauge, stepSlosh } from "./gauge";
import { glowQuad, makeGlowMaterial } from "./glow";
import { HudAnchor, hudUnit, Undistort } from "./HudAnchor";
import { HUD_LAYOUT, VITALS } from "./layout";
import { Materialize } from "./Materialize";
import { useCarrierMotion, type CarrierMotion } from "./motion";
import { useEntryDelay, useSettled } from "./useSettled";

/** Health and mana as two glass flasks carried at the lower left, their
 * glowing liquid standing exactly as high as the value. The liquid sloshes
 * as you turn and run, bubbles, fizzes away where a loss just was (the
 * gauge's ghost), and pours back in as you heal. A hit makes the health
 * flask shudder and its liquid flare white-hot. The numbers are written in
 * the air beside each flask, the max dim beneath. */

const L = HUD_LAYOUT.vitals;
const U = hudUnit(L.distance);
const R = VITALS.flaskR * U;
const BIG = pxFor(L.distance, VITALS.bigText);
const SMALL = pxFor(L.distance, VITALS.smallText);
const MANA_X = VITALS.manaX * U;
const NUM_DX = R + VITALS.gap * U;

type Kind = "health" | "mana";

export function Vitals() {
  const motion = useCarrierMotion();
  return (
    <HudAnchor h={L.h} v={L.v} inset={L.inset} distance={L.distance}>
      <Flask kind="health" at={[R * 1.05, R, 0]} motion={motion} />
      <VitalNumber kind="health" at={[R + NUM_DX, R * 0.95, 0]} />
      <Flask kind="mana" at={[MANA_X, R, 0]} motion={motion} delay={0.12} />
      <VitalNumber kind="mana" at={[MANA_X + NUM_DX, R * 0.95, 0]} />
    </HudAnchor>
  );
}

/** Max health follows worn gear; mana's is fixed. */
function useMax(kind: Kind): number {
  const equipment = useGame((s) => s.equipment);
  return useMemo(() => (kind === "health" ? computeStats(equipment).maxHealth : PLAYER.maxMana), [kind, equipment]);
}

function VitalNumber({ kind, at }: { kind: Kind; at: readonly [number, number, number] }) {
  // Integer selector: mana regenerates every frame, but the number only
  // re-renders (and re-writes its last digit) when the integer changes.
  const raw = useGame((s) => Math.max(0, Math.ceil((kind === "health" ? s.health : s.mana) - 1e-6)));
  const value = useSettled(raw, 750);
  const max = useMax(kind);
  const text = vitalNumbers(value, max);
  const low = kind === "health" && value / max < 0.3;
  const d = useEntryDelay(0.35);
  const color = kind === "health" ? (low ? "#ff6a5a" : "#f6d2c8") : "#cfe0ff";
  return (
    <group position={at as [number, number, number]}>
      <RuneText text={text.now} px={BIG} color={color} anchor={[0, 1]} align="left" position={[0, BIG * 5, 0]} inDuration={0.2} stagger={0.04} glow={low ? 1.5 : 0.8} outline={0.55} delay={d} />
      <RuneText text={text.max} px={SMALL} color={palette.dim} anchor={[0, 1]} align="left" position={[0, -BIG * 3.4, 0]} glow={0.4} outline={0.5} delay={d * 1.4} />
    </group>
  );
}

function Flask({
  kind,
  at,
  motion,
  delay = 0,
}: {
  kind: Kind;
  at: readonly [number, number, number];
  motion: MutableRefObject<CarrierMotion>;
  delay?: number;
}) {
  const g = flaskGeometry();
  const color = kind === "health" ? HUD_COLORS.health : HUD_COLORS.mana;
  const deep = kind === "health" ? HUD_COLORS.healthDeep : HUD_COLORS.manaDeep;
  const liquid = useMemo(() => makeLiquidMaterial(color, deep), [color, deep]);
  const glass = useMemo(() => makeGlassMaterial(kind === "health" ? "#ffd0c8" : "#cfe2ff", false), [kind]);
  const glassBack = useMemo(() => makeGlassMaterial(kind === "health" ? "#ffd0c8" : "#cfe2ff", true), [kind]);
  const halo = useMemo(() => makeGlowMaterial(color, 0.3), [color]);
  useEffect(
    () => () => {
      liquid.dispose();
      glass.dispose();
      glassBack.dispose();
      halo.dispose();
    },
    [liquid, glass, glassBack, halo],
  );

  const max = useMax(kind);
  const maxRef = useRef(max);
  maxRef.current = max;
  // Starts empty: the flask fills as it materializes.
  const gauge = useRef(makeGauge(0));
  const slosh = useRef(makeSlosh());
  const hit = useRef({ at: -10, amp: 0 });
  const last = useRef(-1);
  const shaker = useRef<Group>(null);

  useEffect(() => {
    if (kind !== "health") return;
    return gameEvents.on("playerHurt", ({ amount }) => {
      const amp = Math.min(1, 0.35 + amount / 30);
      hit.current = { at: uiNow(), amp };
      const side = Math.random() < 0.5 ? -1 : 1;
      kickSlosh(slosh.current, side * (2 + amp * 5), (Math.random() - 0.5) * 4, 0.6 * amp + 0.2);
    });
  }, [kind]);

  useFrame((_, dt) => {
    const s = useGame.getState();
    const value = kind === "health" ? s.health : s.mana;
    const frac = value / Math.max(1, maxRef.current);
    // A mana spend is a small shove too.
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
    // Mana is a living thing: it bubbles while it refills.
    u.uBubbles.value = kind === "mana" ? (frac < 0.999 ? 0.9 : 0.35) : 0.2 + (gauge.current.ghost - gauge.current.level) * 2;

    // Damage: a flare and a shudder, both decaying fast.
    const since = now - hit.current.at;
    const flare = since < 0.6 ? Math.exp(-since * 7) * hit.current.amp : 0;
    // Low health: the liquid's glow beats like a pulse.
    const lowBeat = kind === "health" && frac < 0.3 ? Math.max(0, Math.sin(now * 7)) ** 6 * 0.35 * (1 - frac / 0.3) : 0;
    u.uFlash.value = Math.max(flare, lowBeat);
    glass.uniforms.uFlash.value = flare;
    halo.uniforms.uIntensity.value = 0.12 + gauge.current.level * 0.3 + flare * 0.9 + lowBeat;
    const sh = shaker.current;
    if (sh) {
      const a = since < 0.5 ? Math.exp(-since * 9) * hit.current.amp : 0;
      sh.position.set(Math.sin(now * 83) * a * R * 0.18, Math.sin(now * 61) * a * R * 0.08, 0);
      sh.rotation.z = Math.sin(now * 57) * a * 0.14;
    }
  });

  return (
    <Undistort at={at}>
      <Materialize delay={0.1 + delay} color={color} size={R * 1.6} from={[0, -R * 0.8, -R * 5]}>
        <mesh geometry={glowQuad()} material={halo} position={[0, R * 0.1, -R * 1.3]} scale={R * 5.5} renderOrder={0} />
        <group ref={shaker} scale={R}>
          <mesh geometry={g.liquid} material={liquid} renderOrder={1} />
          <mesh geometry={g.glass} material={glassBack} renderOrder={2} />
          <mesh geometry={g.glass} material={glass} renderOrder={4} />
          <mesh geometry={g.band} material={metalMaterial("#9a7d4a")} position={[0, 1.04, 0]} rotation={[Math.PI / 2, 0, 0]} />
          <mesh geometry={g.cork} material={corkMaterial()} position={[0, FLASK_TOP + 0.02, 0]} />
        </group>
      </Materialize>
    </Undistort>
  );
}
