import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { Vector3, type Group } from "three";
import { gameEvents } from "../../../core/events";
import { uiNow } from "../../clock";
import { Plate } from "../../Plate";
import { UiPresence, useUiShow } from "../../presence";
import { measureText, RuneText } from "../../text/RuneText";
import { emitUiSparks } from "../../UiSparks";
import { apx, fontPx, FRAME_TEXEL, plateSize } from "./ap";
import { bossTitle, HUD_COLORS } from "./copy";
import { useStepFade } from "./fade";
import { makeGauge, resetGauge, stepGauge } from "./gauge";
import { HudAnchor } from "./HudAnchor";
import { HUD_LAYOUT } from "./layout";
import { makeBarState, PixelBar, type BarState } from "./PixelBar";
import { PixelSprite } from "./PixelSprite";

/** A boss's life (artpass hud/BossBar): its name in blood-lit blackletter
 * between two skulls, over a long blood-framed panel holding a segmented
 * pixel bar. The frame forges itself across the top of your sight when the
 * boss wakes and the bar fills in from the left; every blow leaves a pale
 * chunk that holds a breath, then drains, and sheds embers from the
 * burning edge. When the boss falls (bossHp → null) the bar bursts into
 * embers along its length and the panel burns away.
 *
 * Driven only by the `bossHp` event, so it works the same whether we
 * simulate the boss or replicate it. */

const L = HUD_LAYOUT.boss;
const A = apx(L.distance);
/** Bar length in artpass pixels (artpass: min(52vw, 560px)). */
const BAR_W = 440;
const BAR_H = 12;
const NAME_PX = fontPx(24, "heading", L.distance);
const [PW, PH] = plateSize(BAR_W + 4, BAR_H + 4);

export function BossBar() {
  const [name, setName] = useState<string | null>(null);
  const frac = useRef(1);
  const lastName = useRef("");
  useEffect(
    () =>
      gameEvents.on("bossHp", (b) => {
        if (b) {
          frac.current = Math.max(0, Math.min(1, b.frac));
          setName(b.name);
        } else setName(null);
      }),
    [],
  );
  if (name) lastName.current = bossTitle(name);
  const nameW = measureText(lastName.current, NAME_PX, undefined, "heading").width / A;
  const outerH = PH + FRAME_TEXEL * 2;

  return (
    <UiPresence show={!!name} exit={1}>
      <HudAnchor h={L.h} v={L.v} inset={L.inset} distance={L.distance}>
        <RuneText text={lastName.current} font="heading" px={NAME_PX} color={HUD_COLORS.boss} position={[0, -14 * A, 0]} glow={1.3} outline={0.6} delay={0.3} />
        <PixelSprite name="skull" tint="#ffffff" texel={2 * A} position={[-(nameW / 2 + 22) * A, -14 * A, 0]} delay={0.2} />
        <PixelSprite name="skull" tint="#ffffff" texel={2 * A} position={[(nameW / 2 + 22) * A, -14 * A, 0]} delay={0.2} />
        <group position={[0, -(32 + outerH / 2) * A, 0]}>
          <Plate width={PW * A} height={PH * A} frame="blood" texel={FRAME_TEXEL * A} fillOpacity={0.94} forgeTime={0.55}>
            <Life frac={frac} />
          </Plate>
        </group>
      </HudAnchor>
    </UiPresence>
  );
}

const tmp = new Vector3();

function Life({ frac }: { frac: { current: number } }) {
  const show = useUiShow();
  const fade = useStepFade({ delay: 0.25, inTime: 0.2, steps: 3 });
  const reveal = useRef(0);
  const gauge = useRef(makeGauge(frac.current));
  const bar = useRef<BarState>(makeBarState(frac.current));
  const state = useRef({ last: frac.current, embers: 0, since: uiNow(), burst: false, hitAt: -10 });
  const group = useRef<Group>(null);

  useEffect(() => {
    if (show) {
      resetGauge(gauge.current, frac.current);
      state.current.since = uiNow();
      state.current.burst = false;
    }
  }, [show, frac]);

  useFrame((_, dt) => {
    const s = state.current;
    const b = bar.current;
    const now = uiNow();
    // The bar kindles left to right in sixteen steps once its frame stands.
    reveal.current = show ? Math.ceil(Math.min(1, Math.max(0, (now - s.since - 0.35) / 0.6)) * 16) / 16 : 1;
    stepGauge(gauge.current, frac.current, dt);
    b.level = gauge.current.level;
    b.ghost = gauge.current.ghost;
    const g = group.current;
    if (frac.current < s.last - 0.001) {
      s.embers = 0.35;
      s.hitAt = now;
    }
    s.last = frac.current;
    // A blow blanches the fill in three hard steps.
    const since = now - s.hitAt;
    b.flash = since < 0.25 ? Math.ceil((1 - since / 0.25) * 3) / 3 : 0;
    if (!g) return;
    // A blow sheds embers from the burning edge.
    if (s.embers > 0) {
      s.embers -= dt;
      tmp.set((-BAR_W / 2 + BAR_W * gauge.current.level) * A, 0, 0.004);
      g.localToWorld(tmp);
      emitUiSparks({ position: [tmp.x, tmp.y, tmp.z], color: "#ff8a3a", count: 3, speed: 0.12, up: 0.18, size: 0.012, spread: BAR_H * A, ttl: 0.9 });
    }
    // It falls: the whole bar bursts into embers.
    if (!show && !s.burst) {
      s.burst = true;
      for (let i = 0; i < 12; i++) {
        tmp.set((-BAR_W / 2 + (BAR_W * (i + 0.5)) / 12) * A, 0, 0.004);
        g.localToWorld(tmp);
        emitUiSparks({ position: [tmp.x, tmp.y, tmp.z], color: i % 2 ? "#ff8a3a" : "#ff5136", count: 5, speed: 0.15, up: 0.2, size: 0.012, spread: BAR_H * A, ttl: 1 });
      }
    }
  });

  return (
    <group ref={group}>
      <PixelBar width={BAR_W} height={BAR_H} unit={A} fill={HUD_COLORS.bossFill} segments={20} state={bar} showRef={fade} revealRef={reveal} position={[0, 0, 0.001]} />
    </group>
  );
}
