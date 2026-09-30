import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { Group } from "three";
import { useGame } from "../../state/gameStore";
import { usePointerLocked } from "../../ui/hooks";
import { palette } from "../../ui/theme";
import { ViewAnchor, pxFor } from "../anchors";
import type { TextSpan } from "../font/layout";
import { RuneText } from "../text/RuneText";

/** The interaction prompt, written where the thing is: "E — Plunder …"
 * hangs above the grave, "E — Descend" above the portal. Prompts without a
 * place (rare) hang low in front of you.
 *
 * Changing prompts don't swap — the old one burns away while the new one
 * writes itself. While the pointer is free (and no screen is open) the
 * "click to take control" hint takes the prompt's place. */

type Anchor = readonly [number, number, number] | null;

interface Entry {
  id: number;
  text: string;
  at: Anchor;
  shown: boolean;
}

let nextId = 1;

/** "E — Take Ember Staff (desc)" → the key cap in accent, the verb bright,
 * the parenthetical dim. */
export function promptSpans(text: string): TextSpan[] {
  const m = /^([A-Z])\s+—\s+(.*)$/.exec(text);
  if (!m) return [{ text }];
  const [, key, rest] = m as unknown as [string, string, string];
  const paren = rest.indexOf("(");
  const spans: TextSpan[] = [{ text: `${key} `, color: palette.accent }];
  if (paren > 0) {
    spans.push({ text: rest.slice(0, paren) });
    spans.push({ text: rest.slice(paren), color: palette.dim });
  } else spans.push({ text: rest });
  return spans;
}

export function WorldPrompts() {
  const prompt = useGame((s) => s.prompt);
  const promptAt = useGame((s) => s.promptAt);
  const overlay = useGame((s) => s.overlay);
  const locked = usePointerLocked();
  const [entries, setEntries] = useState<Entry[]>([]);

  const text = locked ? prompt : overlay === "none" ? "Click to take control — WASD move · Space jump · Mouse casts" : null;
  const at: Anchor = locked ? promptAt : null;
  const key = text ? `${text}@${at ? at.map((v) => v.toFixed(1)).join(",") : "view"}` : null;

  useEffect(() => {
    setEntries((prev) => {
      const current = prev.find((e) => e.shown);
      const currentKey = current ? `${current.text}@${current.at ? current.at.map((v) => v.toFixed(1)).join(",") : "view"}` : null;
      if (currentKey === key) return prev;
      // Same text, anchor merely drifted (a bobbing orb): move, don't rewrite.
      if (current && text && current.text === text && current.at && at) {
        return prev.map((e) => (e === current ? { ...e, at } : e));
      }
      const faded = prev.map((e) => (e.shown ? { ...e, shown: false } : e));
      return text ? [...faded, { id: nextId++, text, at, shown: true }] : faded;
    });
  }, [key, text, at]);

  return (
    <>
      {entries.map((e) =>
        e.at ? (
          <AnchoredPrompt
            key={e.id}
            entry={e}
            onHidden={() => setEntries((prev) => prev.filter((x) => x.id !== e.id))}
          />
        ) : (
          <ViewAnchor key={e.id} offset={[0, -0.42, -1.6]}>
            <RuneText
              text={promptSpans(e.text)}
              px={pxFor(1.6, 0.02)}
              show={e.shown}
              glow={0.8}
              onHidden={() => setEntries((prev) => prev.filter((x) => x.id !== e.id))}
            />
          </ViewAnchor>
        ),
      )}
    </>
  );
}

/** A prompt pinned to a world point, facing you, keeping roughly the same
 * size on screen from arm's length to a few metres away. */
function AnchoredPrompt({ entry, onHidden }: { entry: Entry; onHidden: () => void }) {
  const group = useRef<Group>(null);
  const camera = useThree((s) => s.camera);
  useFrame(() => {
    const g = group.current;
    if (!g || !entry.at) return;
    g.position.set(entry.at[0], entry.at[1], entry.at[2]);
    g.quaternion.copy(camera.quaternion);
    const d = camera.position.distanceTo(g.position);
    g.scale.setScalar(Math.min(1.8, Math.max(0.6, d / 1.8)));
  });
  return (
    <group ref={group}>
      <RuneText text={promptSpans(entry.text)} px={pxFor(1.8, 0.019)} maxCols={40} show={entry.shown} glow={0.9} onHidden={onHidden} />
    </group>
  );
}
