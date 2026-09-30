import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CylinderGeometry, Euler, Group, InstancedMesh, Matrix4, Quaternion, Vector3 } from "three";
import { useGame } from "../../../state/gameStore";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { useUiShow } from "../../presence";
import { RuneText } from "../../text/RuneText";
import { emitUiSparks } from "../../UiSparks";
import { SCENE_DISTANCE, TEXT } from "./layout";
import { coinGold, INK } from "./materials";

/** Your gold, as gold: a little heap of coins wedged into a round hollow in
 * the altar, beside a counter that rewrites only the digits that change.
 * The heap grows with the hoard (logarithmically — a thousand coins is a
 * proper pile, a hundred thousand doesn't bury the altar). Unbanked run
 * gold is written under it in the dimmer at-risk gold. */

const MAX_COINS = 18;
const COIN_R = 0.017;
const GOLD_PX = pxFor(SCENE_DISTANCE, TEXT.gold);
const SMALL_PX = pxFor(SCENE_DISTANCE, TEXT.label);

let coinGeo: CylinderGeometry | null = null;
const coinGeometry = () => (coinGeo ??= new CylinderGeometry(1, 1, 1, 14));

/** Coins for a hoard: none for nothing, then roughly +2 per doubling. */
export function coinCount(gold: number): number {
  if (gold <= 0) return 0;
  return Math.max(1, Math.min(MAX_COINS, Math.round(1 + Math.log2(1 + gold) * 1.5)));
}

/** A pile seen from the front: rows narrowing upward, each coin leaning out
 * at its own angle, deterministic so the heap doesn't reshuffle. */
function heapMatrices(): Matrix4[] {
  const out: Matrix4[] = [];
  const rows = [5, 4, 4, 3, 2];
  let k = 0;
  const q = new Quaternion();
  const e = new Euler();
  rows.forEach((n, r) => {
    for (let i = 0; i < n; i++) {
      const rnd = (s: number) => {
        const v = Math.sin((k + 1) * 12.9898 + s * 78.233) * 43758.5453;
        return v - Math.floor(v);
      };
      const x = (i - (n - 1) / 2) * COIN_R * 1.55 + (rnd(1) - 0.5) * 0.008;
      const y = -0.03 + r * COIN_R * 1.05 + (rnd(2) - 0.5) * 0.006;
      e.set(Math.PI / 2 - 0.25 - rnd(3) * 0.5, (rnd(4) - 0.5) * 0.5, (rnd(5) - 0.5) * 1.2);
      q.setFromEuler(e);
      out.push(new Matrix4().compose(new Vector3(x, y, 0.012 + r * 0.004 + rnd(6) * 0.004), q, new Vector3(COIN_R, 0.0035, COIN_R)));
      k++;
    }
  });
  // Fill order: bottom-centre first, so a small hoard sits on the floor.
  return out.slice(0, MAX_COINS);
}

export function GoldHoard({ position }: { position: readonly [number, number, number] }) {
  const show = useUiShow();
  const gold = useGame((s) => s.gold);
  const runGold = useGame((s) => s.runGold);
  const count = coinCount(gold + runGold);
  const mesh = useMemo(() => {
    const m = new InstancedMesh(coinGeometry(), coinGold(), MAX_COINS);
    heapMatrices().forEach((mat, i) => m.setMatrixAt(i, mat));
    m.count = 0;
    // Its bounding sphere would be computed once, at count 0, and cull the
    // heap forever — it's tiny and always in view anyway.
    m.frustumCulled = false;
    return m;
  }, []);
  useEffect(
    () => () => {
      mesh.dispose();
    },
    [mesh],
  );

  const group = useRef<Group>(null);
  const shownAt = useRef(uiNow());
  const shown = useRef(0);
  useEffect(() => {
    if (show) shownAt.current = uiNow();
  }, [show]);

  // Coins clink in or out: embers where the heap changed.
  const last = useRef(gold + runGold);
  useEffect(() => {
    const total = gold + runGold;
    if (total === last.current) return;
    last.current = total;
    const g = group.current;
    if (!g) return;
    const p = g.getWorldPosition(new Vector3());
    emitUiSparks({ position: [p.x, p.y, p.z + 0.02], color: INK.gold, count: 14, speed: 0.2, up: 0.1, size: 0.009, spread: 0.05, ttl: 0.8 });
  }, [gold, runGold]);

  const hollow = useRef({ k: 0 });
  useFrame((_, dt) => {
    const h = hollow.current;
    h.k = show ? Math.min(1, (uiNow() - shownAt.current) / 0.3) : Math.max(0, h.k - dt * 4);
    const g = group.current;
    if (g) {
      g.visible = h.k > 0;
      g.scale.setScalar(Math.max(0.0001, 0.6 + 0.4 * h.k));
    }
    // Coins drop into the hollow one by one after the tablet assembles.
    const target = show ? Math.min(count, Math.max(0, (uiNow() - shownAt.current - 0.3) / 0.04)) : 0;
    shown.current += (target - shown.current) * (1 - Math.exp(-dt * (show ? 30 : 12)));
    const n = Math.round(shown.current);
    if (mesh.count !== n) mesh.count = n;
  });

  return (
    <group position={position as [number, number, number]}>
      <group ref={group} position={[0.09, 0, 0]} visible={false}>
        {/* The hollow the coins sit in. */}
        <mesh scale={[0.058, 0.004, 0.058]} position={[0, 0.005, 0.002]} rotation={[Math.PI / 2, 0, 0]} geometry={coinGeometry()}>
          <meshStandardMaterial color="#0d0b10" roughness={0.9} />
        </mesh>
        <primitive object={mesh} />
      </group>
      <RuneText text={`${gold}`} px={GOLD_PX} color={INK.gold} glow={1.1} anchor={[1, 0.5]} position={[0.02, 0.012, 0.004]} delay={0.35} />
      <RuneText
        text={runGold > 0 ? `+${runGold} unbanked` : "gold"}
        px={SMALL_PX}
        color={runGold > 0 ? INK.runLoot : INK.faint}
        glow={0.5}
        anchor={[1, 0.5]}
        position={[0.02, -0.05, 0.004]}
        delay={0.45}
      />
    </group>
  );
}
