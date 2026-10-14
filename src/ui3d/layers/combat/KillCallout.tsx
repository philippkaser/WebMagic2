import { useEffect, useState } from "react";
import { gameEvents } from "../../../core/events";
import { RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { apx, fontPx } from "../hud/ap";

/** A streak's rune word — DOUBLE, TRIPLE, RAMPAGE, MASSACRE, CATACLYSM —
 * burning itself into the air just under the aim, holding a breath and
 * burning away (combat/momentum decides when; only kills the host credits
 * to you count). Rare, so a fresh RuneText per word is fine: its own
 * materialize and dissolve are the animation.
 *
 * Mounted inside the crosshair's anchor, so it rides the aim rigidly and
 * leaves with the rest of the HUD. */

/** Ink by chain length: brass for a double, hotter as it climbs. */
function inkFor(multi: number): string {
  if (multi >= 9) return ink.violet;
  if (multi >= 6) return "#ff4a3a";
  if (multi >= 4) return "#ff9a3d";
  return ink.gold;
}

/** How long a word holds before it burns away (s). */
const HOLD_MS = 950;

let nextId = 1;

export function KillCallout({ distance }: { distance: number }) {
  const [word, setWord] = useState<{ id: number; text: string; multi: number } | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(
    () =>
      gameEvents.on("multiKill", ({ multi, word: text }) => {
        setWord({ id: nextId++, text, multi });
        setShown(true);
      }),
    [],
  );

  useEffect(() => {
    if (!word) return;
    const t = setTimeout(() => setShown(false), HOLD_MS);
    return () => clearTimeout(t);
  }, [word]);

  if (!word) return null;
  const big = word.multi >= 6;
  return (
    <RuneText
      key={word.id}
      text={word.text}
      font="heading"
      px={fontPx(big ? 30 : 24, "heading", distance)}
      color={inkFor(word.multi)}
      glow={big ? 1.8 : 1.3}
      outline={0.7}
      inDuration={0.18}
      outDuration={0.35}
      stagger={0.12}
      show={shown}
      position={[0, -apx(distance) * 30, 0]}
      onHidden={() => setWord((w) => (w?.id === word.id ? null : w))}
      renderOrder={61}
    />
  );
}
