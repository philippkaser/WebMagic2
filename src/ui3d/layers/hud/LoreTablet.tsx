import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { Vector3, type Group } from "three";
import { gameEvents } from "../../../core/events";
import { palette } from "../../../ui/theme";
import { getLoreFragment, type LoreFragment } from "../../../world/lore";
import { placeInFront, pxFor } from "../../anchors";
import { ADVANCE } from "../../font/glyphs";
import { UiPresence } from "../../presence";
import { Tablet, TABLET_EXIT } from "../../Tablet";
import { measureText, RuneText } from "../../text/RuneText";
import { HUD_COLORS } from "./copy";
import { hudUnit } from "./HudAnchor";

/** A carving, read: when you read a lore rune its words don't pop up in a
 * box — a stone tablet builds itself in the air ahead of you and the
 * fragment writes itself onto it, carved, with its kind of writing above
 * in violet and a faint "C — codex" in the corner. It lingers long enough
 * to read at leisure (~9 s, or until you read another), drifting lazily
 * after your gaze, then breaks apart. The world keeps moving underneath —
 * reading on a shared floor is a risk, like everything else down here. */

const D = 2.1;
const U = hudUnit(D);
const LINGER = 9;
const W = 0.6 * U;
const PAD = 0.028 * U;
const TITLE_PX = pxFor(D, 0.016);
const BODY_PX = pxFor(D, 0.017);
const HINT_PX = pxFor(D, 0.014);
/** As many columns as the carved face holds (a glyph advances 6 font px). */
const COLS = Math.floor((W - PAD * 2) / (BODY_PX * ADVANCE));

interface Reading {
  id: number;
  fragment: LoreFragment;
  shown: boolean;
}

let nextId = 1;

export function LoreTablet() {
  const [readings, setReadings] = useState<Reading[]>([]);

  useEffect(
    () =>
      gameEvents.on("loreRead", ({ fragmentId }) => {
        let fragment: LoreFragment;
        try {
          fragment = getLoreFragment(fragmentId);
        } catch {
          return; // a retired fragment: nothing to show
        }
        const id = nextId++;
        // Another reading replaces this one: the old tablet breaks as the
        // new one builds.
        setReadings((prev) => [...prev.map((r) => (r.shown ? { ...r, shown: false } : r)), { id, fragment, shown: true }]);
        setTimeout(() => setReadings((prev) => prev.map((r) => (r.id === id ? { ...r, shown: false } : r))), LINGER * 1000);
      }),
    [],
  );

  // Let broken tablets go once they've finished falling.
  const fading = readings.filter((r) => !r.shown).map((r) => r.id).join(",");
  useEffect(() => {
    if (!fading) return;
    const ids = new Set(fading.split(",").map(Number));
    const timer = setTimeout(() => setReadings((prev) => prev.filter((r) => r.shown || !ids.has(r.id))), TABLET_EXIT * 1000 + 100);
    return () => clearTimeout(timer);
  }, [fading]);

  return (
    <>
      {readings.map((r) => (
        <UiPresence key={r.id} show={r.shown} exit={TABLET_EXIT}>
          <Carving fragment={r.fragment} shown={r.shown} />
        </UiPresence>
      ))}
    </>
  );
}

const target = new Vector3();

function Carving({ fragment, shown }: { fragment: LoreFragment; shown: boolean }) {
  const group = useRef<Group>(null);
  const camera = useThree((s) => s.camera);
  const placed = useRef(false);
  const body = measureText(fragment.text, BODY_PX, COLS);
  const titleH = TITLE_PX * 8;
  const hintH = HINT_PX * 8;
  const H = PAD * 2 + titleH + PAD * 0.55 + body.height + PAD * 0.5 + hintH;

  useFrame((_, rawDt) => {
    const g = group.current;
    if (!g) return;
    const dt = Math.min(rawDt, 0.1);
    // Above the aim, its lower edge just clear of the crosshair.
    placeInFront(camera, D, [0, H / 2 + 0.035 * U], target);
    if (!placed.current) {
      g.position.copy(target);
      g.quaternion.copy(camera.quaternion);
      placed.current = true;
      return;
    }
    // Lazy: you can glance away and it waits; turn away and it drifts after.
    if (shown) g.position.lerp(target, 1 - Math.exp(-dt * 1.3));
    g.quaternion.slerp(camera.quaternion, 1 - Math.exp(-dt * 2.2));
  });

  const top = H / 2 - PAD;
  return (
    <group ref={group}>
      <Tablet width={W} height={H} tile={0.1 * U} tint="#4a4458" accent={HUD_COLORS.lore} seed={11}>
        <RuneText text={fragment.title.toUpperCase()} px={TITLE_PX} color={HUD_COLORS.lore} position={[0, top - titleH / 2, 0]} glow={1.1} />
        <RuneText
          text={fragment.text}
          px={BODY_PX}
          maxCols={COLS}
          color={palette.bright}
          anchor={[0.5, 0]}
          position={[0, top - titleH - PAD * 0.55, 0]}
          glow={0.7}
          delay={0.35}
        />
        <RuneText text="C — codex" px={HINT_PX} color={palette.dusk} anchor={[1, 1]} align="right" position={[W / 2 - PAD * 0.8, -H / 2 + PAD * 0.6 + hintH, 0]} glow={0.4} delay={1.2} />
      </Tablet>
    </group>
  );
}
