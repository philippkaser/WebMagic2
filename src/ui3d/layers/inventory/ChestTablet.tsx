import { useLayoutEffect, useMemo, useRef } from "react";
import { Group } from "three";
import { pxFor } from "../../anchors";
import { Tablet } from "../../Tablet";
import { RuneText } from "../../text/RuneText";
import { useInventory } from "./interaction";
import { CHEST, chestLayout, SCENE_DISTANCE, TEXT } from "./layout";
import { INK } from "./materials";
import { Socket } from "./Socket";

/** The village chest, as the tablet beside your altar: thirty sockets that
 * never leave the village and are never at risk. Same sockets, same drag &
 * drop as the altar's — it's all one scene. */
export function ChestTablet() {
  const ix = useInventory();
  const spec = useMemo(() => chestLayout(), []);
  const face = useRef<Group>(null);
  useLayoutEffect(() => ix.registerSurface("chest", { spec, object: face.current! }), [ix, spec]);
  const titlePx = pxFor(SCENE_DISTANCE, TEXT.title);

  return (
    <Tablet width={spec.width} height={spec.height} tint="#4b4757" seed={7} tile={0.17} accent="#8fb8ff">
      <group ref={face}>
        <RuneText text="YOUR CHEST" px={titlePx} color={INK.bright} glow={0.9} position={[0, CHEST.titleY, 0.002]} />
        <RuneText
          text="safe in the village, always"
          px={pxFor(SCENE_DISTANCE, TEXT.label)}
          color={INK.faint}
          glow={0.4}
          position={[0, CHEST.titleY - 0.085, 0.002]}
          delay={0.2}
        />
        {spec.sockets.map((s) => (
          <Socket key={s.key} spec={s} />
        ))}
      </group>
    </Tablet>
  );
}
