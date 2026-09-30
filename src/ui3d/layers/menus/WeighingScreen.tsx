import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Group, Vector3 } from "three";
import { resolveItem } from "../../../items/catalog";
import type { GearSlot } from "../../../items/types";
import { RUN } from "../../../run/rules";
import { resonanceOf, useGame } from "../../../state/gameStore";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { ItemModel } from "../../ItemModel";
import { UiPresence, useUiShow } from "../../presence";
import { RuneButton } from "../../RuneButton";
import { Tablet, TABLET_EXIT } from "../../Tablet";
import { RuneText } from "../../text/RuneText";
import { emitUiSparks } from "../../UiSparks";
import { LightThread, SoftGlow } from "./fx";
import { playFloorReveal, playResonance, playThread } from "./menuSounds";
import { formatResonance, MENU_INK } from "./menuText";
import { Pedestal } from "./Pedestal";
import { Appear, Delayed, screenUnit, Stage, Veil } from "./stage";

/** The Weighing, as a ritual at the gate.
 *
 * The four worn pieces rise before you on stone pedestals. One by one
 * their rune rings kindle, the pieces lift off the stone, and a thread of
 * light runs from each to a single point where the gate speaks your
 * RESONANCE; then the destination burns into the air above it, huge:
 * FLOOR N. There is no floor to choose — the reading is the point. The
 * tithe and the two ways out (STEP THROUGH / STAY IN THE VILLAGE) are
 * written on the tablet below, which is ready long before the ritual ends:
 * the ceremony never holds a player hostage.
 *
 * The store plays the gate's hum (playWeighing) as the phase opens; the
 * ritual's beats add their own sounds on top. */

const D = 1.6;
const U = screenUnit(D);
const px = (cap: number) => pxFor(D, cap);

const SLOTS: readonly GearSlot[] = ["staff", "amulet", "cloak", "boots"];
const SLOT_X = [-0.42, -0.14, 0.14, 0.42] as const;

const PED_Y = -0.075;
const PED_SIZE = 0.1;
const LIFT = 0.035;
const ITEM_H = 0.13;
/** Where the threads meet: just under the resonance reading. */
const FOCUS: readonly [number, number, number] = [0, 0.212 * U, 0.02];
const RESONANCE_Y = 0.237;
const FLOOR_Y = 0.337;

/** The ritual's beats, seconds after the gate opens. */
const T = {
  caption: 0.1,
  pedestal: 0.15,
  pedestalStep: 0.12,
  item: 0.5,
  kindle: 0.95,
  kindleStep: 0.15,
  threadRun: 0.5,
  resonance: 2.05,
  floor: 2.45,
  tablet: 1.2,
} as const;

interface Piece {
  slot: GearSlot;
  itemId: string | null;
  level: number;
  color: string;
  /** Order among the present pieces (the kindling sequence), or -1. */
  order: number;
}

export function WeighingScreen() {
  const phase = useGame((s) => s.phase);
  return (
    <UiPresence show={phase === "weighing"} exit={TABLET_EXIT}>
      <Veil color="#020b0a" strength={0.72} center={0.3} />
      <Stage distance={D} width={1.1}>
        <Ritual />
        <Delayed by={T.tablet}>
          <TitheTablet />
        </Delayed>
      </Stage>
    </UiPresence>
  );
}

function Ritual() {
  const equipment = useGame((s) => s.equipment);
  const { gearLevel, entryFloor } = resonanceOf(equipment);
  const pieces = useMemo<Piece[]>(() => {
    let order = 0;
    return SLOTS.map((slot) => {
      const inst = equipment[slot];
      if (!inst) return { slot, itemId: null, level: 0, color: MENU_INK.faint, order: -1 };
      try {
        const item = resolveItem(inst.defId);
        return { slot, itemId: inst.defId, level: item.level, color: item.def.color, order: order++ };
      } catch {
        return { slot, itemId: null, level: 0, color: MENU_INK.faint, order: -1 };
      }
    });
  }, [equipment]);
  const present = pieces.filter((p) => p.order >= 0).length;
  const kindleOf = (p: Piece) => T.kindle + p.order * T.kindleStep;

  return (
    <>
      <RuneText
        text="It does not ask where you wish to go — it casts you where your weight belongs."
        px={px(0.0175)}
        maxCols={46}
        position={[0, 0.445 * U, 0]}
        color={MENU_INK.lavender}
        delay={T.caption}
        stagger={1}
      />
      {pieces.map((p, i) => {
        const x = SLOT_X[i]! * U;
        // The outer pedestals stand a step closer: a shallow arc around you.
        const z = Math.abs(SLOT_X[i]!) > 0.3 ? 0.07 : 0;
        const itemY = PED_SIZE * 0.95 * 0.5 + ITEM_H * 0.5;
        const top = (PED_Y + PED_SIZE * 0.95 * 0.5 + LIFT + ITEM_H * 0.85) * U;
        return (
          <group key={p.slot}>
            <Pedestal
              size={PED_SIZE * U}
              color={p.itemId ? p.color : "#3a3540"}
              delay={T.pedestal + i * T.pedestalStep}
              kindleAt={p.itemId ? kindleOf(p) : null}
              lift={LIFT * U}
              position={[x, PED_Y * U, z]}
            >
              {p.itemId && (
                <Appear delay={T.item + i * 0.1} position={[0, (itemY - PED_SIZE * 0.95 * 0.5) * U, 0]}>
                  <ItemModel itemId={p.itemId} scale={ITEM_H * U * 0.92} spin />
                </Appear>
              )}
            </Pedestal>
            <RuneText
              text={p.slot.toUpperCase()}
              px={px(0.0155)}
              position={[x, -0.148 * U, z]}
              color={MENU_INK.dim}
              delay={T.item + i * 0.1}
            />
            <RuneText
              text={p.itemId ? `LV ${p.level}` : "—"}
              px={px(0.02)}
              position={[x, -0.178 * U, z]}
              color={p.itemId ? MENU_INK.bright : MENU_INK.faint}
              delay={T.item + 0.2 + i * 0.1}
            />
            {p.itemId && (
              <LightThread
                from={[x, top, z]}
                control={[x * 0.62, top + (FOCUS[1] - top) * 0.8, z * 0.5]}
                to={FOCUS}
                color={p.color}
                width={0.012 * U}
                delay={kindleOf(p) + 0.05}
                duration={T.threadRun}
              />
            )}
          </group>
        );
      })}
      <SoftGlow color="#1fbf9f" width={0.32 * U} height={0.1 * U} position={[0, RESONANCE_Y * U, -0.02]} intensity={0.55} delay={T.resonance - 0.2} fadeIn={0.4} />
      <RuneText
        text={[{ text: "RESONANCE " }, { text: formatResonance(gearLevel), color: MENU_INK.accent }]}
        px={px(0.022)}
        position={[0, RESONANCE_Y * U, 0.02]}
        color={MENU_INK.body}
        delay={present > 0 ? T.resonance : T.kindle}
        stagger={0.35}
      />
      <SoftGlow color="#c98a2a" width={0.9 * U} height={0.26 * U} position={[0, FLOOR_Y * U, -0.04]} intensity={0.85} delay={T.floor} fadeIn={0.35} breathe={0.12} />
      <RuneText
        text={`FLOOR ${entryFloor}`}
        px={px(0.08)}
        position={[0, FLOOR_Y * U, 0.03]}
        color="#ffe7b0"
        glow={0}
        flicker={0.07}
        inDuration={0.8}
        stagger={0.45}
        delay={T.floor}
        depth={2}
      />
      <RitualBeats present={present} />
    </>
  );
}

const tmp = new Vector3();
const P: [number, number, number] = [0, 0, 0];

/** The ritual's sounds and bursts, fired as its beats pass (refs only). */
function RitualBeats({ present }: { present: number }) {
  const show = useUiShow();
  const group = useRef<Group>(null);
  const since = useRef(uiNow());
  const fired = useRef(0);
  useEffect(() => {
    since.current = uiNow();
    fired.current = 0;
  }, [show]);
  const beats = useMemo(() => {
    const list: { at: number; run: (at: (x: number, y: number, z: number) => [number, number, number]) => void }[] = [];
    for (let i = 0; i < present; i++) {
      list.push({
        at: T.kindle + i * T.kindleStep + 0.05 + T.threadRun,
        run: (at) => {
          playThread(i);
          emitUiSparks({ position: at(FOCUS[0], FOCUS[1], FOCUS[2]), color: MENU_INK.accent, count: 8, speed: 0.25, size: 0.012 });
        },
      });
    }
    list.push({
      at: present > 0 ? T.resonance : T.kindle,
      run: (at) => {
        playResonance();
        emitUiSparks({ position: at(0, RESONANCE_Y * U, 0.03), color: MENU_INK.accent, count: 18, speed: 0.4, size: 0.014, spread: 0.2 });
      },
    });
    list.push({
      at: T.floor + 0.1,
      run: (at) => {
        playFloorReveal();
        for (let k = 0; k < 7; k++) {
          const x = (k / 6 - 0.5) * 0.55 * U;
          emitUiSparks({ position: at(x, FLOOR_Y * U, 0.05), color: k % 2 ? "#ffcf6a" : "#fff1d0", count: 7, speed: 0.5, up: 0.25, size: 0.02, spread: 0.08, ttl: 1.3 });
        }
      },
    });
    return list.sort((a, b) => a.at - b.at);
  }, [present]);

  // Stage point → world point (into the shared tuple sparks read at once).
  const at = useMemo(
    () =>
      (x: number, y: number, z: number): [number, number, number] => {
        tmp.set(x, y, z);
        if (group.current) tmp.applyMatrix4(group.current.matrixWorld);
        P[0] = tmp.x;
        P[1] = tmp.y;
        P[2] = tmp.z;
        return P;
      },
    [],
  );

  useFrame(() => {
    const g = group.current;
    if (!g || !show) return;
    const t = uiNow() - since.current;
    while (fired.current < beats.length && t >= beats[fired.current]!.at) {
      beats[fired.current]!.run(at);
      fired.current++;
    }
  });
  return <group ref={group} />;
}

function TitheTablet() {
  const deepest = useGame((s) => s.deepest);
  const enterDungeon = useGame((s) => s.enterDungeon);
  const closeWeighing = useGame((s) => s.closeWeighing);
  return (
    <group position={[0, -0.338 * U, 0]}>
      <Tablet width={0.92 * U} height={0.265 * U} tile={0.17} thickness={0.055} tilt seed={5}>
        <RuneText
          text={`The deep lets go only after ${RUN.floorsBeforeExit} floors. Die before you find the way home, and everything you found stays below.`}
          px={px(0.017)}
          maxCols={56}
          anchor={[0.5, 0]}
          position={[0, 0.098 * U, 0]}
          color={MENU_INK.body}
          stagger={0.8}
        />
        {deepest > 0 && (
          <RuneText
            text={[{ text: "Deepest you have walked home from: " }, { text: `floor ${deepest}`, color: MENU_INK.bright }]}
            px={px(0.016)}
            position={[0, 0.028 * U, 0]}
            color={MENU_INK.dim}
            delay={0.4}
          />
        )}
        <RuneButton label="STEP THROUGH" onPress={() => void enterDungeon()} px={px(0.024)} position={[-0.2 * U, -0.058 * U, 0]} delay={0.3} />
        <RuneButton
          label="STAY IN THE VILLAGE"
          onPress={closeWeighing}
          px={px(0.019)}
          accent="#8f86a0"
          color="#c9c0d4"
          position={[0.205 * U, -0.058 * U, 0]}
          delay={0.4}
        />
      </Tablet>
    </group>
  );
}
