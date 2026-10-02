import { useState } from "react";
import { useGame } from "../../../state/gameStore";
import type { FontId } from "../../font/faces";
import { UiPresence } from "../../presence";
import { RuneButton } from "../../RuneButton";
import { Tablet, TABLET_EXIT } from "../../Tablet";
import { RuneText } from "../../text/RuneText";
import { STEP, typePx } from "../../text/type";
import { ink } from "../../theme";
import { ArcaneCircle } from "./ArcaneCircle";
import { SoftGlow } from "./fx";
import { colsFor, KeyLegend, PixelIcon, spaced, TitleText } from "./grimoire";
import { CONTROLS, PREMISE, TENETS } from "./menuText";
import { NamePlaque } from "./NamePlaque";
import { Delayed, screenUnit, Stage, Veil } from "./stage";

/** The title screen — the grimoire's splash (artpass TitleScreen), standing
 * in the village night and building itself out of the dark:
 *
 *   - the veil gathers and the big faint magic circle draws itself behind,
 *     then turns slowly while pixel motes rise;
 *   - "WebMagic" burns into the air in blackletter, cast with its brass
 *     shadow, the tagline and the premise writing themselves under it;
 *   - the three laws of the dungeon arrive as three small stone tablets
 *     (each forges its iron trim, its pixel icon burns in, its words write);
 *   - then your name in its field, the way in ("✦ Become the Wizard ✦"),
 *     the settings, and the key caps of the controls, one after another.
 *
 * Layout is in screen-height units (stage.tsx), after artpass's 1280×800
 * title, a touch larger so it reads at 960×600 too. */

const D = 1.6;
const U = screenUnit(D);
/** RuneText px for step `n` of the type scale. */
const tp = (n: number, face?: FontId) => typePx(D, n, face);

const LOGO_Y = 0.305;
const CARD_W = 0.27;
const CARD_H = 0.136;
const CARD_X = 0.288;
const CARD_Y = 0.022;

export function MainMenu() {
  const phase = useGame((s) => s.phase);
  return (
    <UiPresence show={phase === "menu"} exit={TABLET_EXIT}>
      <Veil color="#030206" inner="#150f22" strength={0.95} center={0.86} cy={0.24} />
      <Stage distance={D} width={1.0}>
        <ArcaneCircle mood="arcane" distance={3.2} stageDistance={D} cy={0.24} delay={0.1} />
        <Logo />
        <Delayed by={0.9}>
          <Tenets />
        </Delayed>
        <Delayed by={1.5}>
          <TheWayIn />
        </Delayed>
        <Delayed by={2.0}>
          <KeyLegend
            entries={CONTROLS}
            px={tp(STEP.text)}
            maxWidth={0.86 * U}
            position={[0, -0.318 * U, 0]}
            step={0.05}
          />
        </Delayed>
      </Stage>
    </UiPresence>
  );
}

function Logo() {
  return (
    <>
      <SoftGlow color="#1fae96" width={0.95 * U} height={0.26 * U} position={[0, LOGO_Y * U, -0.04]} intensity={0.55} delay={0.6} fadeIn={1.4} breathe={0.25} />
      <TitleText text="WebMagic" px={tp(7, "title")} color="#f1e4c2" position={[0, LOGO_Y * U, 0]} delay={0.15} inDuration={1.1} stagger={0.8} depth={2.5} flicker={0.06} />
      <RuneText
        text={spaced("Dungeon of the Hundred Floors")}
        font="label"
        px={tp(STEP.text, "label")}
        color={ink.arcane}
        glow={0.5}
        position={[0, 0.212 * U, 0]}
        delay={0.9}
        stagger={0.6}
      />
      <RuneText
        text={PREMISE}
        px={tp(STEP.text)}
        maxCols={colsFor(0.6 * U, tp(STEP.text))}
        color={ink.parchmentDim}
        glow={0.25}
        position={[0, 0.15 * U, 0]}
        delay={1.1}
        stagger={1}
      />
    </>
  );
}

/** The three laws, each on a small tablet with an iron trim. */
function Tenets() {
  const pad = 0.016 * U;
  const iconPx = 0.0026 * U;
  // Jersey's capitals are 15 font pixels: drawn smaller they lose pixels.
  const headPx = tp(1, "heading");
  const bodyPx = tp(STEP.text);
  return (
    <>
      {TENETS.map((t, i) => {
        const x = (i - 1) * CARD_X * U;
        const left = (-CARD_W / 2) * U + pad;
        const top = (CARD_H / 2) * U - pad;
        const iconW = (t.icon === "pact" ? 15 : 7) * iconPx;
        return (
          <Delayed key={t.title} by={i * 0.15}>
            <group position={[x, CARD_Y * U, 0]}>
              <Tablet width={CARD_W * U} height={CARD_H * U} tile={0.13} thickness={0.04} frame="iron" tint="#231d29" tilt seed={21 + i} quiet={i > 0}>
                <PixelIcon name={t.icon} tint={t.tint} pixel={iconPx} position={[left + iconW / 2, top - 0.01 * U, 0.002]} delay={0.05} />
                <RuneText
                  text={t.title}
                  font="heading"
                  px={headPx}
                  color={ink.parchment}
                  glow={0.3}
                  anchor={[0, 0.5]}
                  position={[left + iconW + 0.012 * U, top - 0.01 * U, 0]}
                  delay={0.1}
                />
                <RuneText
                  text={t.text}
                  px={bodyPx}
                  maxCols={colsFor(CARD_W * U - pad * 2, bodyPx)}
                  align="left"
                  anchor={[0, 0]}
                  color={ink.parchmentDim}
                  glow={0.2}
                  position={[left, top - 0.034 * U, 0]}
                  delay={0.25}
                  stagger={0.7}
                />
              </Tablet>
            </group>
          </Delayed>
        );
      })}
    </>
  );
}

/** Your name, the way in, and the two settings. */
function TheWayIn() {
  const startGame = useGame((s) => s.startGame);
  const shadows = useGame((s) => s.shadows);
  const toggleShadows = useGame((s) => s.toggleShadows);
  const reflections = useGame((s) => s.reflections);
  const toggleReflections = useGame((s) => s.toggleReflections);
  const deepest = useGame((s) => s.deepest);
  const [editing, setEditing] = useState(false);
  const toggle = (label: string, on: boolean) => [
    { text: `${label}: ` },
    { text: on ? "on" : "off", color: on ? ink.arcane : ink.faded },
  ];
  return (
    <>
      <RuneText
        text={spaced(editing ? "Enter to seal it" : "Your name, wizard")}
        font="label"
        px={tp(STEP.text, "label")}
        color={editing ? ink.arcaneDim : ink.faded}
        glow={0.2}
        position={[0, -0.078 * U, 0]}
      />
      <NamePlaque px={tp(STEP.text)} width={0.3 * U} position={[0, -0.118 * U, 0]} onEditingChange={setEditing} />
      <RuneButton label="Become the Wizard" onPress={startGame} px={tp(STEP.text)} position={[0, -0.188 * U, 0]} delay={0.25} />
      <Delayed by={0.3}>
        <RuneButton
          label={toggle("Shadows", shadows)}
          variant="ghost"
          onPress={toggleShadows}
          px={tp(STEP.text)}
          width={0.15 * U}
          color={ink.parchmentDim}
          position={[-0.085 * U, -0.25 * U, 0]}
          delay={0.1}
        />
        <RuneButton
          label={toggle("Reflections", reflections)}
          variant="ghost"
          onPress={toggleReflections}
          px={tp(STEP.text)}
          width={0.15 * U}
          color={ink.parchmentDim}
          position={[0.085 * U, -0.25 * U, 0]}
          delay={0.15}
        />
      </Delayed>
      {deepest > 0 && (
        <RuneText
          text={[
            { text: spaced("Deepest walked home") + "   ", color: ink.faded },
            { text: `FLOOR ${deepest}`, color: ink.brassLight },
          ]}
          font="label"
          px={tp(STEP.text, "label")}
          position={[0, -0.415 * U, 0]}
          delay={1.2}
        />
      )}
    </>
  );
}
