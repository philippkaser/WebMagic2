import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Group, Mesh, TorusGeometry, Vector3 } from "three";
import { getItemDef, resolveItem } from "../../../items/catalog";
import { GAMBLE_PRICE, merchantPrice } from "../../../items/economy";
import { useGame } from "../../../state/gameStore";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { glowMaterial } from "../../materials";
import { Plate } from "../../Plate";
import { useUiShow } from "../../presence";
import { RuneButton } from "../../RuneButton";
import { Tablet } from "../../Tablet";
import { measureText, RuneText } from "../../text/RuneText";
import { STEP, typePx } from "../../text/type";
import { FRAMES, ink } from "../../theme";
import { PANEL_TINT } from "./AltarTablet";
import { cardFrame, cardMaterial, cardQuad } from "./card";
import { landedCell } from "./dropTarget";
import { EMPTY_FRAME, GRADES, gradeOf, litFrame } from "./grade";
import { carriedNow, useInventory, useInventoryVersion } from "./interaction";
import { GAMBLE_WARE, SCENE_DISTANCE, slotKey, STALL, stallLayout, TEXT, wareKey } from "./layout";
import { INK, plane } from "./materials";
import { Headline, LABEL_PX, Lore, PANEL_TEXEL, TitlePlate } from "./parts";
import { CARD_TEXEL, Socket, SocketItem } from "./Socket";
import { PixelSprite, spriteSize } from "./sprites";

/** Maro's stall, as the merchant's page: each ware is a framed row — its
 * item card, its name in its grade's colour, the price beside a coin, and a
 * gold BUY button (the Orb of Fortune's row is violet and says TEMPT).
 * Along the foot runs his trough — drag anything of yours onto the stall
 * and the trough's frame turns gold and blinks; over the stall it lights
 * with his offer; let go and it's sold, the coins come back.
 *
 * All prices and rules are the store's (buyItem / gamble / sellStack); the
 * stall only shows them and, when something is bought, flies it from the
 * shelf to wherever the store put it. */

const NAME_PX = pxFor(SCENE_DISTANCE, TEXT.plaqueLine);
const PRICE_PX = pxFor(SCENE_DISTANCE, TEXT.label);
const BUTTON_PX = typePx(SCENE_DISTANCE, STEP.text, "label");
const COIN_PX = (PRICE_PX * 8) / spriteSize("coin").h;
const ORB = GRADES.enchanted;

export function MerchantStall() {
  const ix = useInventory();
  const spec = useMemo(() => stallLayout(), []);
  const face = useRef<Group>(null);
  useLayoutEffect(() => ix.registerSurface("stall", { spec, object: face.current! }), [ix, spec]);
  const gold = useGame((s) => s.gold);
  const m = STALL.marginX;

  const buy = (ware: string) => {
    const before = carriedNow();
    const from = new Vector3();
    const haveFrom = ix.socketRootPosition(wareKey(ware), from, 0.06);
    const act = useGame.getState();
    if (ware === GAMBLE_WARE) act.gamble();
    else act.buyItem(ware);
    const landed = landedCell(before, carriedNow());
    if (landed && haveFrom) ix.arrive(slotKey(landed), from);
  };

  return (
    <Tablet width={spec.width} height={spec.height} tint={PANEL_TINT} frame="gold" seed={11} tile={0.17}>
      <group ref={face}>
        <TitlePlate text="MERCHANT" y={STALL.height / 2 + 0.006} frame="gold" />
        <Headline text="Maro's Wares" x={-m} y={STALL.titleY} />
        <Lore text="Coin up front · no credit." x={-m} y={STALL.subtitleY} />
        {spec.sockets.map((s, i) => {
          const isOrb = s.ware === GAMBLE_WARE;
          const price = isOrb ? GAMBLE_PRICE : merchantPrice(s.ware!) ?? 0;
          const affordable = gold >= price;
          const grade = isOrb ? ORB : gradeOf(resolveItem(s.ware!));
          const name = isOrb ? "Orb of Fortune" : getItemDef(s.ware!).name;
          const priceText = `${price}`;
          return (
            <group key={s.key}>
              <Plate
                width={STALL.rowWidth}
                height={STALL.rowHeight}
                frame={isOrb ? "violet" : "iron"}
                texel={PANEL_TEXEL}
                fill="#0e0a12"
                fillOpacity={0.92}
                position={[0, s.y, 0.0005]}
              />
              {isOrb ? (
                <Socket spec={s} grade={ORB}>
                  {(riseAt) => <SocketItem spec={s} itemId={GAMBLE_WARE} model={<FortuneOrb />} riseAt={riseAt} />}
                </Socket>
              ) : (
                <Socket spec={s} wareItem={s.ware!} />
              )}
              <RuneText
                text={name}
                px={NAME_PX}
                color={grade.color}
                glow={0.6}
                align="left"
                anchor={[0, 0.5]}
                position={[STALL.textX, s.y + 0.028, 0.004]}
                delay={0.1 + i * 0.08}
              />
              <PixelSprite name="coin" tint={ink.gold} px={COIN_PX} anchor={[0, 0.5]} position={[STALL.textX, s.y - 0.032, 0.004]} delay={0.2 + i * 0.08} />
              <RuneText
                text={[
                  { text: priceText, color: affordable ? INK.gold : ink.blood },
                  ...(isOrb ? [{ text: "  random gear", color: ink.faded }] : affordable ? [] : [{ text: "  not enough", color: ink.faded }]),
                ]}
                font="label"
                px={PRICE_PX}
                glow={0.4}
                align="left"
                anchor={[0, 0.5]}
                position={[STALL.textX + COIN_PX * 12, s.y - 0.032, 0.004]}
                delay={0.18 + i * 0.08}
              />
              <RuneButton
                label={isOrb ? "TEMPT" : "BUY"}
                variant={isOrb ? ORB.color : "gold"}
                px={BUTTON_PX}
                width={STALL.buttonWidth}
                disabled={!affordable}
                position={[STALL.buttonX, s.y, 0.006]}
                onPress={() => buy(s.ware!)}
                delay={0.25 + i * 0.08}
              />
            </group>
          );
        })}
        <SellTrough />
      </group>
    </Tablet>
  );
}

/** The trough along the stall's foot, drawn as a wide card: idle, its frame
 * is dark iron and it says how selling works; while you drag something
 * sellable its frame turns gold and blinks; over the stall it lights solid
 * gold and names Maro's price. */
function SellTrough() {
  const ix = useInventory();
  const show = useUiShow();
  useInventoryVersion(ix);
  const drag = ix.drag;
  const selling = drag?.action.kind === "sell" ? drag.action.gold : null;
  const canSell = !!drag && !(drag.from.container === "equipment" && drag.from.slot === "staff");
  const w = STALL.trayWidth;
  const h = STALL.trayHeight;
  const material = useMemo(() => cardMaterial(w, h, CARD_TEXEL, EMPTY_FRAME, "#140f08"), [w, h]);
  useEffect(() => () => material.dispose(), [material]);
  const gold = useMemo(() => ({ base: cardFrame(FRAMES.gold), lit: cardFrame(litFrame(FRAMES.gold)), idle: cardFrame(EMPTY_FRAME) }), []);
  const shownAt = useRef(uiNow());
  useEffect(() => {
    if (show) shownAt.current = uiNow();
  }, [show]);
  const quad = cardQuad(w, h, material.uniforms.uShadow.value);
  useFrame(() => {
    const u = material.uniforms;
    const t = uiNow() - shownAt.current - 0.2;
    const k = show ? Math.min(1, Math.max(0, t / 0.35)) : 0;
    u.uProgress.value = k;
    u.uBody.value = Math.round(k * 4) / 4;
    u.uFade.value = show ? 1 : 0;
    const blink = Math.floor(uiNow() * 4) % 2 === 0;
    u.uGlow.value.set(ink.gold);
    u.uRing.value.set(ink.gold);
    u.uWash.value.set(ink.gold);
    if (selling !== null) {
      u.uFrame.value = gold.lit;
      u.uRingK.value = 1;
      u.uWashK.value = 0.16;
      u.uGlowK.value = 0.5;
    } else if (canSell) {
      u.uFrame.value = gold.base;
      u.uRingK.value = blink ? 1 : 0;
      u.uWashK.value = 0;
      u.uGlowK.value = 0.25;
    } else {
      u.uFrame.value = gold.idle;
      u.uRingK.value = 0;
      u.uWashK.value = 0;
      u.uGlowK.value = 0;
    }
  });
  const label =
    selling !== null
      ? [{ text: `SELL FOR ${selling} GOLD`, color: INK.gold }]
      : canSell
        ? [{ text: "LET GO ON THE STALL TO SELL", color: INK.gold }]
        : [{ text: "DRAG YOUR THINGS HERE TO SELL", color: ink.faded }];
  const labelW = measureText(label, LABEL_PX, undefined, "label").width;
  return (
    <group position={[0, STALL.trayY, 0]}>
      <mesh geometry={plane()} material={material} scale={quad.scale} position={[quad.offset[0], quad.offset[1], 0.001]} renderOrder={5} />
      <PixelSprite name="coin" tint={selling !== null || canSell ? ink.gold : ink.faded} px={COIN_PX} position={[-labelW / 2 - COIN_PX * 8, 0, 0.004]} delay={0.4} />
      <RuneText text={label} font="label" px={LABEL_PX} glow={selling !== null ? 1 : 0.4} position={[0, 0, 0.004]} delay={0.3} />
    </group>
  );
}

// ── The Orb of Fortune ───────────────────────────────────────────────────────

let orbRing: TorusGeometry | null = null;

/** Not an item: a swirl of violet light caught in two turning rings. Sized
 * like an ItemModel (~1 unit) so it stands in a card like one. */
function FortuneOrb() {
  const a = useRef<Group>(null);
  const b = useRef<Group>(null);
  const core = useRef<Mesh>(null);
  orbRing ??= new TorusGeometry(0.34, 0.03, 4, 16);
  useFrame(() => {
    const t = uiNow();
    if (a.current) a.current.rotation.set(t * 0.9, t * 0.5, 0.4);
    if (b.current) b.current.rotation.set(-t * 0.6, 0.3, t * 0.8);
    if (core.current) core.current.scale.setScalar(Math.floor(t * 3) % 2 === 0 ? 0.2 : 0.18);
  });
  return (
    <group>
      <mesh ref={core} material={glowMaterial(ORB.color, 2.8)}>
        <icosahedronGeometry args={[1, 0]} />
      </mesh>
      <group ref={a}>
        <mesh geometry={orbRing} material={glowMaterial(ink.gold, 1.2)} />
      </group>
      <group ref={b}>
        <mesh geometry={orbRing} material={glowMaterial(ORB.color, 1.6)} scale={0.8} />
      </group>
    </group>
  );
}
