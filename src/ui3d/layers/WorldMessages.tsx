import { useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import type { Group } from "three";
import { playRuneWrite } from "../../audio/uiSounds";
import { gameEvents } from "../../core/events";
import { uiNow } from "../clock";
import { useGame } from "../../state/gameStore";
import { isInventoryMode } from "./inventory/layout";
import { Plate } from "../Plate";
import { UiShow } from "../presence";
import { measureText, RuneText } from "../text/RuneText";
import { ink } from "../theme";
import { apx, fontPx, FRAME_TEXEL } from "./hud/ap";
import { HudAnchor } from "./hud/HudAnchor";
import { HUD_LAYOUT } from "./hud/layout";

/** The message feed: every `message` event burns itself onto a small
 * framed plate carried at the left edge of your view, under the location
 * panel — on the same rig as the rest of the HUD, so it sways with your
 * stride but never hangs in the room where you could walk into it.
 *
 * The newest message writes itself at the top and pushes the older ones
 * down; each hangs a few breaths (longer for longer lines) and burns away,
 * and the ones below slide up to close the gap. Omens, triumphs and pacts
 * are told apart by the plate's frame and the ink (`toneOf`). */

const L = HUD_LAYOUT.feed;
const A = apx(L.distance);
const PX = fontPx(13, "body", L.distance);
const MAX_VISIBLE = 4;
const MAX_COLS = 44;
/** Plate padding and the gap between plates, artpass pixels. */
const PAD_X = 6;
const PAD_Y = 4;
const GAP = 4;

interface Entry {
  id: number;
  text: string;
  shown: boolean;
  /** uiNow() at which it starts to dissolve. */
  expires: number;
}

let nextId = 1;

/** Outer size of a message's plate, world units. */
function plateOf(text: string): { w: number; h: number; text: { width: number; height: number } } {
  const size = measureText(text, PX, MAX_COLS, "body");
  return { w: size.width + (PAD_X * 2 + FRAME_TEXEL * 6) * A, h: size.height + (PAD_Y * 2 + FRAME_TEXEL * 6) * A, text: size };
}

export function WorldMessages() {
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(
    () =>
      gameEvents.on("message", (text) => {
        // With the altar open, its own voice writes the message above it.
        if (isInventoryMode(useGame.getState().overlay)) return;
        playRuneWrite();
        setEntries((prev) => {
          const next = [...prev, { id: nextId++, text, shown: true, expires: uiNow() + 4.2 + text.length * 0.035 }];
          // Too many? The oldest still-shown one lets go early.
          let visible = next.filter((e) => e.shown).length;
          return next.map((e) => {
            if (visible > MAX_VISIBLE && e.shown) {
              visible--;
              return { ...e, shown: false };
            }
            return e;
          });
        });
      }),
    [],
  );

  // One slow tick expires whatever is due (only while something is shown).
  const anyShown = entries.some((e) => e.shown);
  useEffect(() => {
    if (!anyShown) return;
    const timer = setInterval(() => {
      const now = uiNow();
      setEntries((prev) =>
        prev.some((e) => e.shown && e.expires <= now)
          ? prev.map((e) => (e.shown && e.expires <= now ? { ...e, shown: false } : e))
          : prev,
      );
    }, 200);
    return () => clearInterval(timer);
  }, [anyShown]);

  // Newest on top: walk the shown ones from newest to oldest, stacking down.
  const tops = new Map<number, number>();
  let y = 0;
  for (let i = entries.length - 1; i >= 0; i--) {
    const e = entries[i]!;
    if (!e.shown) continue;
    tops.set(e.id, y);
    y += plateOf(e.text).h + GAP * A;
  }

  return (
    <HudAnchor h={L.h} v={L.v} inset={L.inset} distance={L.distance}>
      {entries.map((e) => (
        <Message
          key={e.id}
          text={e.text}
          shown={e.shown}
          top={tops.get(e.id)}
          onHidden={() => setEntries((prev) => prev.filter((x) => x.id !== e.id))}
        />
      ))}
    </HudAnchor>
  );
}

function Message({ text, shown, top, onHidden }: { text: string; shown: boolean; top: number | undefined; onHidden: () => void }) {
  const group = useRef<Group>(null);
  // A dissolving message keeps the place it had.
  const lastTop = useRef(top ?? 0);
  if (top !== undefined) lastTop.current = top;
  const placed = useRef(false);
  const plate = plateOf(text);

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    const target = -lastTop.current - plate.h / 2;
    if (!placed.current) {
      g.position.y = target;
      placed.current = true;
    } else {
      g.position.y += (target - g.position.y) * (1 - Math.exp(-Math.min(dt, 0.1) * 9));
    }
  });

  const tone = TONES[toneOf(text)];
  return (
    <group ref={group} position={[plate.w / 2, 0, 0]}>
      <UiShow show={shown}>
        <Plate width={plate.w - FRAME_TEXEL * 2 * A} height={plate.h - FRAME_TEXEL * 2 * A} frame={tone.frame} texel={FRAME_TEXEL * A} fillOpacity={0.9}>
          <RuneText text={text} px={PX} maxCols={MAX_COLS} align="left" color={tone.ink} glow={0.5} outline={0.6} depth={-0.3} onHidden={onHidden} />
        </Plate>
      </UiShow>
    </group>
  );
}

type Tone = "plain" | "omen" | "good" | "ally";

/** Messages arrive as plain strings from everywhere; their tone is read
 * from what they say, so omens and triumphs stand out at a glance (after
 * the grimoire feed's colouring). */
export function toneOf(text: string): Tone {
  if (/not alone|presence|stranger|slain|slew|fallen|grave|broken|oathbreak|warden/i.test(text)) return "omen";
  if (/pact|sworn|ally/i.test(text)) return "ally";
  if (/home|banked|endured|equipped|treasure|way home|feather/i.test(text)) return "good";
  return "plain";
}

const TONES: Record<Tone, { frame: string; ink: string }> = {
  plain: { frame: "iron", ink: ink.parchment },
  omen: { frame: "violet", ink: "#e3cfff" },
  good: { frame: "gold", ink: "#ffe9b0" },
  ally: { frame: ink.ally, ink: "#cff5d6" },
};
