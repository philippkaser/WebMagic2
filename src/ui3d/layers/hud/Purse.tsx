import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CylinderGeometry, Euler, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from "three";
import { useGame } from "../../../state/gameStore";
import { palette } from "../../../ui/theme";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { useUiShow } from "../../presence";
import { measureText, RuneText } from "../../text/RuneText";
import { emitUiSparks } from "../../UiSparks";
import { coinsFor } from "./copy";
import { HEAP_CAPACITY, heapSlots, type CoinSlot } from "./heap";
import { HudAnchor, hudUnit, Undistort } from "./HudAnchor";
import { HUD_LAYOUT } from "./layout";
import { useEntryDelay } from "./useSettled";

/** The purse, as what it is: a little heap of coins carried above the
 * flasks, growing as you get richer (one coin per doubling, roughly), with
 * the count burned into the air beside it. Banked gold is bright gold; the
 * gold gathered this run — lost if you die — is a second, duller copper heap
 * with its own "+N", kept apart because it isn't yours yet.
 *
 * New coins drop onto the heap and settle; spent ones wink out. The
 * counters' changed digits re-write themselves (RuneText). */

const L = HUD_LAYOUT.purse;
const U = hudUnit(L.distance);
/** Coin radius: ~2% of the screen tall. */
const C = 0.0105 * U;
const PX = pxFor(L.distance, 0.022);
const RUN_PX = pxFor(L.distance, 0.019);
/** Half-width of a full heap, m. */
const HEAP_HALF = 3.2 * C;

let coinGeo: CylinderGeometry | null = null;
const coinMats = new Map<string, MeshStandardMaterial>();
function coinMaterial(color: string, emissive: string): MeshStandardMaterial {
  let m = coinMats.get(color);
  if (!m) {
    // Not fully metallic: with no environment to reflect, a true metal reads
    // black between highlights. A warm self-glow keeps it gold in the dark.
    m = new MeshStandardMaterial({ color, metalness: 0.55, roughness: 0.32, emissive, emissiveIntensity: 0.55 });
    coinMats.set(color, m);
  }
  return m;
}

export function Purse() {
  const gold = useGame((s) => s.gold);
  const runGold = useGame((s) => s.runGold);
  const goldText = `${gold}`;
  const d = useEntryDelay(0.4);
  const goldW = measureText(goldText, PX).width;
  const runX = HEAP_HALF * 2 + C * 1.6 + goldW + C * 2.2;
  return (
    <HudAnchor h={L.h} v={L.v} inset={L.inset} distance={L.distance}>
      <Undistort at={[HEAP_HALF, C * 0.4, 0]}>
        <Heap count={coinsFor(gold)} color="#e9b949" emissive="#6a4308" seed={1} />
      </Undistort>
      <RuneText text={goldText} px={PX} color={palette.gold} anchor={[0, 0.5]} align="left" position={[HEAP_HALF * 2 + C * 1.6, C * 1.1, 0]} glow={0.9} outline={0.55} delay={d} />
      <Undistort at={[runX + HEAP_HALF * 0.7, C * 0.4, 0]}>
        <Heap count={coinsFor(runGold, 18)} color="#b87a3a" emissive="#4a2406" seed={2} scale={0.8} />
      </Undistort>
      <RuneText
        text={`+${runGold}`}
        show={runGold > 0}
        px={RUN_PX}
        color={palette.runLoot}
        anchor={[0, 0.5]}
        align="left"
        position={[runX + HEAP_HALF * 1.5 + C, C * 1.0, 0]}
        glow={0.7}
        outline={0.55}
        delay={d * 1.2}
      />
    </HudAnchor>
  );
}

const tmpM = new Matrix4();
const tmpP = new Vector3();
const tmpQ = new Quaternion();
const tmpS = new Vector3();
const tmpE = new Euler();
/** Seconds a coin takes to drop onto the heap / wink out. */
const DROP = 0.38;
const VANISH = 0.25;

function Heap({ count, color, emissive, seed, scale = 1 }: { count: number; color: string; emissive: string; seed: number; scale?: number }) {
  const shown = useUiShow();
  const slots = useMemo<CoinSlot[]>(() => heapSlots(seed), [seed]);
  const mesh = useMemo(() => {
    coinGeo ??= new CylinderGeometry(1, 1, 0.17, 18);
    const m = new InstancedMesh(coinGeo, coinMaterial(color, emissive), HEAP_CAPACITY);
    m.frustumCulled = false;
    m.count = 0;
    return m;
  }, [color, emissive]);
  useEffect(
    () => () => {
      mesh.dispose();
    },
    [mesh],
  );
  // Per coin: when it lands (born) and when it goes (gone), uiNow seconds.
  const clock = useRef({ born: new Float32Array(HEAP_CAPACITY).fill(1e7), gone: new Float32Array(HEAP_CAPACITY).fill(-1e7), live: 0, settled: false, glint: 0 });
  const target = shown ? Math.min(count, HEAP_CAPACITY) : 0;

  useEffect(() => {
    const c = clock.current;
    const now = uiNow();
    // First appearance: the heap pours in after the flasks have arrived.
    const base = now + (c.live === 0 ? 0.35 : 0);
    if (target > c.live) {
      for (let i = c.live; i < target; i++) {
        c.born[i] = base + (i - c.live) * Math.min(0.07, 0.9 / Math.max(1, target - c.live));
        c.gone[i] = 1e7;
      }
    } else {
      for (let i = target; i < c.live; i++) c.gone[i] = now + (c.live - 1 - i) * 0.03;
    }
    c.live = target;
    c.settled = false;
  }, [target]);

  useFrame((_, dt) => {
    const c = clock.current;
    const now = uiNow();
    // A lazy glint now and then on a coin near the top.
    c.glint -= dt;
    if (c.glint <= 0 && c.live > 0 && shown) {
      c.glint = 2 + Math.random() * 3;
      const s = slots[Math.max(0, c.live - 1 - Math.floor(Math.random() * Math.min(4, c.live)))]!;
      tmpP.set(s.x * C * scale, s.y * C * scale + C * 0.1, s.z * C * scale);
      mesh.localToWorld(tmpP);
      emitUiSparks({ position: [tmpP.x, tmpP.y, tmpP.z], color: "#fff4c8", count: 2, speed: 0.01, up: 0.01, size: C * 0.35, spread: C * 0.2, ttl: 0.5 });
    }
    if (c.settled) return;
    let moving = false;
    let n = 0;
    for (let i = 0; i < HEAP_CAPACITY; i++) {
      const born = c.born[i]!;
      const gone = c.gone[i]!;
      if (now < born) {
        if (born < 1e6) moving = true; // still to fall
        continue;
      }
      if (now > gone + VANISH) continue;
      const s = slots[i]!;
      const raw = (now - born) / DROP;
      const p = Math.min(1, raw);
      const q = now > gone ? (now - gone) / VANISH : 0;
      if (p < 1 || q > 0) moving = true;
      // Fall with a little bounce, spinning flat as it lands.
      const fall = (1 - p) * (1 - p);
      const bounce = p < 1 ? Math.abs(Math.sin(p * Math.PI * 2.2)) * (1 - p) * 0.4 : 0;
      tmpP.set(s.x * C, (s.y + fall * 7 + bounce) * C + q * C * 1.5, s.z * C).multiplyScalar(scale);
      tmpE.set(s.rx + fall * 2.5, s.ry + fall * 4, s.rz + fall * 1.5);
      tmpQ.setFromEuler(tmpE);
      tmpS.setScalar(C * scale * Math.max(0.001, 1 - q * q) * (0.6 + 0.4 * Math.min(1, p * 3)));
      tmpM.compose(tmpP, tmpQ, tmpS);
      mesh.setMatrixAt(n, tmpM);
      n++;
      // The frame it lands: a chink of sparks.
      if (raw >= 1 && raw - dt / DROP < 1 && q === 0) {
        mesh.localToWorld(tmpP);
        emitUiSparks({ position: [tmpP.x, tmpP.y, tmpP.z], color: color, count: 2, speed: C * 4, up: C * 2, size: C * 0.25, spread: C, ttl: 0.4 });
      }
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
    if (!moving) c.settled = true;
  });

  // Tipped toward the eye so the heap shows its crown, not just its rim.
  return <primitive object={mesh} rotation={[0.45, 0, 0]} />;
}
