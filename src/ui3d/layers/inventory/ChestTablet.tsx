import { useLayoutEffect, useMemo, useRef } from "react";
import { Group } from "three";
import { CHEST_SLOTS } from "../../../items/inventory";
import { useGame } from "../../../state/gameStore";
import { Tablet } from "../../Tablet";
import { PANEL_TINT } from "./AltarTablet";
import { useInventory } from "./interaction";
import { CHEST, chestLayout } from "./layout";
import { Headline, Lore, Recess, SectionLabel, TitlePlate } from "./parts";
import { CARD_TEXEL, Socket } from "./Socket";

/** The village chest, as the page beside your altar (artpass's stash):
 * thirty cards in a well that never leave the village and are never at
 * risk. Same sockets, same drag & drop as the altar's — it's all one
 * scene. */
export function ChestTablet() {
  const ix = useInventory();
  const spec = useMemo(() => chestLayout(), []);
  const face = useRef<Group>(null);
  useLayoutEffect(() => ix.registerSurface("chest", { spec, object: face.current! }), [ix, spec]);
  const used = useGame((s) => s.chest.filter(Boolean).length);
  const rows = Math.ceil(CHEST_SLOTS / CHEST.cols);
  const pad = CHEST.size / 2 + CARD_TEXEL * 4;
  const wellW = (CHEST.cols - 1) * CHEST.pitch + pad * 2;
  const wellH = (rows - 1) * CHEST.pitch + pad * 2;
  const m = CHEST.marginX;

  return (
    <Tablet width={spec.width} height={spec.height} tint={PANEL_TINT} frame="brass" seed={7} projector tile={0.17}>
      <group ref={face}>
        <TitlePlate text="STASH" y={CHEST.height / 2 + 0.006} />
        <Headline text="Your Chest" x={-m} y={CHEST.titleY} />
        <SectionLabel text={`${used} ITEM${used === 1 ? "" : "S"}`} x={m} y={CHEST.titleY} align="right" delay={0.2} />
        <Lore text="Safe in the village, always." x={-m} y={CHEST.loreY} />
        <Recess x={0} y={CHEST.gridY} w={wellW} h={wellH} />
        {spec.sockets.map((s) => (
          <Socket key={s.key} spec={s} />
        ))}
      </group>
    </Tablet>
  );
}
