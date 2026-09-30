import { useState } from "react";
import { useGame } from "../../../state/gameStore";
import { pxFor } from "../../anchors";
import { UiPresence } from "../../presence";
import { RuneButton } from "../../RuneButton";
import { Tablet, TABLET_EXIT } from "../../Tablet";
import { RuneText } from "../../text/RuneText";
import { NamePlaque } from "./NamePlaque";
import { CONTROLS, controlsLegend, MENU_INK, PREMISE } from "./menuText";
import { SoftGlow } from "./fx";
import { Delayed, screenUnit, Stage, Veil } from "./stage";
import { Wisps, type WispOrbit } from "./Wisps";

/** The title screen, standing in the village night: WEBMAGIC burns itself
 * into the air far ahead with wisps of light circling it, and below it an
 * altarpiece of three stone tablets assembles out of the dark — the premise
 * in the middle with the way in, your name and the settings on the left
 * wing, the controls carved into the right.
 *
 * Layout is in screen-height units (stage.tsx): the tablets stand 1.6 m
 * ahead, the title further back at 2.4 m so the wisps can pass behind it. */

const D = 1.6;
const U = screenUnit(D);
/** The title hangs further back than the tablets. */
const TITLE_D = 2.4;
const TU = screenUnit(TITLE_D);

const px = (cap: number) => pxFor(D, cap);

const CENTER_W = 0.64;
const WING_W = 0.36;
const WING_H = 0.4;
const WING_X = 0.535;
const WING_Y = -0.035;
/** Wings angle toward you, like an altarpiece's. */
const WING_TURN = 0.22;

const ORBITS: readonly WispOrbit[] = [
  { color: MENU_INK.accent, speed: 0.9, phase: 0, rx: 0.52 * TU, rz: 0.2 * TU, tilt: 0.12, bob: 0.01 * TU },
  { color: "#b89cff", speed: -0.7, phase: 2.1, rx: 0.47 * TU, rz: 0.16 * TU, tilt: -0.18, bob: 0.015 * TU },
  { color: "#ffc88f", speed: 0.55, phase: 4.2, rx: 0.56 * TU, rz: 0.24 * TU, tilt: 0.05, bob: 0.008 * TU },
];

export function MainMenu() {
  const phase = useGame((s) => s.phase);
  return (
    <UiPresence show={phase === "menu"} exit={TABLET_EXIT}>
      <Veil color="#06030b" strength={0.78} center={0.4} />
      <Stage distance={D} width={1.56}>
        <Title />
        <PremiseTablet />
        <Delayed by={0.25}>
          <NameWing />
        </Delayed>
        <Delayed by={0.4}>
          <ControlsWing />
        </Delayed>
      </Stage>
    </UiPresence>
  );
}

function Title() {
  const z = D - TITLE_D;
  return (
    <group position={[0, 0, z]}>
      <SoftGlow color="#1fae96" width={1.25 * TU} height={0.32 * TU} position={[0, 0.345 * TU, -0.05]} intensity={0.9} delay={0.5} fadeIn={1.6} />
      <RuneText
        text="WEBMAGIC"
        px={pxFor(TITLE_D, 0.1)}
        position={[0, 0.345 * TU, 0]}
        color="#dffcf2"
        // The font's halo is per-texel — blocky at title size; SoftGlow
        // throws the title's light instead.
        glow={0}
        flicker={0.08}
        inDuration={1.1}
        stagger={0.9}
        delay={0.15}
        depth={2.5}
      />
      <RuneText
        text="DUNGEON OF THE HUNDRED FLOORS"
        px={pxFor(TITLE_D, 0.023)}
        position={[0, 0.247 * TU, 0]}
        color={MENU_INK.lavender}
        glow={0.9}
        delay={1.1}
        stagger={0.7}
      />
      <Wisps orbits={ORBITS} delay={1.3} size={0.035} position={[0, 0.345 * TU, 0]} />
    </group>
  );
}

function PremiseTablet() {
  const startGame = useGame((s) => s.startGame);
  return (
    <group position={[0, -0.02 * U, 0]}>
      <Tablet width={CENTER_W * U} height={0.44 * U} tile={0.17} thickness={0.06} tilt seed={3}>
        <RuneText
          text={PREMISE}
          px={px(0.0185)}
          maxCols={34}
          anchor={[0.5, 0]}
          position={[0, 0.172 * U, 0]}
          color={MENU_INK.body}
          stagger={1.2}
        />
        <RuneButton
          label="ENTER THE VILLAGE"
          onPress={startGame}
          px={px(0.026)}
          position={[0, -0.148 * U, 0]}
          delay={0.5}
        />
      </Tablet>
    </group>
  );
}

/** Left wing: your name, and the settings. Toggles stack downward from
 * `TOGGLE_Y`, one row per setting — a new setting (REFLECTIONS is next) is
 * one more <SettingToggle row={n}> line. */
const TOGGLE_Y = -0.085;
const TOGGLE_STEP = 0.062;

function NameWing() {
  const shadows = useGame((s) => s.shadows);
  const toggleShadows = useGame((s) => s.toggleShadows);
  const [editing, setEditing] = useState(false);
  return (
    <group position={[-WING_X * U, WING_Y * U, -0.02]} rotation={[0, WING_TURN, 0]}>
      <Tablet width={WING_W * U} height={WING_H * U} tile={0.17} thickness={0.055} tilt seed={7}>
        <RuneText text="YOUR NAME" px={px(0.0165)} position={[0, 0.162 * U, 0]} color={MENU_INK.dim} />
        <NamePlaque px={px(0.022)} width={0.27 * U} position={[0, 0.098 * U, 0]} onEditingChange={setEditing} />
        <RuneText
          text={editing ? "ENTER TO CARVE" : "CLICK TO CARVE ANEW"}
          px={px(0.016)}
          position={[0, 0.035 * U, 0]}
          color={editing ? MENU_INK.accent : MENU_INK.faint}
          glow={0.6}
        />
        <RuneText text="· ◇ ·" px={px(0.016)} position={[0, -0.022 * U, 0]} color={MENU_INK.faint} glow={0.4} />
        <SettingToggle row={0} label="SHADOWS" on={shadows} onToggle={toggleShadows} />
      </Tablet>
    </group>
  );
}

function SettingToggle({ row, label, on, onToggle }: { row: number; label: string; on: boolean; onToggle: () => void }) {
  return (
    <RuneButton
      label={[{ text: `${label}  ` }, { text: on ? "ON " : "OFF", color: on ? MENU_INK.accent : MENU_INK.dim }]}
      onPress={onToggle}
      px={px(0.0175)}
      width={0.26 * U}
      accent={on ? MENU_INK.accent : "#8f86a0"}
      position={[0, (TOGGLE_Y - row * TOGGLE_STEP) * U, 0]}
      delay={0.2 + row * 0.1}
    />
  );
}

function ControlsWing() {
  return (
    <group position={[WING_X * U, WING_Y * U, -0.02]} rotation={[0, -WING_TURN, 0]}>
      <Tablet width={WING_W * U} height={WING_H * U} tile={0.17} thickness={0.055} tilt seed={11}>
        <RuneText text="THE WAYS OF THE HAND" px={px(0.016)} position={[0, 0.155 * U, 0]} color={MENU_INK.dim} />
        <RuneText
          text={controlsLegend(CONTROLS)}
          px={px(0.0165)}
          align="left"
          anchor={[0.5, 0]}
          position={[0, 0.118 * U, 0]}
          glow={0.5}
          stagger={1}
        />
      </Tablet>
    </group>
  );
}
