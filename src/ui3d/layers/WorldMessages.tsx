import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { Group, Vector3 } from "three";
import { playRuneWrite } from "../../audio/uiSounds";
import { gameEvents } from "../../core/events";
import { placeInFront, pxFor } from "../anchors";
import { uiNow } from "../clock";
import { RuneText } from "../text/RuneText";

/** The message feed, in the air: every `message` event burns itself into the
 * space ahead of you, hangs there, and burns away.
 *
 * A message appears where you're looking, then drifts lazily after your
 * gaze — you can turn away and it trails into view again, like smoke
 * following a draught, never glued to the screen. Newer messages push the
 * older ones up. */

const DISTANCE = 2.4;
const MAX_VISIBLE = 4;
/** Screen-height fraction of a glyph. */
const SIZE = 0.021;
const LINE_GAP = 0.2; // metres between stacked messages

interface Entry {
  id: number;
  text: string;
  shown: boolean;
  /** uiNow() at which it starts to dissolve. */
  expires: number;
}

let nextId = 1;

export function WorldMessages() {
  const [entries, setEntries] = useState<Entry[]>([]);

  useEffect(
    () =>
      gameEvents.on("message", (text) => {
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

  const shown = entries.filter((e) => e.shown);
  return (
    <>
      {entries.map((e) => (
        <Message
          key={e.id}
          text={e.text}
          shown={e.shown}
          // Newest at the bottom (slot 0); dissolving ones keep their place.
          slot={e.shown ? shown.length - 1 - shown.indexOf(e) : -1}
          onHidden={() => setEntries((prev) => prev.filter((x) => x.id !== e.id))}
        />
      ))}
    </>
  );
}

const target = new Vector3();

function Message({ text, shown, slot, onHidden }: { text: string; shown: boolean; slot: number; onHidden: () => void }) {
  const group = useRef<Group>(null);
  const camera = useThree((s) => s.camera);
  const placed = useRef(false);
  const lastSlot = useRef(Math.max(0, slot));
  if (slot >= 0) lastSlot.current = slot;

  useFrame((_, dt) => {
    const g = group.current;
    if (!g) return;
    placeInFront(camera, DISTANCE, [0, 0.38 + lastSlot.current * LINE_GAP], target);
    if (!placed.current) {
      g.position.copy(target);
      placed.current = true;
    } else if (shown) {
      // Lazy follow: catches up over ~half a second.
      g.position.lerp(target, 1 - Math.exp(-dt * 3.2));
    }
    g.quaternion.slerp(camera.quaternion, placed.current ? 1 - Math.exp(-dt * 6) : 1);
  });

  return (
    <group ref={group}>
      <RuneText
        text={text}
        px={pxFor(DISTANCE, SIZE)}
        maxCols={46}
        color="#e9dfc6"
        glow={0.9}
        show={shown}
        onHidden={onHidden}
      />
    </group>
  );
}
