import { useEffect, useState } from "react";
import { gameEvents } from "../../../core/events";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { Plate } from "../../Plate";
import { UiShow } from "../../presence";
import { measureText, RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { ALTAR, SCENE_DISTANCE } from "./layout";

/** What the game says while the altar is up — "Sold … for 26 gold", "A
 * wizard never drops their staff" — written in the band of air above the
 * tablets. The world's own message layer hangs its words further off, where
 * the tablets would hide them; here they stay in view, newest at the bottom,
 * each on a small iron-framed plate (the grimoire's message), burning away
 * after a few seconds. */

const MAX = 2;
const PX = pxFor(SCENE_DISTANCE, 0.019);
const MAX_COLS = 60;
const LINE = PX * 15;

interface Line {
  id: number;
  text: string;
  shown: boolean;
  until: number;
}

let nextId = 1;

export function AltarVoice({ sceneY }: { sceneY: number }) {
  const [lines, setLines] = useState<Line[]>([]);

  useEffect(
    () =>
      gameEvents.on("message", (text) => {
        setLines((prev) => {
          const next = [...prev, { id: nextId++, text, shown: true, until: uiNow() + 3.2 + text.length * 0.03 }];
          let live = next.filter((l) => l.shown).length;
          return next.map((l) => (live > MAX && l.shown ? (live--, { ...l, shown: false }) : l));
        });
      }),
    [],
  );

  // One slow tick retires whatever is due (only while something shows).
  const any = lines.some((l) => l.shown);
  useEffect(() => {
    if (!any) return;
    const timer = setInterval(() => {
      const now = uiNow();
      setLines((prev) => (prev.some((l) => l.shown && l.until <= now) ? prev.map((l) => (l.shown && l.until <= now ? { ...l, shown: false } : l)) : prev));
    }, 200);
    return () => clearInterval(timer);
  }, [any]);

  const live = lines.filter((l) => l.shown);
  const base = sceneY + ALTAR.height / 2 + 0.07;
  return (
    <>
      {lines.map((l) => {
        const slot = l.shown ? live.length - 1 - live.indexOf(l) : 0;
        const size = measureText(l.text, PX, MAX_COLS);
        return (
          <group key={l.id} position={[0, base + slot * LINE + (size.height + PX * 6) / 2, 0.02]}>
            <UiShow show={l.shown}>
              <Plate width={size.width + PX * 10} height={size.height + PX * 6} frame={/sold|bought/i.test(l.text) ? "gold" : "iron"} texel={PX * 1.1} fillOpacity={0.86}>
                <RuneText
                  text={l.text}
                  px={PX}
                  maxCols={MAX_COLS}
                  color={ink.parchment}
                  glow={0.7}
                  depth={-0.3}
                  onHidden={() => setLines((prev) => prev.filter((x) => x.id !== l.id))}
                />
              </Plate>
            </UiShow>
          </group>
        );
      })}
    </>
  );
}
