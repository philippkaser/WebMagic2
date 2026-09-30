import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { CylinderGeometry, Group, OctahedronGeometry, Vector3 } from "three";
import { gameEvents } from "../../../core/events";
import { robeColorOf } from "../../../game/wizardLook";
import { useNet } from "../../../net/netStore";
import { GraveModel } from "../../../render/models/GraveModel";
import { useGame } from "../../../state/gameStore";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { ItemModel } from "../../ItemModel";
import { metalMaterial, stoneMaterial } from "../../materials";
import { UiPresence, UiShow, useUiShow } from "../../presence";
import { RuneButton } from "../../RuneButton";
import { Tablet, TABLET_EXIT } from "../../Tablet";
import { RuneText } from "../../text/RuneText";
import { emitUiSparks, type UiSparkOptions } from "../../UiSparks";
import { AshFlakes, emitAsh, type AshOptions } from "./AshFlakes";
import { SoftGlow } from "./fx";
import { resolveLost, type LostThing } from "./lostItems";
import { playCrumble, playDeathToll, playGraveTake } from "./menuSounds";
import { deathHeadline, lossSentence, MENU_INK } from "./menuText";
import { Appear, backOut, Delayed, screenUnit, smooth01, Stage, Veil } from "./stage";

/** Death, told with the things themselves.
 *
 * YOU DIED burns into the air in blood — white-hot runes cooling to red,
 * smouldering embers rising off the letters — over a darkness that gathers
 * red at the edges. Beneath it, where you fell and to whom. Then what you
 * lost appears before you, one piece at a time… and is taken:
 *
 *   - alone, the dungeon swallows it — each piece shudders and crumbles to
 *     ash that falls away out of sight;
 *   - on a shared floor, your grave rises out of the dark (the same grave the
 *     others will find below, in your robe's colour) and each piece sinks
 *     into it, to wait for whoever reaches it first.
 *
 * The verdict is spelled out under it in words, so nothing is left vague,
 * and a small tablet offers the way back to the village. */

const D = 1.6;
const U = screenUnit(D);
const px = (cap: number) => pxFor(D, cap);

const T = {
  toll: 0.15,
  title: 0.2,
  headline: 1.3,
  items: 1.6,
  itemStep: 0.1,
  grave: 1.9,
  sentence: 2.1,
  tablet: 2.3,
  fate: 3.0,
  fateStep: 0.28,
} as const;

const TITLE_Y = 0.272;
const TITLE_CAP = 0.13;
const ITEM_H = 0.118;
/** The grave marker's width on screen (H units) and where it stands. */
const GRAVE_W = 0.165;
const GRAVE_BASE_Y = -0.098;

/** The ids behind the most recent death — the store's record keeps only
 * names; the fall event carries ids (lostItems.ts explains the fallback). */
let lastFell: { id: string; qty: number }[] | null = null;
gameEvents.on("wizardFell", (e) => {
  lastFell = e.items.map((s) => ({ id: s.id, qty: s.qty }));
});

export function DeathScreen() {
  const phase = useGame((s) => s.phase);
  return (
    <UiPresence show={phase === "dead"} exit={TABLET_EXIT}>
      <Veil color="#1c0206" strength={0.9} center={0.62} />
      <Stage distance={D} width={1.1}>
        <Death />
      </Stage>
    </UiPresence>
  );
}

function Death() {
  const lastDeath = useGame((s) => s.lastDeath);
  const respawn = useGame((s) => s.respawn);
  const things = useMemo(() => {
    const list: (LostThing & { gold?: boolean })[] = resolveLost(lastDeath?.lostItems ?? [], lastFell);
    if (lastDeath && lastDeath.lostGold > 0) list.push({ id: null, qty: lastDeath.lostGold, name: `${lastDeath.lostGold} gold`, gold: true });
    return list;
  }, [lastDeath]);
  const grave = !!lastDeath?.grave && things.length > 0;
  const robe = useMemo(() => robeColorOf(useNet.getState().playerId || "self"), []);
  const rowY = grave ? 0.068 : 0.01;
  const step = Math.min(0.145, 1.0 / Math.max(1, things.length));

  return (
    <>
      <SoftGlow color="#8a0014" width={1.35 * U} height={0.36 * U} position={[0, TITLE_Y * U, -0.06]} intensity={1.1} delay={T.title + 0.3} fadeIn={1.4} breathe={0.2} />
      <RuneText
        text="YOU DIED"
        px={px(TITLE_CAP)}
        position={[0, TITLE_Y * U, 0]}
        color="#d0142a"
        glow={0}
        flicker={0.12}
        inDuration={1.5}
        stagger={1.1}
        delay={T.title}
        depth={3}
      />
      <Smolder delay={T.title + 1.2} />
      <Toll />
      <RuneText
        text={deathHeadline(lastDeath)}
        px={px(0.022)}
        position={[0, 0.142 * U, 0]}
        color="#d8b4ac"
        delay={T.headline}
        stagger={0.6}
      />
      {things.map((t, i) => (
        <LostPiece
          key={`${t.name}:${i}`}
          thing={t}
          index={i}
          fate={grave ? "grave" : "ash"}
          position={[(i - (things.length - 1) / 2) * step * U, rowY * U, 0.04]}
        />
      ))}
      {grave && <Grave robe={robe} />}
      <RuneText
        text={lossSentence(lastDeath)}
        px={px(0.0175)}
        maxCols={62}
        anchor={[0.5, 0]}
        position={[0, (grave ? -0.128 : things.length > 0 ? -0.105 : 0.04) * U, 0]}
        color="#c9b8b0"
        delay={T.sentence}
        stagger={1}
      />
      <Delayed by={T.tablet}>
        <group position={[0, -0.355 * U, 0]}>
          <Tablet width={0.5 * U} height={0.13 * U} tile={0.15} thickness={0.05} tint="#4a4050" accent="#ff5a4a" tilt seed={13}>
            <RuneButton label="RETURN TO THE VILLAGE" onPress={respawn} px={px(0.022)} accent="#ff6a5a" position={[0, 0, 0]} delay={0.2} />
          </Tablet>
        </group>
      </Delayed>
      <AshFlakes />
    </>
  );
}

/** The toll of the death, once, as the words start to burn. */
function Toll() {
  const show = useUiShow();
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(playDeathToll, T.toll * 1000);
    return () => clearTimeout(t);
  }, [show]);
  return null;
}

const P: [number, number, number] = [0, 0, 0];
const tmp = new Vector3();
/** Reused by the every-frame emitters (smoulder, crumbling pieces). */
const ember: UiSparkOptions = { position: P, color: "#ff3a1a", count: 1 };
const ash: AshOptions = { position: P, count: 2 };

/** Embers rising off YOU DIED for as long as it stands. */
function Smolder({ delay }: { delay: number }) {
  const show = useUiShow();
  const group = useRef<Group>(null);
  const since = useRef(uiNow());
  const acc = useRef(0);
  useEffect(() => {
    since.current = uiNow();
  }, [show]);
  const w = ((8 * 6 - 1) / 7) * TITLE_CAP * U;
  const h = TITLE_CAP * U;
  useFrame((_, dt) => {
    const g = group.current;
    if (!g || !show || uiNow() - since.current < delay) return;
    acc.current += Math.min(dt, 0.1) * 55;
    while (acc.current >= 1) {
      acc.current -= 1;
      tmp.set((Math.random() - 0.5) * w, (Math.random() - 0.3) * h, 0.02).applyMatrix4(g.matrixWorld);
      P[0] = tmp.x;
      P[1] = tmp.y;
      P[2] = tmp.z;
      ember.color = Math.random() < 0.6 ? "#ff3a1a" : "#ff9a3a";
      ember.count = 1;
      ember.speed = 0.04;
      ember.up = 0.16 + Math.random() * 0.1;
      ember.size = 0.012;
      ember.spread = 0.01;
      ember.ttl = 1.4;
      emitUiSparks(ember);
    }
  });
  return <group ref={group} position={[0, TITLE_Y * U, 0]} />;
}

const coin = new CylinderGeometry(0.34, 0.34, 0.09, 14);
/** Stands in for a lost thing known only by a name the catalog can't place. */
const shard = new OctahedronGeometry(1, 0);

/** A lost gold purse as a little stack of coins. */
function CoinStack() {
  return (
    <group position={[0, -0.28, 0]}>
      {[0, 1, 2, 3, 4, 5].map((k) => (
        <mesh
          key={k}
          geometry={coin}
          material={metalMaterial("#d8a93c")}
          position={[Math.sin(k * 2.1) * 0.04, k * 0.1, Math.cos(k * 1.7) * 0.04]}
          rotation={[Math.sin(k) * 0.08, 0, Math.cos(k * 1.3) * 0.08]}
        />
      ))}
    </group>
  );
}

/** One lost piece: appears, hangs a moment, then meets its fate. */
function LostPiece({
  thing,
  index,
  fate,
  position,
}: {
  thing: LostThing & { gold?: boolean };
  index: number;
  fate: "ash" | "grave";
  position: readonly [number, number, number];
}) {
  const show = useUiShow();
  const body = useRef<Group>(null);
  const since = useRef(uiNow());
  const stage = useRef(0);
  useEffect(() => {
    since.current = uiNow();
    stage.current = 0;
  }, [show]);
  const start = T.fate + index * T.fateStep;
  // Its light and its count go out as the piece is taken (one timer, not
  // per-frame state).
  const [taken, setTaken] = useState(false);
  useEffect(() => {
    if (!show) return;
    const timer = setTimeout(() => setTaken(true), (start + 0.3) * 1000);
    return () => clearTimeout(timer);
  }, [show, start]);
  // The grave's mouth, relative to this piece.
  const mouth = useMemo<[number, number, number]>(
    () => [-position[0], (GRAVE_BASE_Y + (GRAVE_W * 0.6) / 1.44) * U - position[1], -position[2]],
    [position],
  );

  useFrame(() => {
    const b = body.current;
    if (!b || !show) return;
    const now = uiNow();
    const t = now - since.current - start;
    const bob = Math.sin(now * 1.7 + index) * 0.004 * U;
    if (t < 0) {
      b.position.set(0, bob, 0);
      b.scale.setScalar(1);
      return;
    }
    if (stage.current === 0) {
      stage.current = 1;
      if (fate === "ash") playCrumble(index);
    }
    if (fate === "ash") {
      // Shudder, then crumble: shrink and sink, shedding ash and embers.
      const shake = t < 0.35 ? (Math.random() - 0.5) * 0.006 * U * (t / 0.35) : 0;
      const k = smooth01((t - 0.3) / 0.6);
      b.position.set(shake, bob - k * 0.03 * U, 0);
      b.scale.setScalar(Math.max(0.0001, 1 - k));
      b.visible = k < 1;
      if (t > 0.25 && k < 1) {
        tmp.set(0, 0, 0);
        b.localToWorld(tmp);
        P[0] = tmp.x;
        P[1] = tmp.y;
        P[2] = tmp.z;
        if (stage.current === 1) {
          // The moment it gives: a slump of ash and a breath of embers.
          stage.current = 2;
          emitAsh({ position: P, count: 36, size: 0.02, spread: ITEM_H * U * 0.35, speed: 0.16, ttl: 2 });
          emitUiSparks({ position: P, color: "#ff6a2a", count: 14, speed: 0.22, up: 0.18, size: 0.014, spread: ITEM_H * U * 0.3, ttl: 1 });
        }
        ash.size = 0.016;
        ash.spread = ITEM_H * U * 0.3 * (1 - k * 0.5);
        ash.speed = 0.08;
        emitAsh(ash);
        if (Math.random() < 0.5) {
          ember.color = "#ff7a3a";
          ember.speed = 0.1;
          ember.up = 0.1;
          ember.size = 0.01;
          ember.spread = 0.03;
          ember.ttl = 0.7;
          emitUiSparks(ember);
        }
      }
    } else {
      // Drawn down into the grave along a falling arc.
      const k = smooth01(t / 0.75);
      const arc = Math.sin(k * Math.PI) * 0.05 * U;
      b.position.set(mouth[0] * k, bob * (1 - k) + mouth[1] * k + arc, mouth[2] * k);
      b.scale.setScalar(Math.max(0.0001, 1 - k * 0.85));
      b.visible = k < 1;
      if (k >= 1 && stage.current === 1) {
        stage.current = 2;
        playGraveTake(index);
        tmp.set(0, 0, 0);
        b.localToWorld(tmp);
        P[0] = tmp.x;
        P[1] = tmp.y;
        P[2] = tmp.z;
        emitUiSparks({ position: P, color: "#c9a5ff", count: 12, speed: 0.2, up: 0.2, size: 0.012, spread: 0.03 });
      }
    }
  });

  const scale = ITEM_H * U * 0.9;
  return (
    <group position={position as [number, number, number]}>
      {/* Held in the heat of the death: a backlight that makes the piece
          read against whatever the world shows behind. */}
      <UiShow show={!taken}>
        <SoftGlow
          color={fate === "grave" ? "#6a3fa0" : "#a3300c"}
          width={ITEM_H * 1.25 * U}
          height={ITEM_H * 1.25 * U}
          position={[0, 0, -0.04]}
          intensity={0.9}
          delay={T.items + index * T.itemStep}
          fadeIn={0.5}
        />
      </UiShow>
      <Appear delay={T.items + index * T.itemStep}>
        <group ref={body}>
          {thing.gold ? (
            <group scale={scale}>
              <CoinStack />
            </group>
          ) : thing.id ? (
            <ItemModel itemId={thing.id} scale={scale} spin />
          ) : (
            <mesh geometry={shard} material={stoneMaterial("#6a6070")} scale={scale * 0.18} rotation={[0.6, 0.4, 0.2]} />
          )}
        </group>
      </Appear>
      {thing.qty > 1 && (
        <RuneText
          text={thing.gold ? `${thing.qty}` : `×${thing.qty}`}
          px={px(0.016)}
          position={[0, -ITEM_H * 0.62 * U, 0]}
          color={thing.gold ? MENU_INK.gold : MENU_INK.dim}
          delay={T.items + index * T.itemStep + 0.3}
          show={!taken}
        />
      )}
    </group>
  );
}

/** Your grave, rising out of the dark to take what you carried. */
function Grave({ robe }: { robe: string }) {
  const show = useUiShow();
  const group = useRef<Group>(null);
  const since = useRef(uiNow());
  const from = useRef(0);
  const k = useRef(0);
  useEffect(() => {
    since.current = uiNow();
    from.current = k.current;
  }, [show]);
  const s = (GRAVE_W * U) / 1.44;
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    const t = uiNow() - since.current;
    k.current = show ? backOut((t - T.grave) / 0.8, 1.1) : from.current * (1 - smooth01(t / 0.5));
    const r = Math.max(0, k.current);
    g.position.y = GRAVE_BASE_Y * U - (1 - Math.min(1, r)) * 0.25 * U;
    g.scale.setScalar(Math.max(0.0001, s * Math.min(1, r * 1.3)));
    g.visible = r > 0.001;
  });
  return (
    <group ref={group} visible={false} rotation={[0.16, -0.4, 0]}>
      <GraveModel color={robe} motes={false} light={false} castShadow={false} />
    </group>
  );
}
