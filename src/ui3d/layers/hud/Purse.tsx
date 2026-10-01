import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { CylinderGeometry, Euler, InstancedMesh, Matrix4, MeshStandardMaterial, Quaternion, Vector3 } from "three";
import { useGame } from "../../../state/gameStore";
import { uiNow } from "../../clock";
import { Plate } from "../../Plate";
import { useUiShow } from "../../presence";
import { measureText, RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { emitUiSparks } from "../../UiSparks";
import { apx, fontPx, FRAME_TEXEL, plateSize } from "./ap";
import { coinsFor } from "./copy";
import { HEAP_CAPACITY, heapSlots, type CoinSlot } from "./heap";
import { HudAnchor, Undistort } from "./HudAnchor";
import { HUD_LAYOUT, PURSE_H } from "./layout";
import { useEntryDelay } from "./useSettled";

/** The purse, as what it is: a little heap of coins in a small iron-framed
 * panel above the vitals, growing as you get richer (one coin per doubling,
 * roughly), the count beside it in gold. The gold gathered this run — lost
 * if you die — is a second, duller copper heap with its own "+N" in brass,
 * kept apart because it isn't yours yet.
 *
 * The coins are chunky eight-sided pixel coins, flat-shaded: new ones drop
 * onto the heap and settle with a chink of sparks, spent ones wink out. The
 * counters' changed digits re-write themselves (RuneText). */

const L = HUD_LAYOUT.purse;
const A = apx(L.distance);
/** Coin radius: 3 artpass pixels. */
const C = 3 * A;
const PX = fontPx(13, "body", L.distance);
const RUN_PX = fontPx(11, "body", L.distance);

let coinGeo: CylinderGeometry | null = null;
const coinMats = new Map<string, MeshStandardMaterial>();
function coinMaterial(color: string, emissive: string): MeshStandardMaterial {
  let m = coinMats.get(color);
  if (!m) {
    // Not fully metallic: with no environment to reflect, a true metal reads
    // black between highlights. A warm self-glow keeps it gold in the dark;
    // flat shading keeps every facet a hard-edged chunk of colour.
    m = new MeshStandardMaterial({ color, metalness: 0.4, roughness: 0.45, emissive, emissiveIntensity: 0.7, flatShading: true });
    coinMats.set(color, m);
  }
  return m;
}

export function Purse() {
  const gold = useGame((s) => s.gold);
  const runGold = useGame((s) => s.runGold);
  const goldText = `${gold}`;
  const d = useEntryDelay(0.4);
  // Layout in artpass pixels: heap 26, gap 6, gold, gap 10, heap 20, gap 4, +run.
  const goldW = measureText(goldText, PX, undefined, "body").width / A;
  const runText = `+${runGold}`;
  const runW = runGold > 0 ? measureText(runText, RUN_PX, undefined, "body").width / A : 0;
  const contentW = 26 + 6 + goldW + (runGold > 0 ? 10 + 20 + 4 + runW : 0);
  const [pw, ph] = plateSize(contentW + 16, PURSE_H);
  const outerW = pw + FRAME_TEXEL * 2;
  const outerH = ph + FRAME_TEXEL * 2;
  const x0 = -contentW / 2;
  const runX = x0 + 26 + 6 + goldW + 10;
  return (
    <HudAnchor h={L.h} v={L.v} inset={L.inset} distance={L.distance}>
      <group position={[(outerW / 2) * A, (outerH / 2) * A, 0]}>
        <Plate width={pw * A} height={ph * A} frame="iron" texel={FRAME_TEXEL * A} fillOpacity={0.94}>
          <Undistort at={[(x0 + 13) * A, -5 * A, 0.01]}>
            <Heap count={coinsFor(gold)} color={ink.gold} emissive="#6a4308" seed={1} />
          </Undistort>
          <RuneText text={goldText} font="body" px={PX} color={ink.gold} anchor={[0, 0.5]} align="left" position={[(x0 + 32) * A, 0, 0]} glow={0.3} outline={0.6} delay={d} />
          <Undistort at={[(runX + 10) * A, -5 * A, 0.01]}>
            <Heap count={coinsFor(runGold, 18)} color="#b87a3a" emissive="#4a2406" seed={2} scale={0.8} />
          </Undistort>
          <RuneText
            text={runText}
            show={runGold > 0}
            font="body"
            px={RUN_PX}
            color={ink.brass}
            anchor={[0, 0.5]}
            align="left"
            position={[(runX + 24) * A, 0, 0]}
            glow={0.25}
            outline={0.6}
            delay={d * 1.2}
          />
        </Plate>
      </group>
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
    coinGeo ??= new CylinderGeometry(1, 1, 0.3, 8);
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
