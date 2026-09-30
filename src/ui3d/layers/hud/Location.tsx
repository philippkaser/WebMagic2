import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Vector3, type Group } from "three";
import { selectIsHost, useNet } from "../../../net/netStore";
import { useGame } from "../../../state/gameStore";
import { palette } from "../../../ui/theme";
import { placeInFront, pxFor } from "../../anchors";
import { UiPresence } from "../../presence";
import { Tablet, TABLET_EXIT } from "../../Tablet";
import { RuneText } from "../../text/RuneText";
import { arrivalTitle, netStatus, titheShort, titheStones, type ArrivalTitle } from "./copy";
import { HudAnchor, hudUnit } from "./HudAnchor";
import { HUD_LAYOUT } from "./layout";
import { TitheStone } from "./TitheStone";
import { usePresenceList } from "./usePresenceList";

/** Where you are.
 *
 * On arriving — at the village, or on a floor — the place names itself: a
 * big title burns into the air ahead ("FLOOR 12", the biome beneath it, and
 * if the floor arrives under an omen, its name and its whispered line), hangs
 * there a few breaths, and burns away. What it leaves behind is a small
 * stone plaque that builds itself at the top left: the floor and biome, the
 * Tithe of Five as five rune-stones that kindle as floors are played, and
 * whether you're connected. In the village: the village, and the deepest
 * floor you've walked home from. */

const TITLE_D = 3.2;
/** How long the arrival title hangs before it burns away, seconds. */
const TITLE_HOLD = 4.2;
const TITLE_HOLD_OMEN = 8.5;
/** When the omen's lines follow the title (floorAtmosphere's own whisper
 * arrives about then too). */
const OMEN_DELAY = 1.6;

export function Location() {
  const phase = useGame((s) => s.phase);
  const floor = useGame((s) => s.floor);
  const floorSeed = useGame((s) => s.floorSeed);
  const instanceId = useGame((s) => s.instanceId);
  const deepest = useGame((s) => s.deepest);
  const inDungeon = phase === "dungeon";
  const key = inDungeon ? `floor:${floor}:${instanceId}` : "village";
  // Deliberately keyed on the arrival only: a new deepest while standing in
  // the village shouldn't re-announce it.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const title = useMemo(() => arrivalTitle(inDungeon, floor, floorSeed, deepest), [key]);
  const [titleUp, setTitleUp] = useState(true);
  useEffect(() => {
    setTitleUp(true);
    const timer = setTimeout(() => setTitleUp(false), (title.omen ? TITLE_HOLD_OMEN : TITLE_HOLD) * 1000);
    return () => clearTimeout(timer);
  }, [key, title]);
  const { entries, remove } = usePresenceList(titleUp ? title : null, titleUp ? key : null);

  return (
    <>
      {entries.map((e) => (
        <Title key={e.id} title={e.value} shown={e.shown} onHidden={() => remove(e.id)} />
      ))}
      <UiPresence show={!titleUp} exit={TABLET_EXIT}>
        <Plaque inDungeon={inDungeon} floor={floor} deepest={deepest} subtitle={title.subtitle} />
      </UiPresence>
    </>
  );
}

const target = new Vector3();

/** The arrival title: appears where you're looking and stays in the world
 * there, drifting only lazily after your gaze. */
function Title({ title, shown, onHidden }: { title: ArrivalTitle; shown: boolean; onHidden: () => void }) {
  const group = useRef<Group>(null);
  const camera = useThree((s) => s.camera);
  const placed = useRef(false);
  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    // Just below the aim: the upper centre is the message feed's.
    placeInFront(camera, TITLE_D, [0, -0.048 * hudUnit(TITLE_D)], target);
    if (!placed.current) {
      g.position.copy(target);
      g.quaternion.copy(camera.quaternion);
      placed.current = true;
      return;
    }
    if (shown) g.position.lerp(target, 1 - Math.exp(-Math.min(dt, 0.1) * 1.6));
    g.quaternion.slerp(camera.quaternion, 1 - Math.exp(-Math.min(dt, 0.1) * 3));
  });

  const big = pxFor(TITLE_D, 0.06);
  const sub = pxFor(TITLE_D, 0.026);
  const omenPx = pxFor(TITLE_D, 0.024);
  const whisperPx = pxFor(TITLE_D, 0.018);
  const U = hudUnit(TITLE_D);
  return (
    <group ref={group}>
      <RuneText text={title.title} px={big} color={palette.bright} glow={1.6} outline={0.35} position={[0, 0, 0]} inDuration={0.9} stagger={0.55} show={shown} onHidden={onHidden} />
      <RuneText text="— ✦ —" px={sub * 0.7} color={palette.accent} glow={1.2} position={[0, -0.046 * U, 0]} delay={0.5} show={shown} />
      <RuneText text={title.subtitle} px={sub} color={palette.lavender} glow={1} position={[0, -0.072 * U, 0]} delay={0.7} show={shown} />
      {title.omen && (
        <>
          <RuneText text={title.omen.name} px={omenPx} color="#ff8f6a" glow={1.4} position={[0, -0.112 * U, 0]} delay={OMEN_DELAY} show={shown} />
          <RuneText
            text={title.omen.whisper}
            px={whisperPx}
            color={palette.body}
            maxCols={46}
            anchor={[0.5, 0]}
            position={[0, -0.132 * U, 0]}
            delay={OMEN_DELAY + 0.5}
            glow={0.7}
            show={shown}
          />
        </>
      )}
    </group>
  );
}

const L = HUD_LAYOUT.plaque;
const PU = hudUnit(L.distance);
const PAD = 0.022 * PU;
const TW = 0.33 * PU;
const ROW = { title: 0.026, sub: 0.016, stones: 0.028, net: 0.014 } as const;
const GAP = 0.009 * PU;

/** The plaque left behind at the top left: a small stone tablet. */
function Plaque({ inDungeon, floor, deepest, subtitle }: { inDungeon: boolean; floor: number; deepest: number; subtitle: string }) {
  const floorsPlayed = useGame((s) => s.run?.floorsPlayed ?? 0);
  const amHost = useNet(selectIsHost);
  const mode = useNet((s) => s.mode);
  const net = netStatus(mode, amHost, inDungeon);
  const stones = titheStones(floorsPlayed);
  const open = stones.every(Boolean);

  // Rows top to bottom; the plaque is as tall as what it carries.
  const rows: (keyof typeof ROW)[] = inDungeon ? ["title", "sub", "stones", "net"] : ["title", "sub", "net"];
  const TH = rows.reduce((h, r) => h + ROW[r] * PU, 0) + GAP * (rows.length - 1) + PAD * 2;
  let y = TH / 2 - PAD;
  const at: Partial<Record<keyof typeof ROW, number>> = {};
  for (const r of rows) {
    at[r] = y - (ROW[r] * PU) / 2;
    y -= ROW[r] * PU + GAP;
  }
  const x0 = -TW / 2 + PAD;
  // Rows are written in cap heights; RuneText's cap is 7 of its 8 rows.
  const px = (r: keyof typeof ROW) => pxFor(L.distance, ROW[r]);
  const stoneColor = open ? palette.gold : palette.runLoot;

  return (
    <HudAnchor h={L.h} v={L.v} inset={L.inset} distance={L.distance}>
      <group position={[TW / 2, -TH / 2, 0]}>
        <Tablet width={TW} height={TH} tile={Math.min(TW, TH) / 2.2} tint="#4a4553" accent={open ? palette.gold : "#6f63a8"} float={false} quiet seed={3}>
          <RuneText text={inDungeon ? `FLOOR ${floor}` : "THE VILLAGE"} px={px("title")} color={palette.bright} anchor={[0, 0.5]} align="left" position={[x0, at.title!, 0]} glow={0.9} />
          <RuneText
            text={inDungeon ? subtitle : deepest > 0 ? `deepest: floor ${deepest}` : "deepest: —"}
            px={px("sub")}
            color={palette.lavender}
            anchor={[0, 0.5]}
            align="left"
            position={[x0, at.sub!, 0]}
            glow={0.6}
            delay={0.15}
          />
          {inDungeon && (
            <>
              {stones.map((lit, i) => (
                <TitheStone key={i} index={i} lit={lit} color={stoneColor} size={ROW.stones * PU} position={[x0 + ROW.stones * PU * (0.45 + i * 1.02), at.stones!, 0]} />
              ))}
              <RuneText
                text={titheShort(floorsPlayed)}
                px={pxFor(L.distance, 0.014)}
                color={open ? palette.gold : palette.runLoot}
                anchor={[0, 0.5]}
                align="left"
                position={[x0 + ROW.stones * PU * 5.35, at.stones!, 0]}
                glow={open ? 1.2 : 0.6}
                delay={0.3}
              />
            </>
          )}
          <RuneText text={net.text} px={px("net")} color={net.color} anchor={[0, 0.5]} align="left" position={[x0, at.net!, 0]} glow={0.7} delay={0.25} />
        </Tablet>
      </group>
    </HudAnchor>
  );
}
