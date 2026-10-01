import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Group } from "three";
import { BAG_SLOTS } from "../../../items/inventory";
import { useGame } from "../../../state/gameStore";
import { useUiShow } from "../../presence";
import { Tablet } from "../../Tablet";
import { ink } from "../../theme";
import { GoldHoard } from "./GoldHoard";
import { useInventory } from "./interaction";
import { ALTAR, altarLayout, type TabletSpec } from "./layout";
import { GoldRule, Headline, LABEL_PX, Recess, SectionLabel, TitlePlate } from "./parts";
import { CARD_TEXEL, Socket } from "./Socket";
import { WizardShrine } from "./WizardShrine";

/** The soot of every inventory panel (artpass `.wm-panel--solid`): the
 * stones are still stones, but dark enough that brass and parchment carry
 * the page. */
export const PANEL_TINT = "#18151d";

/** Tells the scene when the altar's face is showing (the Tablet reveals its
 * children only once the stones have locked together). */
function ReadyFlag() {
  const ix = useInventory();
  const shown = useUiShow();
  useEffect(() => {
    ix.ready = shown;
  }, [ix, shown]);
  return null;
}

/** The span of a socket row, for its recess and caption. */
function rowSpan(spec: TabletSpec, variant: "belt" | "bag") {
  const xs = spec.sockets.filter((s) => s.variant === variant).map((s) => s.x);
  const half = ALTAR.rowSize / 2 + CARD_TEXEL * 3;
  return { x0: Math.min(...xs) - half, x1: Math.max(...xs) + half };
}

/** "SATCHEL · 3/5" — how full the bag is, like artpass's item count. */
function BagCount({ x, y }: { x: number; y: number }) {
  const used = useGame((s) => s.bag.filter(Boolean).length);
  return <SectionLabel text={`${used}/${BAG_SLOTS}`} x={x} y={y} align="right" color={used >= BAG_SLOTS ? ink.blood : ink.faded} delay={0.2} />;
}

/** The altar: your inventory as one grimoire page. "The Wizard" heads it with
 * your gold on the right; your wizard stands in a window at its heart with
 * the four gear cards around the figure (the paper doll); the belt (Q/E)
 * and the satchel's five cards sit in wells along the bottom. */
export function AltarTablet({ tilt = false }: { tilt?: boolean }) {
  const ix = useInventory();
  const spec = useMemo(() => altarLayout(), []);
  const face = useRef<Group>(null);
  useLayoutEffect(() => ix.registerSurface("altar", { spec, object: face.current! }), [ix, spec]);
  const belt = rowSpan(spec, "belt");
  const bag = rowSpan(spec, "bag");
  const wellTop = ALTAR.rowY + ALTAR.rowSize / 2 + CARD_TEXEL * 3;
  const wellBottom = ALTAR.rowY - ALTAR.rowSize / 2 - CARD_TEXEL * 3 - LABEL_PX * 8.5;
  const captionY = wellTop + LABEL_PX * 4.5;
  const m = ALTAR.marginX;

  return (
    <Tablet width={spec.width} height={spec.height} tint={PANEL_TINT} frame="brass" seed={3} tile={0.17} tilt={tilt}>
      <group ref={face}>
        <TitlePlate text="INVENTORY" y={ALTAR.height / 2 + 0.006} />
        <Headline text="The Wizard" x={-m} y={ALTAR.titleY} />
        <GoldHoard position={[ALTAR.goldX, ALTAR.titleY + 0.012, 0]} />
        <GoldRule x0={-m} x1={m} y={ALTAR.ruleY} />
        <SectionLabel text="EQUIPPED" x={-m} y={ALTAR.ruleY - LABEL_PX * 5} />
        <WizardShrine />
        <ReadyFlag />
        <SectionLabel text="BELT" x={belt.x0} y={captionY} />
        <SectionLabel text="SATCHEL" x={bag.x0} y={captionY} />
        <BagCount x={bag.x1} y={captionY} />
        <Recess x={(belt.x0 + belt.x1) / 2} y={(wellTop + wellBottom) / 2} w={belt.x1 - belt.x0} h={wellTop - wellBottom} />
        <Recess x={(bag.x0 + bag.x1) / 2} y={(wellTop + wellBottom) / 2} w={bag.x1 - bag.x0} h={wellTop - wellBottom} />
        {spec.sockets.map((s) => (
          <Socket key={s.key} spec={s} />
        ))}
      </group>
    </Tablet>
  );
}
