import { useFrame, useThree } from "@react-three/fiber";
import { useRef } from "react";
import { Vector3, type Group } from "three";
import { placeInFront } from "../../anchors";
import { uiNow } from "../../clock";
import { UiShow } from "../../presence";
import { RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { apx, fontPx, HUD_SCALE } from "./ap";
import { HUD_COLORS, type ArrivalTitle } from "./copy";
import { Divider } from "./Divider";
import { hudUnit } from "./HudAnchor";

/** The arrival banner (artpass hud/ArrivalBanner): "YOU DESCEND TO" in
 * arcane caps, "Floor 12" in big parchment blackletter, the biome in gold
 * blackletter, the brass flourish with its diamond, and the biome's line of
 * lore — or, in the village, SANCTUARY / The Village.
 *
 * It's written into the air where you're looking — each line burning in
 * after the last, the flourish drawing itself out from its diamond — hangs
 * there, drifting lazily after your gaze, and burns away. Under an omen the
 * omen's name and whisper follow a beat later in place of the lore. */

export const TITLE_D = 3.2;
/** Exactly artpass's 1× banner at 800 px tall. */
const B = apx(TITLE_D) / HUD_SCALE;
/** Top of the block, screen-height fraction from the top edge (artpass 17 %,
 * lifted a little so the message feed beneath it stays clear). */
const TOP = 0.135;
/** When the omen's lines follow the title (floorAtmosphere's omen sting
 * sounds about then). */
export const OMEN_DELAY = 1.6;

/** Line centres from the block's top, artpass pixels (its CSS stack). */
const AT = { label: 5.4, title: 55.6, biome: 124.7, flourish: 163, lore: 188.5 } as const;

const target = new Vector3();

export function ArrivalBanner({ title, shown, onHidden }: { title: ArrivalTitle; shown: boolean; onHidden: () => void }) {
  const group = useRef<Group>(null);
  const camera = useThree((s) => s.camera);
  const bornAt = useRef(-1);
  const U = hudUnit(TITLE_D);

  useFrame((_, rawDt) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(rawDt, 0.1);
    const now = uiNow();
    if (bornAt.current < 0) bornAt.current = now;
    placeInFront(camera, TITLE_D, [0, (0.5 - TOP) * U], target);
    // Written exactly where you look (held there while the first runes
    // burn in, so a hitch on arrival can't misplace it) …
    if (now - bornAt.current < 0.4) {
      g.position.copy(target);
      g.quaternion.copy(camera.quaternion);
      return;
    }
    // … then lazy: glance away and it waits; turn away and it drifts after.
    if (shown) g.position.lerp(target, 1 - Math.exp(-dt * 1.6));
    g.quaternion.slerp(camera.quaternion, 1 - Math.exp(-dt * 3));
  });

  const y = (c: number) => -c * B;
  const village = title.subtitle === null;
  // In the village there's no biome line: the flourish and lore move up.
  const lift = village ? AT.biome - AT.title - 10 : 0;
  return (
    <group ref={group}>
      <UiShow show={shown}>
        <RuneText text={title.label.toUpperCase()} font="label" px={fontPx(8, "label", TITLE_D)} color={ink.arcane} position={[0, y(AT.label), 0]} glow={0.9} outline={0.5} />
        <RuneText
          text={title.title}
          font="title"
          px={fontPx(96, "title", TITLE_D) / HUD_SCALE}
          color={ink.parchment}
          glow={1.3}
          outline={0.45}
          position={[0, y(AT.title), 0]}
          delay={0.15}
          inDuration={0.9}
          stagger={0.55}
          onHidden={onHidden}
        />
        {title.subtitle && (
          <RuneText text={title.subtitle} font="title" px={fontPx(36, "title", TITLE_D) / HUD_SCALE} color={ink.brassLight} glow={0.9} outline={0.5} position={[0, y(AT.biome), 0]} delay={0.6} inDuration={0.7} />
        )}
        <Divider width={360} unit={B} diamond delay={0.85} position={[0, y(AT.flourish - lift), 0]} />
        {title.omen ? (
          <>
            <RuneText text={title.lore} font="body" px={fontPx(14, "body", TITLE_D) / HUD_SCALE} color={ink.parchmentDim} position={[0, y(AT.lore - lift), 0]} glow={0.5} outline={0.5} delay={1.05} />
            <RuneText
              text={`Omen · ${title.omen.name}`.toUpperCase()}
              font="label"
              px={fontPx(8, "label", TITLE_D)}
              color={HUD_COLORS.omen}
              position={[0, y(AT.lore + 22), 0]}
              glow={1.1}
              outline={0.5}
              delay={OMEN_DELAY}
            />
            <RuneText
              text={title.omen.whisper}
              font="body"
              px={fontPx(14, "body", TITLE_D) / HUD_SCALE}
              color={ink.parchment}
              maxCols={64}
              anchor={[0.5, 0]}
              position={[0, y(AT.lore + 31), 0]}
              glow={0.6}
              outline={0.5}
              delay={OMEN_DELAY + 0.4}
            />
          </>
        ) : (
          <RuneText text={title.lore} font="body" px={fontPx(14, "body", TITLE_D) / HUD_SCALE} color={ink.parchmentDim} position={[0, y(AT.lore - lift), 0]} glow={0.5} outline={0.5} delay={1.05} />
        )}
      </UiShow>
    </group>
  );
}
