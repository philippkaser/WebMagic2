import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { MeshStandardMaterial, OctahedronGeometry, type Mesh } from "three";
import { playerPosition } from "../../../game/player-state";
import { selectIsHost, useNet } from "../../../net/netStore";
import { canLeave } from "../../../run/rules";
import { useGame } from "../../../state/gameStore";
import { useTravel } from "../../../transition/store";
import { useCurrentLayout } from "../../../world/currentFloor";
import { getOmenDef } from "../../../world/omens";
import { uiNow } from "../../clock";
import { UiPresence } from "../../presence";
import { RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { apx, fontPx } from "./ap";
import { ArrivalBanner } from "./ArrivalBanner";
import { arrivalTitle, netStatus, titheLine, titheRunes } from "./copy";
import { HudAnchor } from "./HudAnchor";
import { HUD_LAYOUT } from "./layout";
import { TitheStone } from "./TitheStone";
import { usePresenceList } from "./usePresenceList";

/** Where you are.
 *
 * On arriving — at the village, or on a floor — the place names itself: the
 * arrival banner burns into the air ahead (ArrivalBanner), hangs a few
 * breaths, and burns away — sooner if you set off walking: once it has
 * been read (the title written, an omen named), a few steps dismiss it. It waits for the journey to arrive, so it lands
 * once the new place has been revealed. What it leaves behind at the
 * top left is only what you need at a glance: the Tithe of Five as five
 * small rune stones that kindle as floors are played (gold once the way
 * home is open), and a little gem for your connection to the other
 * wizards. A floor under an omen adds a violet omen stone between them.
 * When the tithe changes (or you arrive), a line says how many more floors
 * the deep wants — and names the omen, if one hangs over the floor — then
 * fades; the floor's name and what its omen does are the map's (M) to
 * tell. */

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
        <TitheMarker key={key} inDungeon={inDungeon} />
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
const LABEL = fontPx(9, "label", L.distance);
/** A tithe stone's height and the gap between stones, artpass pixels. */
const STONE = 22;
const STONE_GAP = 6;
/** Seconds the tithe line stays after it changes. */
const LINE_HOLD = 5;

function TitheMarker({ inDungeon }: { inDungeon: boolean }) {
  const floorsPlayed = useGame((s) => s.run?.floorsPlayed ?? 0);
  const layout = useCurrentLayout();
  const omen = inDungeon && layout?.omen ? getOmenDef(layout.omen) : null;
  const amHost = useNet(selectIsHost);
  const mode = useNet((s) => s.mode);
  const net = netStatus(mode, amHost, inDungeon);
  const runes = titheRunes(floorsPlayed);
  const home = inDungeon && canLeave(floorsPlayed);
  // The line under the stones: shown when the tithe changes, then gone.
  const line = inDungeon ? titheLine(floorsPlayed) : null;
  const [lineUp, setLineUp] = useState(true);
  useEffect(() => {
    setLineUp(true);
    const timer = setTimeout(() => setLineUp(false), (home ? LINE_HOLD + 2 : LINE_HOLD) * 1000);
    return () => clearTimeout(timer);
  }, [line, home]);

  const S = STONE * A;
  const stonesW = inDungeon ? runes.length * (STONE + STONE_GAP) + (omen ? STONE + STONE_GAP : 0) : 0;
  return (
    <HudAnchor h={L.h} v={L.v} inset={L.inset} distance={L.distance}>
      {inDungeon &&
        runes.map((state, i) => (
          <TitheStone
            key={i}
            index={i}
            lit={state !== "dark"}
            pulse={state === "now"}
            color={state === "home" ? ink.gold : ink.arcane}
            size={S}
            position={[(i * (STONE + STONE_GAP) + STONE / 2) * A, -(STONE / 2 + 9) * A, 0]}
          />
        ))}
      {omen && (
        <TitheStone
          index={7}
          lit
          pulse
          color={ink.violet}
          size={S}
          position={[(runes.length * (STONE + STONE_GAP) + 3 + STONE / 2) * A, -(STONE / 2 + 9) * A, 0]}
        />
      )}
      <NetGem color={net.color} online={mode === "online"} connecting={mode === "connecting"} position={[(stonesW + 8) * A, -(STONE / 2 + 9) * A, 0.004]} />
      {line && (
        <RuneText
          text={line.toUpperCase()}
          show={lineUp}
          font="label"
          px={LABEL}
          color={home ? ink.gold : ink.parchmentDim}
          anchor={[0, 0.5]}
          align="left"
          position={[0, -(STONE + 19) * A, 0]}
          glow={home ? 1.2 : 0.35}
          outline={0.6}
          delay={0.5}
        />
      )}
      {omen && (
        <RuneText
          text={`OMEN · ${omen.name.toUpperCase()} · M TO RECALL`}
          show={lineUp}
          font="label"
          px={LABEL}
          color="#d9b8ff"
          anchor={[0, 0.5]}
          align="left"
          position={[0, -(STONE + 30) * A, 0]}
          glow={0.6}
          outline={0.6}
          delay={0.8}
        />
      )}
    </HudAnchor>
  );
}

let gemGeo: OctahedronGeometry | null = null;

/** The connection: a little gem — green and breathing while you're among
 * the other wizards, blinking amber while it reaches for them, a cold dark
 * stone offline. */
function NetGem({ color, online, connecting, position }: { color: string; online: boolean; connecting: boolean; position: readonly [number, number, number] }) {
  const mesh = useRef<Mesh>(null);
  const tint = online ? color : connecting ? ink.gold : "#4a4452";
  const mat = useMemo(() => new MeshStandardMaterial({ color: "#0c0a12", emissive: tint, emissiveIntensity: 2, roughness: 0.25, metalness: 0.1, flatShading: true, toneMapped: false }), [tint]);
  useEffect(() => () => mat.dispose(), [mat]);
  useFrame(() => {
    const m = mesh.current;
    if (!m) return;
    const now = uiNow();
    m.rotation.y = now * 0.9;
    mat.emissiveIntensity = online ? 1.6 + 0.6 * Math.sin(now * 2) : connecting ? (Math.floor(now * 2) % 2 ? 2 : 0.4) : 0.5;
  });
  return (
    <mesh ref={mesh} geometry={(gemGeo ??= new OctahedronGeometry(1, 0))} material={mat} position={position as [number, number, number]} scale={[4 * A, 6 * A, 4 * A]} />
  );
}
