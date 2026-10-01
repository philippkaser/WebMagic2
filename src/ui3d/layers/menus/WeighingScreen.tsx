import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { Group, Vector3 } from "three";
import type { GearSlot } from "../../../items/types";
import { RUN } from "../../../run/rules";
import { resonanceOf, useGame } from "../../../state/gameStore";
import { biomeForFloor, getBiomeDef } from "../../../world/biomes";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { ItemModel } from "../../ItemModel";
import { Plate } from "../../Plate";
import { UiPresence, useUiShow } from "../../presence";
import { RuneButton } from "../../RuneButton";
import { Tablet, TABLET_EXIT } from "../../Tablet";
import { measureText, RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { emitUiSparks } from "../../UiSparks";
import { ArcaneCircle } from "./ArcaneCircle";
import { LightThread, SoftGlow } from "./fx";
import { colsFor, Flourish, spaced, TitleText } from "./grimoire";
import { cardLayout, ItemCard } from "./ItemCard";
import { itemLook } from "./itemLook";
import { playFloorReveal, playResonance, playThread } from "./menuSounds";
import { formatResonance } from "./menuText";
import { Appear, Delayed, screenUnit, smooth01, Stage, Veil } from "./stage";

/** The Weighing, as a ritual at the gate — in the grimoire's hand.
 *
 * The four worn pieces stand before you as framed item cards, the model of
 * each standing out of its card. One by one their pools kindle, the pieces
 * lift, and a thread of light runs from each to a single point where the
 * gate speaks your RESONANCE; then the destination burns into the air above
 * it in blackletter — "Floor N", the band's name under it on a brass
 * flourish. There is no floor to choose — the reading is the point. The
 * gate's words, the Tithe of Five and the two ways out (✦ Step Through ✦ /
 * Stay in the Village) are written on the grimoire panel below, which is
 * ready long before the ritual ends: the ceremony never holds a player
 * hostage.
 *
 * The store plays the gate's hum (playWeighing) as the phase opens; the
 * ritual's beats add their own sounds on top. */

const D = 1.6;
const U = screenUnit(D);
const px = (cap: number) => pxFor(D, cap);

const SLOTS: readonly GearSlot[] = ["staff", "amulet", "cloak", "boots"];
const SLOT_X = [-0.2475, -0.0825, 0.0825, 0.2475] as const;

const CARD_W = 0.112;
const CARD_Y = 0.035;
const NAME_CAP = 0.0094;
const LIFT = 0.012;
/** Where the threads meet: just under the resonance reading. */
const FOCUS: readonly [number, number, number] = [0, 0.168 * U, 0.02];
const RESONANCE_Y = 0.19;
const FLOOR_Y = 0.355;
const PANEL_Y = -0.292;
const PANEL_W = 0.78;
const PANEL_H = 0.212;

/** The ritual's beats, seconds after the gate opens. */
const T = {
  card: 0.15,
  cardStep: 0.12,
  item: 0.45,
  kindle: 0.95,
  kindleStep: 0.15,
  threadRun: 0.5,
  resonance: 2.05,
  floor: 2.45,
  panel: 1.1,
} as const;

interface Piece {
  slot: GearSlot;
  itemId: string | null;
  name: string;
  level: number;
  color: string;
  /** Order among the present pieces (the kindling sequence), or -1. */
  order: number;
}

export function WeighingScreen() {
  const phase = useGame((s) => s.phase);
  return (
    <UiPresence show={phase === "weighing"} exit={TABLET_EXIT}>
      <Veil color="#030206" inner="#0b1517" strength={0.93} center={0.86} cy={0.2} />
      <Stage distance={D} width={0.95}>
        <ArcaneCircle mood="arcane" distance={3.2} stageDistance={D} cy={0.2} intensity={1.1} />
        <Ritual />
        <Delayed by={T.panel}>
          <GatePanel />
        </Delayed>
      </Stage>
    </UiPresence>
  );
}

function Ritual() {
  const equipment = useGame((s) => s.equipment);
  const { gearLevel, entryFloor } = resonanceOf(equipment);
  const biome = getBiomeDef(biomeForFloor(entryFloor));
  const pieces = useMemo<Piece[]>(() => {
    let order = 0;
    return SLOTS.map((slot) => {
      const inst = equipment[slot];
      const look = inst ? itemLook(inst.defId) : null;
      if (!inst || !look) return { slot, itemId: null, name: `no ${slot}`, level: 0, color: "#4a4152", order: -1 };
      return { slot, itemId: inst.defId, name: look.name, level: look.level, color: look.color, order: order++ };
    });
  }, [equipment]);
  const present = pieces.filter((p) => p.order >= 0).length;
  const kindleOf = (p: Piece) => T.kindle + p.order * T.kindleStep;
  const L = cardLayout(CARD_W * U, px(NAME_CAP));
  const cardTop = CARD_Y * U + L.height / 2;

  return (
    <>
      {pieces.map((p, i) => {
        const x = SLOT_X[i]! * U;
        return (
          <group key={p.slot}>
            <Delayed by={T.card + i * T.cardStep}>
              <WeighedCard piece={p} x={x} kindleAt={p.itemId ? kindleOf(p) - T.card - i * T.cardStep : null} itemDelay={T.item - T.card} />
              <RuneText
                text={spaced(p.slot)}
                font="label"
                px={px(0.0082)}
                position={[x, CARD_Y * U - L.height / 2 - 0.02 * U, 0]}
                color={ink.faded}
                glow={0.2}
                delay={0.3}
              />
            </Delayed>
            {p.itemId && (
              <LightThread
                from={[x, cardTop, 0.02]}
                control={[x * 0.55, cardTop + (FOCUS[1] - cardTop) * 0.9, 0.02]}
                to={FOCUS}
                color={p.color}
                width={0.0042 * U}
                delay={kindleOf(p) + 0.05}
                duration={T.threadRun}
              />
            )}
          </group>
        );
      })}
      <SoftGlow color="#1fbf9f" width={0.3 * U} height={0.07 * U} position={[0, RESONANCE_Y * U, -0.02]} intensity={0.35} delay={T.resonance - 0.2} fadeIn={0.4} />
      <Delayed by={present > 0 ? T.resonance : T.kindle}>
        <RuneText
          text={[
            { text: spaced("Resonance") + "  ", color: ink.faded },
            { text: formatResonance(gearLevel), color: ink.brassLight },
          ]}
          font="label"
          px={px(0.013)}
          position={[0, RESONANCE_Y * U, 0.02]}
          glow={0.4}
          stagger={0.35}
        />
      </Delayed>
      <SoftGlow color="#1fae96" width={0.62 * U} height={0.2 * U} position={[0, FLOOR_Y * U, -0.04]} intensity={0.5} delay={T.floor} fadeIn={0.35} breathe={0.15} />
      <RuneText
        text={spaced("The gate casts you to")}
        font="label"
        px={px(0.0085)}
        color={ink.arcane}
        glow={0.4}
        position={[0, (FLOOR_Y + 0.088) * U, 0]}
        delay={T.floor - 0.25}
      />
      <TitleText text={`Floor ${entryFloor}`} px={px(0.078)} position={[0, FLOOR_Y * U, 0.03]} delay={T.floor} inDuration={0.8} stagger={0.45} />
      <Delayed by={T.floor + 0.35}>
        <TitleText text={biome.name} font="heading" px={px(0.028)} color={ink.brassLight} shadow={null} diagonal position={[0, (FLOOR_Y - 0.084) * U, 0.02]} stagger={0.4} depth={1} />
        <Flourish width={0.34 * U} texel={0.0016 * U} position={[0, (FLOOR_Y - 0.118) * U, 0.02]} delay={0.2} />
      </Delayed>
      <RitualBeats present={present} />
    </>
  );
}

/** One worn piece on its card: the model stands out of the card and lifts
 * when the gate reads it; the card's pool flares as it kindles. */
function WeighedCard({ piece, x, kindleAt, itemDelay }: { piece: Piece; x: number; kindleAt: number | null; itemDelay: number }) {
  const show = useUiShow();
  const since = useRef(uiNow());
  useEffect(() => {
    since.current = uiNow();
  }, [show]);
  const glow = useRef(0.3);
  const held = useRef<Group>(null);
  const phase = useMemo(() => Math.random() * 6, []);
  useFrame(() => {
    const now = uiNow();
    const t = now - since.current;
    const k = show && kindleAt !== null ? smooth01((t - kindleAt) / 0.5) : 0;
    // Stepped flare: the pool kindles in three hard steps, then breathes.
    glow.current = 0.24 + (Math.floor(k * 3) / 3) * (0.22 + Math.sin(now * 3 + phase) * 0.04);
    const h = held.current;
    if (h) h.position.y = k * (LIFT * U + Math.sin(now * 1.6 + phase) * 0.004 * U);
  });
  const L = cardLayout(CARD_W * U, px(NAME_CAP));
  return (
    <ItemCard
      width={CARD_W * U}
      px={px(NAME_CAP)}
      color={piece.color}
      name={piece.name}
      level={piece.itemId ? piece.level : null}
      empty={!piece.itemId}
      icon={piece.itemId ? undefined : piece.slot}
      glowRef={glow}
      position={[x, CARD_Y * U, 0]}
    >
      {piece.itemId && (
        <group ref={held}>
          <Appear delay={itemDelay}>
            <ItemModel itemId={piece.itemId} scale={L.art * 0.78} spin />
          </Appear>
        </group>
      )}
    </ItemCard>
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
          emitUiSparks({ position: at(FOCUS[0], FOCUS[1], FOCUS[2]), color: ink.arcane, count: 8, speed: 0.25, size: 0.01 });
        },
      });
    }
    list.push({
      at: present > 0 ? T.resonance : T.kindle,
      run: (at) => {
        playResonance();
        emitUiSparks({ position: at(0, RESONANCE_Y * U, 0.03), color: ink.arcane, count: 16, speed: 0.35, size: 0.011, spread: 0.15 });
      },
    });
    list.push({
      at: T.floor + 0.1,
      run: (at) => {
        playFloorReveal();
        for (let k = 0; k < 7; k++) {
          const x = (k / 6 - 0.5) * 0.4 * U;
          emitUiSparks({ position: at(x, FLOOR_Y * U, 0.05), color: k % 2 ? ink.brassLight : ink.arcane, count: 6, speed: 0.45, up: 0.25, size: 0.014, spread: 0.06, ttl: 1.2 });
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

/** The grimoire panel: the gate's words, the Tithe of Five, the ways out. */
function GatePanel() {
  const deepest = useGame((s) => s.deepest);
  const enterDungeon = useGame((s) => s.enterDungeon);
  const closeWeighing = useGame((s) => s.closeWeighing);
  const textW = (PANEL_W - 0.07) * U;
  const titleCap = 0.0082;
  const titleW = measureText(spaced("The Weighing Gate"), px(titleCap), undefined, "label").width + px(titleCap) * 22;
  const titleH = measureText("W", px(titleCap), undefined, "label").height + px(titleCap) * 7;
  return (
    <group position={[0, PANEL_Y * U, 0]}>
      <Tablet width={PANEL_W * U} height={PANEL_H * U} tile={0.15} thickness={0.05} frame="brass" tilt seed={5} projector>
        {/* The panel's title plate, straddling the top trim (.wm-panel__title). */}
        <Plate width={titleW} height={titleH} frame="brass" texel={px(titleCap) * 0.9} fill={ink.ink} fillOpacity={1} position={[0, (PANEL_H / 2) * U, 0.006]}>
          <RuneText text={spaced("The Weighing Gate")} font="label" px={px(titleCap)} color={ink.brassLight} glow={0.3} depth={-0.3} />
        </Plate>
        <RuneText
          text="It does not ask where you wish to go — it casts you where your weight belongs."
          px={px(0.0118)}
          maxCols={colsFor(textW, px(0.0118))}
          color={ink.parchment}
          glow={0.3}
          position={[0, 0.06 * U, 0]}
          stagger={0.8}
        />
        <RuneText
          text={`The deep lets go only after ${RUN.floorsBeforeExit} floors. Die before you find the way home, and everything you found stays below.`}
          px={px(0.0106)}
          maxCols={colsFor(textW, px(0.0106))}
          color={ink.parchmentDim}
          glow={0.2}
          position={[0, 0.019 * U, 0]}
          delay={0.3}
          stagger={0.8}
        />
        {deepest > 0 && (
          <RuneText
            text={[
              { text: spaced("Deepest walked home") + "   ", color: ink.faded },
              { text: `FLOOR ${deepest}`, color: ink.brassLight },
            ]}
            font="label"
            px={px(0.0082)}
            position={[0, -0.02 * U, 0]}
            delay={0.5}
          />
        )}
        <RuneButton label="Step Through" onPress={() => void enterDungeon()} px={px(0.0135)} position={[-0.13 * U, -0.062 * U, 0]} delay={0.3} />
        <RuneButton
          label="Stay in the Village"
          variant="ghost"
          onPress={closeWeighing}
          px={px(0.0115)}
          color={ink.parchmentDim}
          position={[0.15 * U, -0.062 * U, 0]}
          delay={0.4}
        />
      </Tablet>
    </group>
  );
}
