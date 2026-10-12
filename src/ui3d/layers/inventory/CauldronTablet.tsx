import { useLayoutEffect, useMemo, useRef } from "react";
import { Group } from "three";
import { canAfford, countItem, getRecipe } from "../../../items/crafting";
import { resolveItem } from "../../../items/catalog";
import { useGame } from "../../../state/gameStore";
import { toWireInventory } from "../../../state/persistence";
import { pxFor } from "../../anchors";
import type { TextSpan } from "../../font/layout";
import { Plate } from "../../Plate";
import { RuneButton } from "../../RuneButton";
import { Tablet } from "../../Tablet";
import { RuneText } from "../../text/RuneText";
import { STEP, typePx } from "../../text/type";
import { ink } from "../../theme";
import { PANEL_TINT } from "./AltarTablet";
import { gradeOf } from "./grade";
import { useInventory } from "./interaction";
import { CAULDRON, cauldronLayout, SCENE_DISTANCE, TEXT } from "./layout";
import { INK } from "./materials";
import { Headline, Lore, PANEL_TEXEL, TitlePlate } from "./parts";
import { Socket } from "./Socket";

/** Old Wenna's cauldron, as the page beside your altar: one framed row per
 * draught she knows — its card, its name in its rarity's colour, what it
 * takes (each reagent's have/need, green when you have enough), and a BREW
 * button that lights when you can. The cauldron in the camp surges and
 * gulps when a brew takes (world/villageProps.tsx); the store and the
 * server decide (items/crafting.ts). */

const NAME_PX = pxFor(SCENE_DISTANCE, TEXT.plaqueLine);
const COST_PX = pxFor(SCENE_DISTANCE, TEXT.label);
const BUTTON_PX = typePx(SCENE_DISTANCE, STEP.text, "label");

export function CauldronTablet() {
  const ix = useInventory();
  const spec = useMemo(() => cauldronLayout(), []);
  const face = useRef<Group>(null);
  useLayoutEffect(() => ix.registerSurface("cauldron", { spec, object: face.current! }), [ix, spec]);
  // Everything a recipe row reads: re-render as reagents and gold change.
  const gold = useGame((s) => s.gold);
  const pouch = useGame((s) => s.pouch);
  const bag = useGame((s) => s.bag);
  const chest = useGame((s) => s.chest);
  const belt = useGame((s) => s.belt);
  const have = useMemo(() => toWireInventory(useGame.getState()), [gold, pouch, bag, chest, belt]);
  const m = CAULDRON.marginX;

  return (
    <Tablet width={spec.width} height={spec.height} tint={PANEL_TINT} frame="brass" seed={13} tile={0.17}>
      <group ref={face}>
        <TitlePlate text="ALCHEMY" y={CAULDRON.height / 2 + 0.006} />
        <Headline text="Wenna's Cauldron" x={-m} y={CAULDRON.titleY} />
        <Lore text="Every draught begins with Grave Moss." x={-m} y={CAULDRON.subtitleY} />
        {spec.sockets.map((s, i) => {
          const recipe = getRecipe(s.recipe!)!;
          const out = resolveItem(recipe.output!);
          const ok = canAfford(have, recipe.cost!);
          const parts = recipe.cost!.items.map((c) => {
            const n = countItem(have, c.id);
            return [
              { text: `${resolveItem(c.id).name} `, color: ink.faded },
              { text: `${Math.min(n, 99)}/${c.qty}`, color: n >= c.qty ? INK.better : INK.worse },
            ];
          });
          const cost: TextSpan[] = parts.flatMap((p, j) => (j === 0 ? p : [{ text: " · ", color: ink.stoneLight }, ...p]));
          const price = recipe.cost!.gold;
          return (
            <group key={s.key}>
              <Plate
                width={CAULDRON.rowWidth}
                height={CAULDRON.rowHeight}
                frame={ok ? "brass" : "iron"}
                texel={PANEL_TEXEL}
                fill="#0e0a12"
                fillOpacity={0.92}
                position={[0, s.y, 0.0005]}
              />
              <Socket spec={s} wareItem={recipe.output!} />
              <RuneText
                text={out.name}
                px={NAME_PX}
                color={out.rarity === "common" ? ink.parchment : gradeOf(out).color}
                glow={0.5}
                align="left"
                anchor={[0, 0.5]}
                position={[CAULDRON.textX, s.y + 0.022, 0.004]}
                delay={0.1 + i * 0.05}
              />
              {price > 0 && (
                <RuneText
                  text={`${price} GOLD`}
                  font="label"
                  px={COST_PX}
                  color={gold >= price ? INK.gold : INK.worse}
                  glow={0.3}
                  align="right"
                  anchor={[1, 0.5]}
                  position={[CAULDRON.buttonX - CAULDRON.buttonWidth / 2 - 0.03, s.y + 0.022, 0.004]}
                  delay={0.15 + i * 0.05}
                />
              )}
              <RuneText
                text={cost}
                font="label"
                px={COST_PX}
                glow={0.3}
                align="left"
                anchor={[0, 0.5]}
                position={[CAULDRON.textX, s.y - 0.027, 0.004]}
                delay={0.15 + i * 0.05}
              />
              <RuneButton
                label="BREW"
                variant={ok ? "gold" : "ghost"}
                px={BUTTON_PX}
                width={CAULDRON.buttonWidth}
                disabled={!ok}
                position={[CAULDRON.buttonX, s.y, 0.006]}
                onPress={() => useGame.getState().craft(recipe.id)}
                delay={0.2 + i * 0.05}
              />
            </group>
          );
        })}
      </group>
    </Tablet>
  );
}
