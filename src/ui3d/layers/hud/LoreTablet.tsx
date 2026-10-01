import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { Vector3, type Group } from "three";
import { gameEvents } from "../../../core/events";
import { getLoreFragment, type LoreFragment } from "../../../world/lore";
import { placeInFront } from "../../anchors";
import { getFace } from "../../font/faces";
import { KeyCap, keyCapWidth } from "../../KeyCap";
import { UiPresence } from "../../presence";
import { Tablet, TABLET_EXIT } from "../../Tablet";
import { fontPixel, measureText, RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { apx, fontPx } from "./ap";
import { Divider } from "./Divider";
import { hudUnit } from "./HudAnchor";

/** A carving, read: when you read a lore rune its words don't pop up in a
 * box — a tablet builds itself in the air ahead of you (the grimoire's
 * parchment panel: warm dark vellum-stone in a brass frame) and the
 * fragment writes itself onto it: its title in gold blackletter over a
 * brass flourish, the words in parchment, and a [C] codex key in the
 * corner. It lingers long enough to read at leisure (~9 s, or until you
 * read another), drifting lazily after your gaze, then breaks apart. The
 * world keeps moving underneath — reading on a shared floor is a risk,
 * like everything else down here. */

const D = 2.1;
const U = hudUnit(D);
const A = apx(D);
const LINGER = 9;
const W = 0.6 * U;
const PAD = 16 * A;
const TITLE_PX = fontPx(26, "title", D);
const BODY_PX = fontPx(14, "body", D);
const KEY_PX = fontPx(9, "label", D);
const HINT_PX = fontPx(8, "label", D);
/** The parchment panel's stone: warm and dark (artpass .wm-panel--parchment). */
const VELLUM = "#4a3a2c";

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

/** As many body columns as the face holds (layout wraps by its typical
 * advance). */
function bodyCols(): number {
  const face = getFace("body");
  return Math.floor((W - PAD * 2) / (face.avgAdvance * fontPixel(face, BODY_PX)));
}

function Carving({ fragment, shown }: { fragment: LoreFragment; shown: boolean }) {
  const group = useRef<Group>(null);
  const camera = useThree((s) => s.camera);
  const placed = useRef(false);
  const cols = bodyCols();
  const body = measureText(fragment.text, BODY_PX, cols, "body");
  const titleH = measureText(fragment.title, TITLE_PX, undefined, "title").height;
  const hintH = 14 * A;
  const H = PAD * 2 + titleH + 14 * A + body.height + 10 * A + hintH;

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
  const hintY = -H / 2 + PAD * 0.7 + hintH / 2;
  const codexW = measureText("CODEX", HINT_PX, undefined, "label").width;
  const capW = keyCapWidth("C", KEY_PX);
  const right = W / 2 - PAD * 0.8;
  return (
    <group ref={group}>
      <Tablet width={W} height={H} tile={0.16 * U} tint={VELLUM} frame="brass" frameTexel={2 * A} seed={11}>
        <RuneText text={fragment.title} font="title" px={TITLE_PX} color={ink.brassLight} position={[0, top - titleH / 2, 0]} glow={0.9} outline={0.5} />
        <Divider width={(W - PAD * 2) / A} unit={A} diamond delay={0.25} position={[0, top - titleH - 6 * A, 0]} />
        <RuneText
          text={fragment.text}
          font="body"
          px={BODY_PX}
          maxCols={cols}
          color={ink.parchment}
          anchor={[0.5, 0]}
          position={[0, top - titleH - 14 * A, 0]}
          glow={0.5}
          outline={0.5}
          delay={0.35}
        />
        <KeyCap k="C" px={KEY_PX} position={[right - codexW - 5 * A - capW / 2, hintY, 0.001]} />
        <RuneText text="CODEX" font="label" px={HINT_PX} color={ink.faded} anchor={[1, 0.5]} align="right" position={[right, hintY, 0]} glow={0.3} outline={0.5} delay={1.2} />
      </Tablet>
    </group>
  );
}
