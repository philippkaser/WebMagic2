import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { Vector3, type Group } from "three";
import { playerPosition } from "../../../game/player-state";
import { peerName } from "../../../net/players";
import { useGame } from "../../../state/gameStore";
import { getBiomeDef } from "../../../world/biomes";
import { getCurrentLayout, markExplored, useCurrentLayout } from "../../../world/currentFloor";
import { getOmenDef } from "../../../world/omens";
import { UiShow } from "../../presence";
import { RuneText } from "../../text/RuneText";
import { STEP, typePx } from "../../text/type";
import { ink } from "../../theme";
import { SELF, type MapCast } from "./mapStore";
import { useStagedCasts } from "./useStagedCasts";

/** The cast map's words, on the UI canvas (crisp type) above its light on
 * the floor (FloorMap.tsx, world canvas): the place's name, what kind of
 * floor it is (its biome, its omen), and whose map it is if it isn't yours.
 * They hang over the map's middle below eye height, turned toward you, and
 * step aside while you stand over the middle.
 *
 * `ExploreTracker` (mounted with them) records what you've seen as you go,
 * cast or not (world/currentFloor.ts). */

/** How high the words hang over the map, m. */
const LABEL_Y = 1.15;
/** From about where they're read: the map's edge, a little above. */
const READ_DIST = 2.3;
/** Closer than this (horizontally) and they step aside. */
const NEAR = 1.1;

export function MapLabels() {
  // Re-render when the floor changes (the words name it).
  useCurrentLayout();
  const { entries, drop } = useStagedCasts();
  return (
    <>
      <ExploreTracker />
      {entries.map((e) => (
        <Label key={e.cast.id} cast={e.cast} shown={e.shown} onGone={() => drop(e.cast.id)} />
      ))}
    </>
  );
}

/** Marks the tiles around the wizard as seen, a few times a second. */
function ExploreTracker() {
  const last = useRef(0);
  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    if (t - last.current < 0.2) return;
    last.current = t;
    const layout = getCurrentLayout();
    if (layout && useGame.getState().phase === "dungeon") markExplored(layout, playerPosition.x, playerPosition.z, 4);
  });
  return null;
}

const tmpP = new Vector3();
const TITLE_PX = typePx(READ_DIST, 2, "heading");
const SMALL_PX = typePx(READ_DIST, STEP.text, "label");

function Label({ cast, shown, onGone }: { cast: MapCast; shown: boolean; onGone: () => void }) {
  const group = useRef<Group>(null);
  // Folded: the words burn off, then the entry goes.
  const goneRef = useRef(onGone);
  goneRef.current = onGone;
  useEffect(() => {
    if (shown) return;
    const timer = setTimeout(() => goneRef.current(), 1200);
    return () => clearTimeout(timer);
  }, [shown]);
  const camera = useThree((s) => s.camera);
  const [near, setNear] = useState(false);
  useFrame(() => {
    const g = group.current;
    if (!g) return;
    g.getWorldPosition(tmpP);
    g.rotation.y = Math.atan2(camera.position.x - tmpP.x, camera.position.z - tmpP.z);
    const n = Math.hypot(camera.position.x - cast.at[0], camera.position.z - cast.at[2]) < NEAR;
    if (n !== near) setNear(n);
  });
  const layout = cast.kind === "dungeon" ? getCurrentLayout() : null;
  const omen = layout?.omen ? getOmenDef(layout.omen) : null;
  const title = layout ? `Floor ${layout.floor}` : "The Village";
  const sub = layout
    ? [
        { text: getBiomeDef(layout.biome).name.toUpperCase(), color: ink.arcane },
        omen ? { text: ` · ${omen.name.toUpperCase()}`, color: "#d9b8ff" } : { text: " · A CALM FLOOR", color: ink.arcaneDim },
      ]
    : [{ text: "SANCTUARY", color: ink.arcane }];
  const whose = cast.owner === SELF ? null : `${(peerName(cast.owner) || "a wizard").toUpperCase()}'S MAP`;
  return (
    <group ref={group} position={[cast.at[0], cast.at[1] + LABEL_Y, cast.at[2]]}>
      <UiShow show={shown && !near}>
        <RuneText text={title} font="heading" px={TITLE_PX} color={ink.parchment} glow={0.7} outline={0.6} position={[0, SMALL_PX * 9 + TITLE_PX * 3.5, 0]} delay={0.7} />
        <RuneText text={sub} font="label" px={SMALL_PX} glow={0.5} outline={0.6} position={[0, SMALL_PX * 4, 0]} delay={0.9} />
        {whose && <RuneText text={whose} font="label" px={SMALL_PX} color={ink.faded} glow={0.3} outline={0.6} position={[0, -SMALL_PX * 2, 0]} delay={1} />}
      </UiShow>
    </group>
  );
}
