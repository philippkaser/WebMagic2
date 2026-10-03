import { useEffect, useState } from "react";
import { useGame } from "../../../state/gameStore";
import { getBiomeDef } from "../../../world/biomes";
import { useCurrentLayout } from "../../../world/currentFloor";
import { getOmenDef, omenEffects } from "../../../world/omens";
import { UiShow } from "../../presence";
import { RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { useMapCast } from "../map/mapStore";
import { apx, fontPx } from "./ap";
import { HOME_NAME } from "./copy";
import { HudAnchor } from "./HudAnchor";
import { HUD_LAYOUT } from "./layout";

/** The floor you're on, at the top right: its number, its biome and — on a
 * floor under an omen — the omen's name in violet. What the omen does
 * (▼ what hurts, ▲ what helps) is written out under it for a while after
 * you arrive, and again whenever a map is cast on the floor; otherwise the
 * corner stays quiet. In the village it just says where you are. */

const L = HUD_LAYOUT.floor;
const A = apx(L.distance);
const TITLE = fontPx(27, "heading", L.distance);
const LINE = fontPx(13, "body", L.distance);
/** Seconds the omen's effects stay written after arriving. */
const EFFECTS_HOLD = 12;
/** Line pitch for the small lines, artpass pixels. */
const PITCH = 13;

export function FloorInfo({ inDungeon }: { inDungeon: boolean }) {
  const layout = useCurrentLayout();
  const floor = useGame((s) => s.floor);
  const mapOut = useMapCast((s) => s.casts.length > 0);
  const [fresh, setFresh] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setFresh(false), EFFECTS_HOLD * 1000);
    return () => clearTimeout(timer);
  }, []);

  if (!inDungeon || !layout) {
    return (
      <HudAnchor h={L.h} v={L.v} inset={L.inset} distance={L.distance}>
        <RuneText text={HOME_NAME} font="heading" px={TITLE} color={ink.parchment} anchor={[1, 0]} align="right" glow={0.4} outline={0.6} position={[0, -2 * A, 0]} />
      </HudAnchor>
    );
  }
  const biome = getBiomeDef(layout.biome);
  const omen = layout.omen ? getOmenDef(layout.omen) : null;
  const effects = layout.omen ? omenEffects(layout.omen) : [];
  const right = { anchor: [1, 0] as [number, number], align: "right" as const, outline: 0.6 };
  return (
    <HudAnchor h={L.h} v={L.v} inset={L.inset} distance={L.distance}>
      <RuneText text={`Floor ${floor}`} font="heading" px={TITLE} color={ink.parchment} glow={0.4} position={[0, -2 * A, 0]} {...right} />
      <RuneText text={biome.name} px={LINE} color={biome.accent} glow={0.3} position={[0, -22 * A, 0]} delay={0.15} {...right} />
      {omen && <RuneText text={omen.name} px={LINE} color="#d9b8ff" glow={0.6} position={[0, -(22 + PITCH) * A, 0]} delay={0.3} {...right} />}
      <UiShow show={fresh || mapOut}>
        {effects.map((e, i) => (
          <RuneText
            key={e.text}
            text={`${e.text} ${e.good ? "▲" : "▼"}`}
            px={LINE}
            color={e.good ? "#8ee69a" : "#ff8a7a"}
            glow={0.3}
            position={[0, -(22 + PITCH * (2.3 + i)) * A, 0]}
            delay={0.4 + i * 0.1}
            {...right}
          />
        ))}
      </UiShow>
    </HudAnchor>
  );
}
