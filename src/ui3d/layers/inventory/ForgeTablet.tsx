import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Group } from "three";
import { canAfford, countItem, forgeCost, getRecipe, salvageYield, type CraftKind, type Cost } from "../../../items/crafting";
import { resolveItem, type ResolvedItem } from "../../../items/catalog";
import { readSlot } from "../../../items/inventory";
import { MAX_ENHANCE } from "../../../items/itemId";
import { useGame } from "../../../state/gameStore";
import { toWireInventory } from "../../../state/persistence";
import type { TextSpan } from "../../font/layout";
import { pxFor } from "../../anchors";
import { Plate } from "../../Plate";
import { RuneButton } from "../../RuneButton";
import { Tablet } from "../../Tablet";
import { RuneText } from "../../text/RuneText";
import { STEP, typePx } from "../../text/type";
import { ink } from "../../theme";
import { PANEL_TINT } from "./AltarTablet";
import { useAnvil } from "./anvil";
import { gradeOf } from "./grade";
import { carriedNow, useInventory } from "./interaction";
import { FORGE, forgeLayout, SCENE_DISTANCE, TEXT } from "./layout";
import { INK } from "./materials";
import { Headline, LABEL_PX, Lore, PANEL_TEXEL, SectionLabel, TitlePlate } from "./parts";
import { Socket } from "./Socket";

/** Brannoc's forge, as the page beside your altar: the anvil at its head —
 * drag a piece of your gear onto the forge (or shift-click it) and it lies
 * there, named, while the works below say what each would do to it and
 * what it costs:
 *
 *   TEMPER   +1 level, with the reagent of the depth it rises into
 *   ENHANCE  +1…+5, riftglass and arcane dust
 *   IMBUE    a new random enchantment, if it has room
 *   REFORGE  re-roll its enchantments
 *   SALVAGE  break it into reagents and essence
 *
 * and, apart from the anvil, THE GREAT WORK: Wardens' Sigils into a
 * legendary. The works are the store's (craft) and the server's; this page
 * only shows them. */

const NAME_PX = pxFor(SCENE_DISTANCE, TEXT.plaqueLine);
const INFO_PX = pxFor(SCENE_DISTANCE, TEXT.label);
const BUTTON_PX = typePx(SCENE_DISTANCE, STEP.text, "label");

interface Work {
  kind: CraftKind;
  title: string;
  /** What it would do, for the item on the anvil (null: can't). */
  effect(item: ResolvedItem): string | null;
}

const WORKS: Work[] = [
  { kind: "temper", title: "Temper", effect: (i) => `Lv ${i.level} → ${i.level + 1}` },
  { kind: "enhance", title: "Enhance", effect: (i) => (i.enhance >= MAX_ENHANCE ? null : `+${i.enhance} → +${i.enhance + 1}`) },
  { kind: "imbue", title: "Imbue", effect: () => "a new enchantment" },
  { kind: "reforge", title: "Reforge", effect: () => "new enchantments" },
  {
    kind: "salvage",
    title: "Salvage",
    effect: (i) => salvageYield(i).map((s) => `${s.qty} ${resolveItem(s.id).name}`).join(", ") || null,
  },
];

export function ForgeTablet() {
  const ix = useInventory();
  const spec = useMemo(() => forgeLayout(), []);
  const face = useRef<Group>(null);
  useLayoutEffect(() => ix.registerSurface("forge", { spec, object: face.current! }), [ix, spec]);
  const anvil = useAnvil((s) => s.ref);
  // Clear the anvil when the forge opens afresh.
  useEffect(() => useAnvil.getState().set(null), []);
  const gold = useGame((s) => s.gold);
  const pouch = useGame((s) => s.pouch);
  const bag = useGame((s) => s.bag);
  const chest = useGame((s) => s.chest);
  const equipment = useGame((s) => s.equipment);
  const have = useMemo(() => toWireInventory(useGame.getState()), [gold, pouch, bag, chest, equipment]);
  const onAnvil = useMemo(() => {
    const stack = anvil ? readSlot(carriedNow(), anvil) : null;
    return stack ? resolveItem(stack.defId) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [anvil, bag, chest, equipment]);
  const m = FORGE.marginX;
  const great = getRecipe("greatwork")!;

  const costText = (cost: Cost): TextSpan[] => {
    const out: TextSpan[] = [];
    for (const c of cost.items) {
      const n = countItem(have, c.id);
      if (out.length) out.push({ text: " · ", color: ink.stoneLight });
      out.push({ text: `${resolveItem(c.id).name} `, color: ink.faded }, { text: `${Math.min(n, 99)}/${c.qty}`, color: n >= c.qty ? INK.better : INK.worse });
    }
    return out.length ? out : [{ text: "no reagents", color: ink.faded }];
  };

  const row = (key: string, y: number, i: number, title: string, effect: string | null, cost: Cost | null, onPress: () => void, legendary = false) => {
    const ok = !!cost && canAfford(have, cost);
    return (
      <group key={key}>
        <Plate
          width={FORGE.rowWidth}
          height={FORGE.rowHeight}
          frame={legendary ? "gold" : ok ? "brass" : "iron"}
          texel={PANEL_TEXEL}
          fill="#0e0a12"
          fillOpacity={0.92}
          position={[0, y, 0.0005]}
        />
        <RuneText
          text={[
            { text: title, color: legendary ? ink.gold : cost ? ink.parchment : ink.faded },
            ...(effect ? [{ text: `   ${effect}`, color: cost ? ink.arcane : ink.faded }] : []),
          ]}
          px={NAME_PX}
          glow={0.5}
          align="left"
          anchor={[0, 0.5]}
          position={[FORGE.textX, y + 0.024, 0.004]}
          delay={0.1 + i * 0.05}
        />
        {cost && cost.gold > 0 && (
          <RuneText
            text={`${cost.gold} GOLD`}
            font="label"
            px={INFO_PX}
            color={gold >= cost.gold ? INK.gold : INK.worse}
            glow={0.3}
            align="right"
            anchor={[1, 0.5]}
            position={[FORGE.buttonX - FORGE.buttonWidth / 2 - 0.03, y + 0.024, 0.004]}
            delay={0.15 + i * 0.05}
          />
        )}
        <RuneText
          text={cost ? costText(cost) : [{ text: onAnvil ? "the forge can't" : "lay gear on the anvil", color: ink.faded }]}
          font="label"
          px={INFO_PX}
          glow={0.3}
          align="left"
          anchor={[0, 0.5]}
          position={[FORGE.textX, y - 0.028, 0.004]}
          delay={0.15 + i * 0.05}
        />
        <RuneButton
          label="FORGE"
          variant={ok ? "gold" : "ghost"}
          px={BUTTON_PX}
          width={FORGE.buttonWidth}
          disabled={!ok}
          position={[FORGE.buttonX, y, 0.006]}
          onPress={onPress}
          delay={0.2 + i * 0.05}
        />
      </group>
    );
  };

  return (
    <Tablet width={spec.width} height={spec.height} tint={PANEL_TINT} frame="brass" seed={17} tile={0.17}>
      <group ref={face}>
        <TitlePlate text="FORGE" y={FORGE.height / 2 + 0.006} />
        <Headline text="Brannoc's Anvil" x={-m} y={FORGE.titleY} />
        <Lore text="Lay a piece of your gear on the anvil." x={-m} y={FORGE.subtitleY} />
        {spec.sockets.map((s) => (
          <Socket key={s.key} spec={s} wareItem={onAnvil?.itemId ?? null} />
        ))}
        <RuneText
          text={onAnvil ? onAnvil.name : "The anvil is bare"}
          font="heading"
          px={NAME_PX}
          color={onAnvil ? (onAnvil.rarity === "common" ? ink.parchment : gradeOf(onAnvil).color) : ink.faded}
          glow={0.6}
          align="left"
          anchor={[0, 0.5]}
          position={[FORGE.infoX, FORGE.anvilY + 0.04, 0.004]}
        />
        <RuneText
          text={onAnvil ? `LV ${onAnvil.level}${onAnvil.enhance ? ` · FORGED +${onAnvil.enhance}` : ""} · ${onAnvil.affixes.length} ENCHANTMENT${onAnvil.affixes.length === 1 ? "" : "S"}` : "DRAG GEAR ONTO THE FORGE · OR SHIFT-CLICK IT"}
          font="label"
          px={INFO_PX}
          color={ink.faded}
          glow={0.2}
          align="left"
          anchor={[0, 0.5]}
          position={[FORGE.infoX, FORGE.anvilY - 0.03, 0.004]}
        />
        {WORKS.map((w, i) =>
          row(
            w.kind,
            FORGE.firstRowY - i * FORGE.rowPitch,
            i,
            w.title,
            onAnvil ? w.effect(onAnvil) : null,
            forgeCost(w.kind, onAnvil),
            () => {
              if (!anvil) return;
              useGame.getState().craft(w.kind, anvil);
              // Salvage leaves the anvil bare.
              if (w.kind === "salvage") useAnvil.getState().set(null);
            },
          ),
        )}
        <SectionLabel text="THE GREAT WORK" x={-m} y={FORGE.firstRowY - WORKS.length * FORGE.rowPitch + LABEL_PX * 1} color={ink.gold} />
        {row("greatwork", FORGE.firstRowY - (WORKS.length + 0.55) * FORGE.rowPitch - 0.02, WORKS.length, "Forge a Legendary", "from Wardens' Sigils", great.cost!, () =>
          useGame.getState().craft("greatwork"),
        true)}
      </group>
    </Tablet>
  );
}
