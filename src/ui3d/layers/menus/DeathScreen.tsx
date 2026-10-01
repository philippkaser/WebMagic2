import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { CylinderGeometry, Group, OctahedronGeometry, Vector3 } from "three";
import { gameEvents } from "../../../core/events";
import { robeColorOf } from "../../../game/wizardLook";
import { useNet } from "../../../net/netStore";
import { GraveModel } from "../../../render/models/GraveModel";
import { useGame } from "../../../state/gameStore";
import { biomeForFloor, getBiomeDef } from "../../../world/biomes";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { getFace } from "../../font/faces";
import { ItemModel } from "../../ItemModel";
import { metalMaterial, stoneMaterial } from "../../materials";
import { UiPresence, useUiShow } from "../../presence";
import { RuneButton } from "../../RuneButton";
import { TABLET_EXIT } from "../../Tablet";
import { fontPixel, measureText, RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { emitUiSparks, type UiSparkOptions } from "../../UiSparks";
import { ArcaneCircle } from "./ArcaneCircle";
import { AshFlakes, emitAsh, type AshOptions } from "./AshFlakes";
import { SoftGlow } from "./fx";
import { PixelIcon, spaced, TitleText } from "./grimoire";
import { cardLayout, ItemCard } from "./ItemCard";
import { itemLook, RARITY_COLOR } from "./itemLook";
import { resolveLost, type LostThing } from "./lostItems";
import { playCrumble, playDeathToll, playGraveTake } from "./menuSounds";
import { deathHeadline, lossVerdict, MENU_INK } from "./menuText";
import { backOut, Delayed, screenUnit, smooth01, Stage, Veil } from "./stage";

/** Death, as the grimoire's death rites (artpass DeathScreen), told with the
 * things themselves.
 *
 * The blood circle draws itself in the dark and "You Died" burns into the
 * air in blackletter blood with its cast shadow, embers smouldering off the
 * letters. Under it, between two skulls, who took you and where; the
 * numbers of the run; and the verdict. Then what you lost stands before you
 * as a row of framed item cards, the things themselves standing out of
 * them… and is taken:
 *
 *   - alone, the dungeon swallows it — each piece shudders and crumbles to
 *     ash that falls away, and its card cools to an iron memorial;
 *   - on a shared floor, your grave rises out of the dark below the cards
 *     (the same grave the others will find, in your robe's colour) and each
 *     piece is drawn down into it, to wait for whoever reaches it first.
 *
 * "✦ Return to the Village ✦" waits under it all. */

const D = 1.6;
const U = screenUnit(D);
const px = (cap: number) => pxFor(D, cap);

const T = {
  toll: 0.15,
  title: 0.2,
  headline: 1.2,
  stats: 1.45,
  verdict: 1.7,
  cards: 1.9,
  cardStep: 0.09,
  grave: 2.1,
  button: 2.3,
  fate: 3.2,
  fateStep: 0.28,
} as const;

const TITLE_Y = 0.262;
const TITLE_CAP = 0.108;
const CARDS_Y = -0.118;
const NAME_CAP = 0.0094;
/** The grave marker's width on screen (H units) and where it stands. */
const GRAVE_W = 0.13;
const GRAVE_BASE_Y = -0.33;

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
      <Veil color="#030102" inner="#1e0808" strength={0.95} center={0.85} cy={0.2} />
      <Stage distance={D} width={1.0}>
        <ArcaneCircle mood="blood" distance={3.2} stageDistance={D} cy={0.2} intensity={2} />
        <Death />
      </Stage>
    </UiPresence>
  );
}

type Thing = LostThing & { gold?: boolean };

function Death() {
  const lastDeath = useGame((s) => s.lastDeath);
  const respawn = useGame((s) => s.respawn);
  const things = useMemo(() => {
    const list: Thing[] = resolveLost(lastDeath?.lostItems ?? [], lastFell);
    if (lastDeath && lastDeath.lostGold > 0) list.push({ id: null, qty: lastDeath.lostGold, name: `${lastDeath.lostGold} gold`, gold: true });
    return list;
  }, [lastDeath]);
  const grave = !!lastDeath?.grave && things.length > 0;
  const robe = useMemo(() => robeColorOf(useNet.getState().playerId || "self"), []);
  const biome = lastDeath ? getBiomeDef(biomeForFloor(lastDeath.floor)).name : null;
  const verdict = lossVerdict(lastDeath);
  // Cards shrink to fit a long loss on one row.
  const n = things.length;
  const cardW = Math.min(0.105, 0.86 / Math.max(1, n) - 0.035) * U;
  const stepX = cardW + 0.036 * U;
  const headline = deathHeadline(lastDeath, biome);
  const headPx = px(0.0118);
  const headW = measureText(headline, headPx).width;
  const skullPx = 0.0024 * U;
  const buttonY = grave ? -0.44 : n > 0 ? -0.29 : -0.08;

  return (
    <>
      <SoftGlow color="#8a0014" width={1.0 * U} height={0.28 * U} position={[0, TITLE_Y * U, -0.06]} intensity={0.8} delay={T.title + 0.3} fadeIn={1.4} breathe={0.2} />
      <TitleText
        text="You Died"
        px={px(TITLE_CAP)}
        color={ink.blood}
        shadow="#4a0c0c"
        position={[0, TITLE_Y * U, 0]}
        delay={T.title}
        inDuration={1.4}
        stagger={1}
        depth={3}
        flicker={0.1}
      />
      <Smolder delay={T.title + 1.2} />
      <Toll />
      <Delayed by={T.headline}>
        <PixelIcon name="skull" tint="#ffffff" pixel={skullPx} position={[-headW / 2 - 0.028 * U, 0.15 * U, 0]} />
        <RuneText text={headline} px={headPx} color={ink.parchmentDim} glow={0.3} position={[0, 0.15 * U, 0]} stagger={0.6} />
        <PixelIcon name="skull" tint="#ffffff" pixel={skullPx} position={[headW / 2 + 0.028 * U, 0.15 * U, 0]} delay={0.2} />
      </Delayed>
      {lastDeath && (
        <Delayed by={T.stats}>
          <Stats
            stats={[
              [lastDeath.floor, "Last floor"],
              [lastDeath.lostItems.length, "Things lost"],
              [lastDeath.lostGold, "Gold lost"],
            ]}
          />
        </Delayed>
      )}
      <Delayed by={T.verdict}>
        {verdict.label && (
          <RuneText text={spaced(verdict.label)} font="label" px={px(0.0085)} color={MENU_INK.wound} glow={0.4} position={[0, 0.012 * U, 0]} />
        )}
        <RuneText text={verdict.lore} px={px(0.0112)} color={ink.parchmentDim} glow={0.2} position={[0, (verdict.label ? -0.018 : 0.0) * U, 0]} delay={0.2} stagger={0.7} />
      </Delayed>
      {things.map((t, i) => (
        <Delayed key={`${t.name}:${i}`} by={T.cards + i * T.cardStep}>
          <LostCard
            thing={t}
            index={i}
            fate={grave ? "grave" : "ash"}
            width={cardW}
            position={[(i - (n - 1) / 2) * stepX, CARDS_Y * U, 0.02]}
            fateAt={T.fate + i * T.fateStep - (T.cards + i * T.cardStep)}
          />
        </Delayed>
      ))}
      {grave && <Grave robe={robe} />}
      <Delayed by={T.button}>
        <RuneButton label="Return to the Village" variant="danger" onPress={respawn} px={px(0.0135)} position={[0, buttonY * U, 0.02]} delay={0.15} />
      </Delayed>
      <AshFlakes />
    </>
  );
}

/** The run in big numerals over tiny captions (artpass RunStats). */
function Stats({ stats }: { stats: [number, string][] }) {
  const step = 0.19 * U;
  return (
    <>
      {stats.map(([n, label], i) => {
        const x = (i - (stats.length - 1) / 2) * step;
        return (
          <group key={label} position={[x, 0.083 * U, 0]}>
            <RuneText text={String(n)} px={px(0.02)} color={MENU_INK.wound} glow={0.4} position={[0, 0.008 * U, 0]} delay={i * 0.08} />
            <RuneText text={spaced(label)} font="label" px={px(0.0072)} color={ink.faded} glow={0.1} position={[0, -0.022 * U, 0]} delay={0.1 + i * 0.08} />
          </group>
        );
      })}
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

/** Embers rising off "You Died" for as long as it stands. */
function Smolder({ delay }: { delay: number }) {
  const show = useUiShow();
  const group = useRef<Group>(null);
  const since = useRef(uiNow());
  const acc = useRef(0);
  useEffect(() => {
    since.current = uiNow();
  }, [show]);
  const size = useMemo(() => measureText("You Died", px(TITLE_CAP), undefined, "title"), []);
  const fp = fontPixel(getFace("title"), px(TITLE_CAP));
  useFrame((_, dt) => {
    const g = group.current;
    if (!g || !show || uiNow() - since.current < delay) return;
    acc.current += Math.min(dt, 0.1) * 40;
    while (acc.current >= 1) {
      acc.current -= 1;
      tmp.set((Math.random() - 0.5) * size.width, (Math.random() - 0.4) * size.height * 0.8, 0.02).applyMatrix4(g.matrixWorld);
      P[0] = tmp.x;
      P[1] = tmp.y;
      P[2] = tmp.z;
      ember.color = Math.random() < 0.6 ? "#ff3a1a" : "#ff9a3a";
      ember.count = 1;
      ember.speed = 0.04;
      ember.up = 0.16 + Math.random() * 0.1;
      ember.size = fp * 1.2;
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

/** One lost thing on its card: it stands a moment, then meets its fate,
 * and the card cools into a memorial of what was there. */
function LostCard({
  thing,
  index,
  fate,
  width,
  position,
  fateAt,
}: {
  thing: Thing;
  index: number;
  fate: "ash" | "grave";
  width: number;
  position: readonly [number, number, number];
  /** Seconds after the card shows that its thing is taken. */
  fateAt: number;
}) {
  const show = useUiShow();
  const body = useRef<Group>(null);
  const since = useRef(uiNow());
  const stage = useRef(0);
  useEffect(() => {
    since.current = uiNow();
    stage.current = 0;
  }, [show]);
  const look = thing.id ? itemLook(thing.id) : null;
  const color = thing.gold ? RARITY_COLOR.legendary : (look?.color ?? "#7d7288");
  const L = cardLayout(width, px(NAME_CAP));
  // The card cools once the thing is gone (one timer, not per-frame state).
  const [taken, setTaken] = useState(false);
  useEffect(() => {
    if (!show) return;
    const timer = setTimeout(() => setTaken(true), (fateAt + (fate === "ash" ? 0.7 : 0.75)) * 1000);
    return () => clearTimeout(timer);
  }, [show, fateAt, fate]);
  // The grave's mouth, relative to the art in this card.
  const mouth = useMemo<[number, number, number]>(
    () => [-position[0], (GRAVE_BASE_Y * U + GRAVE_W * U * 0.42) - (position[1] + L.artY), -position[2] - 0.033],
    [position, L.artY],
  );

  useFrame(() => {
    const b = body.current;
    if (!b || !show) return;
    const now = uiNow();
    const t = now - since.current - fateAt;
    if (t < 0) {
      b.position.set(0, 0, 0);
      b.scale.setScalar(1);
      b.visible = true;
      return;
    }
    if (stage.current === 0) {
      stage.current = 1;
      if (fate === "ash") playCrumble(index);
    }
    if (fate === "ash") {
      // Shudder, then crumble: shrink and sink, shedding ash and embers.
      const shake = t < 0.35 ? (Math.random() - 0.5) * 0.005 * U * (t / 0.35) : 0;
      const k = smooth01((t - 0.3) / 0.6);
      b.position.set(shake, -k * 0.02 * U, 0);
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
          emitAsh({ position: P, count: 30, size: 0.016, spread: L.art * 0.3, speed: 0.14, ttl: 2 });
          emitUiSparks({ position: P, color: "#ff6a2a", count: 12, speed: 0.2, up: 0.16, size: 0.011, spread: L.art * 0.25, ttl: 1 });
        }
        ash.size = 0.013;
        ash.spread = L.art * 0.25 * (1 - k * 0.5);
        ash.speed = 0.07;
        emitAsh(ash);
        if (Math.random() < 0.5) {
          ember.color = "#ff7a3a";
          ember.speed = 0.1;
          ember.up = 0.1;
          ember.size = 0.009;
          ember.spread = 0.025;
          ember.ttl = 0.7;
          emitUiSparks(ember);
        }
      }
    } else {
      // Drawn down into the grave along a falling arc.
      const k = smooth01(t / 0.75);
      const arc = Math.sin(k * Math.PI) * 0.04 * U;
      b.position.set(mouth[0] * k, mouth[1] * k + arc, mouth[2] * k);
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
        emitUiSparks({ position: P, color: ink.violet, count: 12, speed: 0.2, up: 0.2, size: 0.01, spread: 0.03 });
      }
    }
  });

  const scale = L.art * 0.78;
  return (
    <ItemCard
      width={width}
      px={px(NAME_CAP)}
      color={color}
      name={thing.name}
      level={look ? look.level : null}
      qty={thing.gold ? 1 : thing.qty}
      taken={taken}
      position={position}
    >
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
    </ItemCard>
  );
}

/** Your grave, rising out of the dark below the cards to take what you
 * carried. */
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
    g.position.y = GRAVE_BASE_Y * U - (1 - Math.min(1, r)) * 0.2 * U;
    g.scale.setScalar(Math.max(0.0001, s * Math.min(1, r * 1.3)));
    g.visible = r > 0.001;
  });
  return (
    <group ref={group} visible={false} rotation={[0.16, -0.4, 0]}>
      <GraveModel color={robe} motes={false} light={false} castShadow={false} />
    </group>
  );
}
