import { useFrame } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Group, Vector3 } from "three";
import { useGame } from "../../../state/gameStore";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { measureText, RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { emitUiSparks } from "../../UiSparks";
import { SCENE_DISTANCE, TEXT } from "./layout";
import { INK } from "./materials";
import { LABEL_PX } from "./parts";
import { PixelSprite, spriteSize } from "./sprites";

/** Your gold, the grimoire way: a pixel coin and the count in gold beside
 * it, right-aligned to `position` (the counter rewrites only the digits that
 * change). Unbanked run gold is written under it in at-risk orange. When
 * the hoard changes the coin flips — four hard frames, edge-on and back —
 * and sheds gold embers. */

const GOLD_PX = pxFor(SCENE_DISTANCE, TEXT.gold);
const COIN_PX = (GOLD_PX * 9) / spriteSize("coin").h;
/** Coin flip frames: x-scale per step. */
const FLIP = [1, 0.5, 0.15, 0.5, 1];
const FLIP_STEP = 0.06;

export function GoldHoard({ position }: { position: readonly [number, number, number] }) {
  const gold = useGame((s) => s.gold);
  const runGold = useGame((s) => s.runGold);
  const coin = useRef<Group>(null);
  const flipAt = useRef(-10);

  const last = useRef(gold + runGold);
  useEffect(() => {
    const total = gold + runGold;
    if (total === last.current) return;
    last.current = total;
    flipAt.current = uiNow();
    const g = coin.current;
    if (!g) return;
    const p = g.getWorldPosition(new Vector3());
    emitUiSparks({ position: [p.x, p.y, p.z + 0.02], color: INK.gold, count: 14, speed: 0.2, up: 0.1, size: 0.009, spread: 0.05, ttl: 0.8 });
  }, [gold, runGold]);

  useFrame(() => {
    const g = coin.current;
    if (!g) return;
    const i = Math.floor((uiNow() - flipAt.current) / FLIP_STEP);
    g.scale.x = FLIP[Math.min(FLIP.length - 1, Math.max(0, i))]!;
  });

  const width = measureText(`${gold}`, GOLD_PX).width;
  return (
    <group position={position as [number, number, number]}>
      <group ref={coin} position={[-width - GOLD_PX * 7, 0, 0.003]}>
        <PixelSprite name="coin" tint={ink.gold} px={COIN_PX} delay={0.3} />
      </group>
      <RuneText text={`${gold}`} px={GOLD_PX} color={INK.gold} glow={0.9} anchor={[1, 0.5]} position={[0, 0, 0.004]} delay={0.35} />
      <RuneText
        text={runGold > 0 ? `+${runGold} unbanked` : "gold"}
        font="label"
        px={LABEL_PX}
        color={runGold > 0 ? INK.runLoot : ink.faded}
        glow={0.3}
        anchor={[1, 0.5]}
        position={[0, -GOLD_PX * 7 - LABEL_PX * 4, 0.004]}
        delay={0.45}
      />
    </group>
  );
}
