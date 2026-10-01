import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, type MutableRefObject } from "react";
import type { Group } from "three";
import { PLAYER } from "../../../core/config";
import { gameEvents } from "../../../core/events";
import { computeStats } from "../../../items/catalog";
import { useGame } from "../../../state/gameStore";
import { uiNow } from "../../clock";
import { Plate } from "../../Plate";
import { RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { apx, fontPx, FRAME_TEXEL, plateSize } from "./ap";
import { HUD_COLORS, vitalText } from "./copy";
import { useStepFade } from "./fade";
import { kickSlosh, makeGauge, makeSlosh, stepGauge, stepSlosh } from "./gauge";
import { HudAnchor } from "./HudAnchor";
import { HUD_LAYOUT, VITALS } from "./layout";
import { useCarrierMotion, type CarrierMotion } from "./motion";
import { makeBarState, PixelBar, type BarState } from "./PixelBar";
import { PixelSprite } from "./PixelSprite";
import { useEntryDelay, useSettled } from "./useSettled";

/** Health and mana at the lower left, as the grimoire draws them: an iron-
 * framed panel with a heart and a drop, VITALITY / MANA in tiny caps, the
 * numbers on the right, and two segmented pixel bars (artpass hud/Vitals).
 *
 * The bars are still liquid, as the flasks were: the fill pours in as the
 * panel builds, leans as you turn and run, ripples and flashes white when
 * you're struck (and the whole panel shudders), leaves the pale ghost of
 * what a blow took to drain away a moment later, throbs when you're low,
 * and mana fizzes with rising sparks while it refills. */

const L = HUD_LAYOUT.vitals;
const A = apx(L.distance);
/** Labels one px over artpass's 8: Silkscreen must keep a whole screen pixel
 * per font pixel down to a 600 px tall window. */
const LABEL = fontPx(9, "label", L.distance);
const [PW, PH] = plateSize(VITALS.cssW, VITALS.cssH);
/** Content box top-left, plate-local ap pixels. */
const X0 = -VITALS.cssW / 2 + VITALS.padX;
const Y0 = VITALS.cssH / 2 - VITALS.padTop;

type Kind = "health" | "mana";

const ROWS: Record<Kind, { head: number; track: number; top: number; label: string }> = {
  health: { head: 16, track: 14, top: 0, label: "Vitality" },
  mana: { head: 18, track: 10, top: 16 + 2 + 14 + VITALS.gap, label: "Mana" },
};

export function Vitals() {
  const motion = useCarrierMotion();
  const shake = useRef<Group>(null);
  const hit = useRef({ at: -10, amp: 0 });
  useEffect(
    () =>
      gameEvents.on("playerHurt", ({ amount }) => {
        hit.current = { at: uiNow(), amp: Math.min(1, 0.35 + amount / 30) };
      }),
    [],
  );
  useFrame(() => {
    const g = shake.current;
    if (!g) return;
    // A blow jars the whole panel — in whole pixels, like a sprite.
    const since = uiNow() - hit.current.at;
    const a = since < 0.35 ? hit.current.amp * (1 - since / 0.35) : 0;
    const now = uiNow();
    g.position.set(Math.round(Math.sin(now * 83) * a * 2.4) * A, Math.round(Math.sin(now * 61) * a * 1.4) * A, 0);
  });

  return (
    <HudAnchor h={L.h} v={L.v} inset={L.inset} distance={L.distance}>
      <group position={[((PW + FRAME_TEXEL * 2) / 2) * A, ((PH + FRAME_TEXEL * 2) / 2) * A, 0]}>
        <group ref={shake}>
          <Plate width={PW * A} height={PH * A} frame="iron" texel={FRAME_TEXEL * A} fillOpacity={0.94}>
            <BarRow kind="health" motion={motion} hit={hit} />
            <BarRow kind="mana" motion={motion} hit={hit} />
          </Plate>
        </group>
      </group>
    </HudAnchor>
  );
}

/** Max health follows worn gear; mana's is fixed. */
function useMax(kind: Kind): number {
  const equipment = useGame((s) => s.equipment);
  return useMemo(() => (kind === "health" ? computeStats(equipment).maxHealth : PLAYER.maxMana), [kind, equipment]);
}

function BarRow({
  kind,
  motion,
  hit,
}: {
  kind: Kind;
  motion: MutableRefObject<CarrierMotion>;
  hit: MutableRefObject<{ at: number; amp: number }>;
}) {
  const row = ROWS[kind];
  const max = useMax(kind);
  const maxRef = useRef(max);
  maxRef.current = max;
  // Integer selector: mana regenerates every frame, but the number only
  // re-renders (and re-writes its last digit) when the integer changes.
  const raw = useGame((s) => Math.max(0, Math.ceil((kind === "health" ? s.health : s.mana) - 1e-6)));
  const value = useSettled(raw, 750);
  const low = kind === "health" && value / max < 0.3;
  const d = useEntryDelay(0.3);

  // Starts empty: the bar fills as the panel builds.
  const gauge = useRef(makeGauge(0));
  const slosh = useRef(makeSlosh());
  const bar = useRef<BarState>(makeBarState(0));
  const last = useRef(-1);
  const show = useStepFade({ delay: 0.15 + (kind === "mana" ? 0.08 : 0), inTime: 0.3, steps: 5 });

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
    // A mana spend is a small shove too.
    if (last.current >= 0 && frac < last.current - 0.04) kickSlosh(slosh.current, (Math.random() - 0.5) * 3, 1.5, 0.3);
    last.current = frac;
    const m = motion.current;
    // The liquid only pours in once the bar is there to hold it.
    stepGauge(gauge.current, show.current >= 1 ? frac : 0, dt);
    stepSlosh(slosh.current, m.fx, m.fz, dt);
    if (m.jolt > 0) kickSlosh(slosh.current, 0, 0, m.jolt);

    const now = uiNow();
    const b = bar.current;
    b.level = gauge.current.level;
    b.ghost = gauge.current.ghost;
    b.lean = slosh.current.x * 2;
    b.wave = slosh.current.wave;
    // Mana is a living thing: it fizzes while it refills.
    b.bubbles = kind === "mana" ? (frac < 0.999 ? 1 : 0.25) : 0;
    const since = now - hit.current.at;
    // A blow blanches the health bar, in three hard steps.
    const flare = kind === "health" && since < 0.3 ? hit.current.amp * (1 - since / 0.3) : 0;
    b.flash = Math.ceil(flare * 3) / 3;
    // Low health: the fill throbs like a pulse (stepped, as artpass's CSS).
    const beat = kind === "health" && frac < 0.3 ? Math.max(0, Math.sin(now * 7)) ** 4 : 0;
    b.bright = 1 + Math.round(beat * 3) / 3 * 0.45;
  });

  const headY = Y0 - row.top - row.head / 2;
  const trackY = Y0 - row.top - row.head - 2 - row.track / 2;
  const fill = kind === "health" ? (low ? HUD_COLORS.healthLow : HUD_COLORS.health) : HUD_COLORS.mana;
  return (
    <>
      <PixelSprite
        name={kind === "health" ? "heart" : "drop"}
        tint={kind === "health" ? ink.blood : ink.mana}
        texel={2 * A}
        position={[(X0 + 9) * A, headY * A, 0.002]}
        delay={0.2}
      />
      <RuneText text={row.label.toUpperCase()} font="label" px={LABEL} color={ink.faded} anchor={[0, 0.5]} align="left" position={[(X0 + 23) * A, headY * A, 0]} glow={0.25} outline={0.6} delay={0.25} />
      <RuneText
        text={vitalText(value, max)}
        font="label"
        px={LABEL}
        color={low ? HUD_COLORS.lowText : ink.parchmentDim}
        anchor={[1, 0.5]}
        align="right"
        position={[(X0 + VITALS.contentW) * A, headY * A, 0]}
        inDuration={0.2}
        stagger={0.04}
        glow={low ? 1 : 0.3}
        outline={0.6}
        delay={d}
      />
      <PixelBar
        width={VITALS.contentW}
        height={row.track}
        unit={A}
        fill={fill}
        segments={kind === "health" ? Math.max(4, Math.round(max / 10)) : Math.round(PLAYER.maxMana / 10)}
        state={bar}
        showRef={show}
        position={[(X0 + VITALS.contentW / 2) * A, trackY * A, 0.001]}
      />
    </>
  );
}
