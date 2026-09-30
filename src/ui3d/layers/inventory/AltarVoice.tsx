import { useEffect, useState } from "react";
import { gameEvents } from "../../../core/events";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { RuneText } from "../../text/RuneText";
import { INK } from "./materials";
import { ALTAR, SCENE_DISTANCE } from "./layout";

/** What the game says while the altar is up — "Sold … for 26 gold", "A
 * wizard never drops their staff" — written in the band of air above the
 * tablets. The world's own message layer hangs its words further off, where
 * the tablets would hide them; here they stay in view, newest at the bottom,
 * each burning away after a few seconds. */

const MAX = 2;
const PX = pxFor(SCENE_DISTANCE, 0.02);
const LINE = PX * 13;

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
        return (
          <RuneText
            key={l.id}
            text={l.text}
            px={PX}
            maxCols={60}
            color={INK.bright}
            glow={0.9}
            show={l.shown}
            anchor={[0.5, 1]}
            position={[0, base + slot * LINE, 0.02]}
            onHidden={() => setLines((prev) => prev.filter((x) => x.id !== l.id))}
          />
        );
      })}
    </>
  );
}
