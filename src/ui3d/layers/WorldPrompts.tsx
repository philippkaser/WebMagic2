import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState } from "react";
import { Group } from "three";
import { useGame } from "../../state/gameStore";
import { usePointerLocked } from "../../ui/hooks";
import { KeyCap, keyCapWidth } from "../KeyCap";
import { Plate } from "../Plate";
import { UiShow } from "../presence";
import { ink } from "../theme";
import { pxFor } from "../anchors";
import { CarriedAnchor } from "./hud/HudAnchor";
import type { TextSpan } from "../font/layout";
import { measureText, RuneText } from "../text/RuneText";

/** The interaction prompt, written where the thing is: "E — Plunder …"
 * hangs above the grave, "E — Descend" above the portal. Prompts without a
 * place (rare) hang low in front of you.
 *
 * Each prompt is a small grimoire plate: an arcane frame, the key as a
 * parchment key cap, the action in parchment (the hint uses an iron frame).
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

/** One piece of a prompt row: a key cap or a run of text. */
type Part = { key: string } | { text: TextSpan[] };

/** "E — Take Ember Staff (desc)" → [E] key cap, the verb in parchment, the
 * parenthetical dimmed (the grimoire prompt: `.wm-prompt`). */
export function promptParts(text: string): Part[] {
  const m = /^([A-Z])\s+—\s+(.*)$/.exec(text);
  if (!m) return [{ text: [{ text }] }];
  const [, key, rest] = m as unknown as [string, string, string];
  const paren = rest.indexOf("(");
  const spans: TextSpan[] =
    paren > 0 ? [{ text: rest.slice(0, paren) }, { text: rest.slice(paren), color: ink.parchmentDim }] : [{ text: rest }];
  return [{ key }, { text: spans }];
}

const HINT: Part[] = [
  { key: "Click" },
  { text: [{ text: "to take control" }] },
  { text: [{ text: "·", color: ink.faded }] },
  { key: "Tab" },
  { text: [{ text: "inventory" }] },
];
const HINT_TEXT = "\u0000hint";

/** Hint text width wraps past this many characters. */
const MAX_COLS = 40;

export function WorldPrompts() {
  const prompt = useGame((s) => s.prompt);
  const promptAt = useGame((s) => s.promptAt);
  const overlay = useGame((s) => s.overlay);
  const phase = useGame((s) => s.phase);
  const locked = usePointerLocked();
  const [entries, setEntries] = useState<Entry[]>([]);

  // The hint belongs to play only: menus (title, the Weighing, death) have
  // no pointer to take.
  const playing = phase === "village" || phase === "dungeon";
  const text = locked ? prompt : overlay === "none" && playing ? HINT_TEXT : null;
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
          <CarriedAnchor key={e.id} offset={[0, -0.42, -1.6]}>
            <UiShow show={e.shown}>
              <PromptPanel
                parts={e.text === HINT_TEXT ? HINT : promptParts(e.text)}
                px={pxFor(1.6, 0.018)}
                frame={e.text === HINT_TEXT ? "iron" : "arcane"}
                onHidden={() => setEntries((prev) => prev.filter((x) => x.id !== e.id))}
              />
            </UiShow>
          </CarriedAnchor>
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
      <UiShow show={entry.shown}>
        <PromptPanel parts={promptParts(entry.text)} px={pxFor(1.8, 0.017)} frame="arcane" onHidden={onHidden} />
      </UiShow>
    </group>
  );
}

/** A framed row of key caps and text, centred — built in place: the plate
 * forges its frame, the key caps settle, the words burn in. */
function PromptPanel({
  parts,
  px,
  frame,
  onHidden,
}: {
  parts: Part[];
  px: number;
  frame: string;
  onHidden: () => void;
}) {
  const gap = px * 4;
  const items = parts.map((p) =>
    "key" in p
      ? { part: p, w: keyCapWidth(p.key, px), h: measureText(p.key, px, undefined, "label").height + px * 6 }
      : (({ width, height }) => ({ part: p, w: width, h: height }))(measureText(p.text, px, MAX_COLS)),
  );
  const width = items.reduce((w, it) => w + it.w, 0) + gap * (items.length - 1);
  const height = items.reduce((h, it) => Math.max(h, it.h), 0);
  let x = -width / 2;
  const lastText = items.map((it) => "text" in it.part).lastIndexOf(true);
  return (
    <Plate width={width + px * 10} height={height + px * 6} frame={frame} texel={px * 1.1}>
      {items.map((it, i) => {
        const cx = x + it.w / 2;
        x += it.w + gap;
        return "key" in it.part ? (
          <KeyCap key={i} k={it.part.key} px={px} position={[cx, 0, 0]} />
        ) : (
          <RuneText
            key={i}
            text={it.part.text}
            px={px}
            maxCols={MAX_COLS}
            position={[cx, 0, 0]}
            glow={0.6}
            depth={-0.3}
            onHidden={i === lastText ? onHidden : undefined}
          />
        );
      })}
    </Plate>
  );
}
