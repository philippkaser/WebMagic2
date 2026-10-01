import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { playerPosition } from "../../../game/player-state";
import { selectIsHost, useNet } from "../../../net/netStore";
import { canLeave, entryFloorForGear, gearLevel } from "../../../run/rules";
import { useGame } from "../../../state/gameStore";
import { useTravel } from "../../../transition/store";
import { Plate } from "../../Plate";
import { UiPresence } from "../../presence";
import { measureText, RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { apx, fontPx, FRAME_TEXEL, plateSize } from "./ap";
import { ArrivalBanner } from "./ArrivalBanner";
import { arrivalTitle, netStatus, titheLine, titheRunes } from "./copy";
import { Divider } from "./Divider";
import { HudAnchor } from "./HudAnchor";
import { HUD_LAYOUT } from "./layout";
import { PixelSprite } from "./PixelSprite";
import { RUNE_BOX, TitheRune } from "./TitheRune";
import { usePresenceList } from "./usePresenceList";

/** Where you are.
 *
 * On arriving — at the village, or on a floor — the place names itself: the
 * arrival banner burns into the air ahead (ArrivalBanner), hangs a few
 * breaths, and burns away — sooner if you set off walking: once it has
 * been read (the title written, an omen named), a few steps dismiss it. It waits for the journey to arrive, so it lands
 * once the new place has been revealed. What it leaves behind is the
 * location panel at the top left (artpass hud/LocationPanel): a brass-framed
 * soot panel with FLOOR, the floor number and biome, the Tithe of Five as
 * five rune squares that kindle as floors are played, how many more the
 * deep wants before it lets you go, and your gear and connection. In the
 * village: SANCTUARY, The Village, and the floor the rift will cast you to. */

const TITLE_HOLD = 4.2;
const TITLE_HOLD_OMEN = 8.5;
/** Shortest the banner stays, seconds (the title has burned in; under an
 * omen, its name has been written too). */
const TITLE_MIN = 1.3;
const TITLE_MIN_OMEN = 2.6;
/** Metres walked (horizontally) that dismiss the banner early. */
const WALK_AWAY = 1.2;

export function Location() {
  const phase = useGame((s) => s.phase);
  const floor = useGame((s) => s.floor);
  const floorSeed = useGame((s) => s.floorSeed);
  const instanceId = useGame((s) => s.instanceId);
  const traveling = useTravel((s) => s.stage === "entering" || s.stage === "tunnel");
  // The banner waits until the journey has fully arrived: the arrival moves
  // the camera, and the banner stays where it was first written.
  const arrived = useTravel((s) => s.stage === "idle");
  const inDungeon = phase === "dungeon";
  const key = inDungeon ? `floor:${floor}:${instanceId}` : "village";
  // Keyed on the arrival only.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const title = useMemo(() => arrivalTitle(inDungeon, floor, floorSeed), [key]);
  // The arrival whose banner has already been read (the panel stands then).
  const [doneKey, setDoneKey] = useState<string | null>(null);
  const titleUp = arrived && doneKey !== key;
  useEffect(() => {
    if (!titleUp) return;
    const timer = setTimeout(() => setDoneKey(key), (title.omen ? TITLE_HOLD_OMEN : TITLE_HOLD) * 1000);
    return () => clearTimeout(timer);
  }, [titleUp, key, title]);
  useWalkAway(titleUp, title.omen ? TITLE_MIN_OMEN : TITLE_MIN, () => setDoneKey(key));
  const { entries, remove } = usePresenceList(titleUp ? title : null, titleUp ? key : null);

  return (
    <>
      {entries.map((e) => (
        <ArrivalBanner key={e.id} title={e.value} shown={e.shown} onHidden={() => remove(e.id)} />
      ))}
      <UiPresence show={doneKey === key && !traveling} exit={0.8}>
        <LocationPanel key={key} inDungeon={inDungeon} floor={floor} biome={title.subtitle ?? ""} />
      </UiPresence>
    </>
  );
}

/** Calls `onWalked` once, when the player has walked WALK_AWAY metres from
 * where they stood when `active` began — but not before `minSeconds`. */
function useWalkAway(active: boolean, minSeconds: number, onWalked: () => void) {
  const start = useRef<{ x: number; z: number; t: number } | null>(null);
  const fired = useRef(false);
  const cb = useRef(onWalked);
  cb.current = onWalked;
  useEffect(() => {
    start.current = null;
    fired.current = false;
  }, [active]);
  useFrame(({ clock }) => {
    if (!active || fired.current) return;
    const t = clock.elapsedTime;
    const s = (start.current ??= { x: playerPosition.x, z: playerPosition.z, t });
    if (t - s.t < minSeconds) return;
    if (Math.hypot(playerPosition.x - s.x, playerPosition.z - s.z) > WALK_AWAY) {
      fired.current = true;
      cb.current();
    }
  });
}

const L = HUD_LAYOUT.plaque;
const A = apx(L.distance);
/** Labels one px over artpass's 8: Silkscreen must keep a whole screen pixel
 * per font pixel down to a 600 px tall window. */
const LABEL = fontPx(9, "label", L.distance);
const NUM = fontPx(30, "body", L.distance);
const BODY = fontPx(13, "body", L.distance);
/** Padding box (artpass .wm-loc: min-width 236, padding 4 8). */
const CSS_W = 240;
const PAD_X = 8;
const PAD_Y = 4;
const CW = CSS_W - PAD_X * 2;

/** Row centres from the content top, ap pixels (artpass's CSS stack:
 * label 11, number row 27, runes +4 · 24, label +3 · 11, rule, gear row). */
const DUNGEON_ROWS = { label: 5.5, numBottom: 37, runes: 52, tithe: 72, rule: 84, gear: 96, height: 105 } as const;
const VILLAGE_ROWS = { label: 5.5, numBottom: 37, range: 45.5, deepest: 57.5, height: 0 } as const;

function LocationPanel({ inDungeon, floor, biome }: { inDungeon: boolean; floor: number; biome: string }) {
  const floorsPlayed = useGame((s) => s.run?.floorsPlayed ?? 0);
  const equipment = useGame((s) => s.equipment);
  const deepest = useGame((s) => s.deepest);
  const amHost = useNet(selectIsHost);
  const mode = useNet((s) => s.mode);
  const net = netStatus(mode, amHost, inDungeon);
  const ids = useMemo(() => [equipment.staff.defId, equipment.amulet?.defId, equipment.cloak?.defId, equipment.boots?.defId], [equipment]);
  const gear = Math.round(gearLevel(ids));
  const entry = entryFloorForGear(ids);
  const runes = titheRunes(floorsPlayed);
  const home = inDungeon && canLeave(floorsPlayed);

  // The village stack: the deepest line only once there is one.
  const rows = inDungeon ? DUNGEON_ROWS : VILLAGE_ROWS;
  const villageEnd = deepest > 0 ? VILLAGE_ROWS.deepest + 5.5 : VILLAGE_ROWS.range + 5.5;
  const ruleAt = inDungeon ? DUNGEON_ROWS.rule : villageEnd + 6;
  const gearAt = inDungeon ? DUNGEON_ROWS.gear : ruleAt + 12;
  const contentH = inDungeon ? DUNGEON_ROWS.height : gearAt + 9;
  const cssH = contentH + PAD_Y * 2;
  const [pw, ph] = plateSize(CSS_W, cssH);
  const outerW = pw + FRAME_TEXEL * 2;
  const outerH = ph + FRAME_TEXEL * 2;
  // Plate-local ap pixels of a point `cy` down the content box.
  const x0 = -CSS_W / 2 + PAD_X;
  const yAt = (cy: number) => (cssH / 2 - PAD_Y - cy) * A;
  const X = (cx: number) => (x0 + cx) * A;

  const numText = inDungeon ? `${floor}` : "The Village";
  const numW = measureText(numText, NUM, undefined, "body").width / A;
  const gearLabelW = measureText("GEAR", LABEL, undefined, "label").width / A;

  return (
    <HudAnchor h={L.h} v={L.v} inset={L.inset} distance={L.distance}>
      <group position={[(outerW / 2) * A, -(outerH / 2) * A, 0]}>
        <Plate width={pw * A} height={ph * A} frame={home ? "gold" : "brass"} texel={FRAME_TEXEL * A} fillOpacity={0.94}>
          <RuneText text={inDungeon ? "FLOOR" : "SANCTUARY"} font="label" px={LABEL} color={ink.faded} anchor={[0, 0.5]} align="left" position={[X(0), yAt(rows.label), 0]} glow={0.25} outline={0.6} delay={0.15} />
          <RuneText
            text={numText}
            font="body"
            px={NUM}
            color={ink.parchment}
            anchor={[0, 1]}
            align="left"
            position={[X(0), yAt(rows.numBottom), 0]}
            glow={0.15}
            outline={0.55}
            delay={0.2}
          />
          {inDungeon ? (
            <>
              <RuneText text={biome} font="body" px={BODY} color={ink.brassLight} anchor={[0, 1]} align="left" position={[X(numW + 8), yAt(DUNGEON_ROWS.numBottom - 1), 0]} glow={0.5} outline={0.6} delay={0.3} />
              {runes.map((state, i) => (
                <TitheRune
                  key={i}
                  index={i}
                  state={state}
                  unit={A}
                  linkLit={state !== "dark"}
                  position={[X(RUNE_BOX.w / 2 + i * (RUNE_BOX.w + RUNE_BOX.link)), yAt(DUNGEON_ROWS.runes), 0.0005]}
                />
              ))}
              <RuneText
                text={titheLine(floorsPlayed).toUpperCase()}
                font={home ? "body" : "label"}
                px={home ? BODY : LABEL}
                color={home ? ink.gold : ink.faded}
                anchor={[0, 0.5]}
                align="left"
                position={[X(0), yAt(DUNGEON_ROWS.tithe + (home ? 2 : 0)), 0]}
                glow={home ? 1.2 : 0.25}
                outline={0.6}
                delay={0.45}
              />
            </>
          ) : (
            <>
              <RuneText
                text={[{ text: "THE RIFT WILL CAST YOU TO FLOOR " }, { text: `${entry}`, color: ink.arcane }]}
                font="label"
                px={LABEL}
                color={ink.faded}
                anchor={[0, 0.5]}
                align="left"
                position={[X(0), yAt(VILLAGE_ROWS.range), 0]}
                glow={0.3}
                outline={0.6}
                delay={0.3}
              />
              {deepest > 0 && (
                <RuneText
                  text={[{ text: "DEEPEST WALKED HOME FROM " }, { text: `${deepest}`, color: ink.brassLight }]}
                  font="label"
                  px={LABEL}
                  color={ink.faded}
                  anchor={[0, 0.5]}
                  align="left"
                  position={[X(0), yAt(VILLAGE_ROWS.deepest), 0]}
                  glow={0.3}
                  outline={0.6}
                  delay={0.4}
                />
              )}
            </>
          )}
          <Divider width={CW} unit={A} delay={0.35} position={[X(CW / 2), yAt(ruleAt), 0]} />
          <PixelSprite name="gem" tint={ink.brassLight} texel={A} position={[X(3.5), yAt(gearAt), 0.0005]} delay={0.45} />
          <RuneText text="GEAR" font="label" px={LABEL} color={ink.faded} anchor={[0, 0.5]} align="left" position={[X(13), yAt(gearAt), 0]} glow={0.25} outline={0.6} delay={0.45} />
          <RuneText text={`${gear}`} font="body" px={BODY} color={ink.brassLight} anchor={[0, 0.5]} align="left" position={[X(13 + gearLabelW + 6), yAt(gearAt - 0.5), 0]} glow={0.6} outline={0.6} delay={0.5} />
          <RuneText text={net.text.toUpperCase()} font="label" px={LABEL} color={net.color} anchor={[1, 0.5]} align="right" position={[X(CW), yAt(gearAt), 0]} glow={0.4} outline={0.6} delay={0.55} />
        </Plate>
      </group>
    </HudAnchor>
  );
}
