import { useFrame } from "@react-three/fiber";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Group, Mesh, TorusGeometry, Vector3 } from "three";
import { ENCHANT_COLOR } from "../../../items/affixes";
import { getItemDef } from "../../../items/catalog";
import { GAMBLE_PRICE, merchantPrice } from "../../../items/economy";
import { useGame } from "../../../state/gameStore";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { glowMaterial } from "../../materials";
import { RuneButton } from "../../RuneButton";
import { Tablet } from "../../Tablet";
import { RuneText } from "../../text/RuneText";
import { landedCell } from "./dropTarget";
import { carriedNow, useInventory, useInventoryVersion } from "./interaction";
import { GAMBLE_WARE, SCENE_DISTANCE, slotKey, STALL, stallLayout, TEXT, wareKey } from "./layout";
import { bronze, frameGeometry, INK, plane, spillMaterial, wellMaterial } from "./materials";
import { Socket, SocketItem } from "./Socket";

/** Maro's stall: his wares on a warm stone shelf, each resting in its own
 * bronze-rimmed socket with its name and price beside it and a BUY plaque to
 * press; the Orb of Fortune swirls on the bottom shelf. Along the foot of the
 * stall runs his trough — drag anything of yours onto the stall and it
 * kindles gold with his offer; let go and it's sold, the coins come back.
 *
 * All prices and rules are the store's (buyItem / gamble / sellStack); the
 * stall only shows them and, when something is bought, flies it from the
 * shelf to wherever the store put it. */

const NAME_PX = pxFor(SCENE_DISTANCE, TEXT.plaqueLine);
const PRICE_PX = pxFor(SCENE_DISTANCE, TEXT.label);
const TITLE_PX = pxFor(SCENE_DISTANCE, TEXT.title * 0.9);

export function MerchantStall() {
  const ix = useInventory();
  const spec = useMemo(() => stallLayout(), []);
  const face = useRef<Group>(null);
  useLayoutEffect(() => ix.registerSurface("stall", { spec, object: face.current! }), [ix, spec]);
  const gold = useGame((s) => s.gold);

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
    <Tablet width={spec.width} height={spec.height} tint="#5a4a42" accent={INK.gold} seed={11} tile={0.17}>
      <group ref={face}>
        <RuneText text="MARO THE PROVISIONER" px={TITLE_PX} color={INK.bright} glow={0.9} position={[0, STALL.titleY, 0.002]} />
        <RuneText
          text="coin up front · no credit"
          px={PRICE_PX}
          color={INK.faint}
          glow={0.4}
          position={[0, STALL.subtitleY, 0.002]}
          delay={0.2}
        />
        {spec.sockets.map((s, i) => {
          const isOrb = s.ware === GAMBLE_WARE;
          const price = isOrb ? GAMBLE_PRICE : merchantPrice(s.ware!) ?? 0;
          const affordable = gold >= price;
          const name = isOrb ? "Orb of Fortune" : getItemDef(s.ware!).name;
          const color = isOrb ? ENCHANT_COLOR : getItemDef(s.ware!).color;
          return (
            <group key={s.key}>
              {isOrb ? (
                <Socket spec={s} accent={INK.gold}>
                  {(riseAt) => <SocketItem spec={s} itemId={GAMBLE_WARE} model={<FortuneOrb />} riseAt={riseAt} />}
                </Socket>
              ) : (
                <Socket spec={s} accent={INK.gold} wareItem={s.ware!} />
              )}
              <RuneText
                text={name}
                px={NAME_PX}
                color={color}
                glow={0.8}
                align="left"
                anchor={[0, 0.5]}
                position={[STALL.textX, s.y + 0.032, 0.002]}
                delay={0.1 + i * 0.08}
              />
              <RuneText
                text={[
                  { text: `${price} gold`, color: affordable ? INK.gold : "#7d6a3a" },
                  ...(isOrb ? [{ text: " · random gear", color: INK.faint }] : []),
                ]}
                px={PRICE_PX}
                glow={0.6}
                align="left"
                anchor={[0, 0.5]}
                position={[STALL.textX, s.y - 0.038, 0.002]}
                delay={0.18 + i * 0.08}
              />
              <RuneButton
                label={isOrb ? "TEMPT" : "BUY"}
                accent={isOrb ? ENCHANT_COLOR : INK.gold}
                px={PRICE_PX}
                width={STALL.buttonWidth}
                disabled={!affordable}
                position={[STALL.buttonX, s.y, 0.004]}
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

/** The trough along the stall's foot: idle, it says how selling works; while
 * you drag something sellable it kindles gold, and over the stall it names
 * Maro's price. */
function SellTrough() {
  const ix = useInventory();
  useInventoryVersion(ix);
  const drag = ix.drag;
  const selling = drag?.action.kind === "sell" ? drag.action.gold : null;
  const canSell = !!drag && !(drag.from.container === "equipment" && drag.from.slot === "staff");
  const well = useMemo(() => wellMaterial(INK.gold, "#120d0a"), []);
  const spill = useMemo(() => spillMaterial(INK.gold, 0.5), []);
  useEffect(
    () => () => {
      well.dispose();
      spill.dispose();
    },
    [well, spill],
  );
  const spillMesh = useRef<Mesh>(null);
  const k = useRef({ seam: 0, pool: 0, spill: 0 });
  useFrame((_, dt) => {
    const s = k.current;
    const pulse = 0.8 + 0.2 * Math.sin(uiNow() * 6);
    const [seam, pool, sp] = selling !== null ? [2.4, 0.5, 1] : canSell ? [1.1 * pulse, 0.1, 0.25 * pulse] : [0.25, 0, 0];
    const q = 1 - Math.exp(-dt * 10);
    s.seam += (seam - s.seam) * q;
    s.pool += (pool - s.pool) * q;
    s.spill += (sp - s.spill) * q;
    well.uniforms.uSeam.value = s.seam;
    well.uniforms.uPool.value = s.pool;
    spill.uniforms.uIntensity.value = s.spill;
    if (spillMesh.current) spillMesh.current.visible = s.spill > 0.01;
  });
  const w = STALL.trayWidth;
  const h = STALL.trayHeight;
  const label =
    selling !== null
      ? [{ text: `SELL FOR ${selling} GOLD`, color: INK.gold }]
      : canSell
        ? [{ text: "LET GO ON THE STALL TO SELL", color: INK.gold }]
        : [{ text: "drag your things here to sell", color: INK.faint }];
  return (
    <group position={[0, STALL.trayY, 0]}>
      <mesh ref={spillMesh} geometry={plane()} material={spill} scale={[w + 0.3, h + 0.3, 1]} position={[0, 0, 0.0005]} renderOrder={3} visible={false} />
      <WideFrame w={w} h={h} />
      <mesh geometry={plane()} material={well} scale={[w, h, 1]} position={[0, 0, 0.002]} />
      <RuneText text={label} px={PRICE_PX} glow={selling !== null ? 1.3 : 0.6} position={[0, 0, 0.01]} delay={0.3} />
    </group>
  );
}

/** A bronze rim for the trough. */
function WideFrame({ w, h }: { w: number; h: number }) {
  return <mesh geometry={frameGeometry(w, h, 0.02, 0.014)} material={bronze()} />;
}

// ── The Orb of Fortune ───────────────────────────────────────────────────────

let orbRing: TorusGeometry | null = null;

/** Not an item: a swirl of violet light caught in two turning bronze rings.
 * Sized like an ItemModel (~1 unit) so it rests in a socket like one. */
function FortuneOrb() {
  const a = useRef<Group>(null);
  const b = useRef<Group>(null);
  const core = useRef<Mesh>(null);
  orbRing ??= new TorusGeometry(0.34, 0.025, 6, 32);
  useFrame(() => {
    const t = uiNow();
    if (a.current) a.current.rotation.set(t * 0.9, t * 0.5, 0.4);
    if (b.current) b.current.rotation.set(-t * 0.6, 0.3, t * 0.8);
    if (core.current) core.current.scale.setScalar(0.2 + Math.sin(t * 3.1) * 0.02);
  });
  return (
    <group>
      <mesh ref={core} material={glowMaterial(ENCHANT_COLOR, 2.8)}>
        <icosahedronGeometry args={[1, 1]} />
      </mesh>
      <group ref={a}>
        <mesh geometry={orbRing} material={glowMaterial("#ffcf4d", 1.2)} />
      </group>
      <group ref={b}>
        <mesh geometry={orbRing} material={glowMaterial(ENCHANT_COLOR, 1.6)} scale={0.8} />
      </group>
    </group>
  );
}
