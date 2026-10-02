import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { Group, Vector3 } from "three";
import { resolveItem, type ResolvedItem } from "../../../items/catalog";
import { GAMBLE_PRICE, merchantPrice } from "../../../items/economy";
import { readSlot } from "../../../items/inventory";
import { useGame } from "../../../state/gameStore";
import { pxFor } from "../../anchors";
import type { FontId } from "../../font/faces";
import type { TextInput } from "../../font/layout";
import { slabGeometry, slabMaterial } from "../../slab";
import { UiShow, useUiShow } from "../../presence";
import { UiTextStyleProvider } from "../../style";
import { measureText, RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { sellOffer } from "./dropTarget";
import { carriedNow, useInventory, useInventoryVersion, type InventoryInteraction } from "./interaction";
import { GAMBLE_WARE, placePlaque, SCENE_DISTANCE, slotKey, TEXT, viewHalfExtent } from "./layout";
import { flat, plane } from "./materials";
import { fortuneText, plaqueText, quickHint, wornCounterpart, type PlaqueText } from "./plaqueText";
import { PixelSprite, spriteSize, type SpriteName } from "./sprites";

/** The plaque that reads an item to you — artpass's parchment tooltip as a
 * thin card hanging in the air: hover anything and it unfolds beside it (off
 * the tablet's edge where there's room) in hard steps, framed in brass (gold
 * for the legendary), and its sections write themselves on: the name in its
 * grade's colour, the gem and small-caps grade line, what it is, its stats
 * with ▲/▼ against what you wear, a rule, and the footnotes. Moving to the
 * next socket re-writes only what differs; moving away burns the words off
 * and folds it away.
 *
 * It hangs a little in front of the tablets (PLAQUE_Z), so it's never
 * clipped by a tablet turned toward you; its text is sized for that nearer
 * distance so it stays the planned share of the screen. */

const PLAQUE_Z = 0.24;
const DIST = SCENE_DISTANCE - PLAQUE_Z;
const NAME_PX = pxFor(DIST, TEXT.plaqueName);
const LINE_PX = pxFor(DIST, TEXT.plaqueLine);
const SMALL_PX = pxFor(DIST, TEXT.label);
const MAX_COLS = 44;
const PAD = 0.036;
const TEXEL = 0.004;
const UNFOLD_STEPS = 5;

const tmpA = new Vector3();

interface Reading {
  key: string;
  text: PlaqueText;
}

/** What the plaque should say about a socket right now (null: nothing). */
function readSocket(ix: InventoryInteraction, key: string | null): Reading | null {
  if (!key) return null;
  const entry = ix.sockets.get(key);
  if (!entry) return null;
  const state = useGame.getState();
  const spec = entry.spec;
  if (spec.ware) {
    if (spec.ware === GAMBLE_WARE) return { key, text: fortuneText(GAMBLE_PRICE, state.gold >= GAMBLE_PRICE) };
    const price = merchantPrice(spec.ware) ?? 0;
    return { key, text: plaqueText(resolveItem(spec.ware), null, { price: { gold: price, affordable: state.gold >= price } }) };
  }
  if (!spec.ref) return null;
  const inv = carriedNow();
  const stack = readSlot(inv, spec.ref);
  if (!stack) return null;
  const item = resolveItem(stack.defId);
  const readingWorn = spec.ref.container === "equipment";
  let worn: ResolvedItem | null = null;
  if (item.def.slot !== "consumable") {
    const w = inv.equipment[item.def.slot];
    worn = wornCounterpart(item, w ? resolveItem(w.defId) : null, readingWorn);
  }
  const inVillage = state.phase === "village";
  const selling = ix.mode === "merchant" && inVillage;
  return {
    key,
    text: plaqueText(item, worn, {
      qty: stack.qty,
      runLoot: stack.runLoot,
      worn: readingWorn,
      sellFor: selling ? sellOffer(inv, spec.ref) : null,
      hint: quickHint(spec.ref, item.def.slot === "consumable", ix.mode === "chest" && inVillage),
    }),
  };
}

// ── Layout: the tooltip's sections stacked top-down ─────────────────────────

interface TextRow {
  kind: "text";
  text: TextInput;
  font: FontId;
  px: number;
  maxCols?: number;
  color?: string;
  /** Left inset (an icon before it), and its top, from the card's top-left. */
  x: number;
  y: number;
  icon?: { name: SpriteName; tint: string; px: number };
}
interface RuleRow {
  kind: "rule";
  y: number;
}
type Row = TextRow | RuleRow;

function layoutPlaque(t: PlaqueText): { rows: Row[]; w: number; h: number } {
  const rows: Row[] = [];
  let y = 0;
  let w = 0.36;
  const add = (text: TextInput, font: FontId, px: number, gap: number, opts: { maxCols?: number; color?: string; icon?: TextRow["icon"] } = {}) => {
    const m = measureText(text, px, opts.maxCols, font);
    const x = opts.icon ? spriteSize(opts.icon.name).w * opts.icon.px + px * 3 : 0;
    y += rows.length ? gap : 0;
    rows.push({ kind: "text", text, font, px, maxCols: opts.maxCols, color: opts.color, x, y, icon: opts.icon });
    w = Math.max(w, x + m.width);
    y += m.height;
  };
  add(t.title, "heading", NAME_PX, 0, { maxCols: MAX_COLS - 6 });
  add(t.sub, "label", SMALL_PX, SMALL_PX * 4, { icon: { name: "gem", tint: t.gem, px: SMALL_PX } });
  if (t.desc) add(t.desc, "body", LINE_PX, LINE_PX * 5, { maxCols: MAX_COLS, color: ink.parchment });
  if (t.statsHead) add(t.statsHead, "label", SMALL_PX, LINE_PX * 5, { color: ink.faded });
  if (t.stats.length) add(t.stats, "body", LINE_PX, SMALL_PX * 3, { maxCols: MAX_COLS });
  if (t.notes.length) {
    y += LINE_PX * 4;
    rows.push({ kind: "rule", y });
    y += TEXEL;
    t.notes.forEach((n, i) =>
      add(n.text, "body", LINE_PX, i === 0 ? LINE_PX * 4 : LINE_PX * 2.5, {
        maxCols: MAX_COLS,
        icon: n.icon ? { name: n.icon, tint: n.iconTint ?? ink.parchment, px: (LINE_PX * 7) / spriteSize(n.icon).h } : undefined,
      }),
    );
  }
  return { rows, w: w + PAD * 2, h: y + PAD * 2 };
}

export function ItemPlaque() {
  const ix = useInventory();
  const shown = useUiShow();
  useInventoryVersion(ix);
  // Re-read when the inventory or gold changes under a steady hover (a sale,
  // a server update) — cheap: only the hovered socket is read.
  const gold = useGame((s) => s.gold);
  const bag = useGame((s) => s.bag);
  const belt = useGame((s) => s.belt);
  const chest = useGame((s) => s.chest);
  const equipment = useGame((s) => s.equipment);
  const hoverKey = ix.drag ? null : ix.hover;
  const reading = useMemo(
    () => readSocket(ix, hoverKey),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [ix, hoverKey, gold, bag, belt, chest, equipment, ix.mode],
  );

  // Hovering a bag item lights the gear card it would replace.
  useEffect(() => {
    let compare: string | null = null;
    if (reading && hoverKey) {
      const spec = ix.sockets.get(hoverKey)?.spec;
      const stack = spec?.ref ? readSlot(carriedNow(), spec.ref) : null;
      if (stack && spec?.ref?.container !== "equipment") {
        const slot = resolveItem(stack.defId).def.slot;
        if (slot !== "consumable") compare = slotKey({ container: "equipment", slot });
      }
    }
    ix.compareKey = compare;
  }, [reading, hoverKey, ix]);

  // Keep the last words so they can burn off rather than vanish.
  const [last, setLast] = useState<Reading | null>(null);
  useEffect(() => {
    if (reading) setLast(reading);
  }, [reading]);
  const on = !!reading && shown;
  const text = (reading ?? last)?.text ?? null;
  const lay = useMemo(() => (text ? layoutPlaque(text) : null), [text]);
  const size = lay ? { w: lay.w, h: lay.h } : { w: 0.4, h: 0.2 };

  // Where it hangs: computed when the reading or the view changes, not per
  // frame (the sockets don't move in the scene's frame).
  const viewSize = useThree((s) => s.size);
  const target = useRef(new Vector3());
  useEffect(() => {
    if (!reading || !ix.root) return;
    const entry = ix.sockets.get(reading.key);
    if (!entry || !ix.socketRootPosition(reading.key, tmpA)) return;
    const fit = ix.root.scale.x || 1;
    // The plaque hangs nearer than the socket: carry the socket along its
    // line of sight into the plaque's plane (the eye is on the root's axis).
    const k = (SCENE_DISTANCE / fit - PLAQUE_Z) / (SCENE_DISTANCE / fit - tmpA.z);
    const v = viewHalfExtent(78, viewSize.width / Math.max(1, viewSize.height), DIST);
    const p = placePlaque(
      { x: tmpA.x * k, y: tmpA.y * k, half: (entry.spec.size / 2 + 0.02) * k },
      size,
      { halfW: v.halfW / fit - 0.04, halfH: v.halfH / fit - 0.04 },
      // Outward from the scene's middle: over the edge of the altar alone, or
      // over the far side of whichever tablet of a pair it's on.
      tmpA.x < -0.05 ? -1 : 1,
    );
    target.current.set(p.x, p.y, PLAQUE_Z);
  }, [reading, size.w, size.h, viewSize, ix]);

  const group = useRef<Group>(null);
  const card = useRef<Group>(null);
  const k = useRef({ open: 0 });
  const [textOn, setTextOn] = useState(false);
  useFrame((_, dt) => {
    const g = group.current;
    const c = card.current;
    if (!g || !c) return;
    const s = k.current;
    s.open = on ? Math.min(1, s.open + dt * 9) : Math.max(0, s.open - dt * 7);
    // It hangs where it's needed at once — a card, not a cloud.
    g.position.copy(target.current);
    // Unfolds downward from its top edge, like a hinged plaque, in steps.
    const open = Math.ceil(s.open * UNFOLD_STEPS) / UNFOLD_STEPS;
    c.scale.set(1, Math.max(0.0001, open), 1);
    c.position.y = (size.h * (1 - open)) / 2;
    g.visible = s.open > 0.01;
    const wantText = on && s.open > 0.75;
    if (wantText !== textOn) setTextOn(wantText);
  });

  const left = -size.w / 2 + PAD;
  const top = size.h / 2 - PAD;
  return (
    <group ref={group} visible={false}>
      <group ref={card}>
        {/* A worn slate slab, warmed a little by the item's grade. */}
        <mesh geometry={slabGeometry(size.w, size.h, TEXEL * 4)} material={slabMaterial(text?.frame === "gold" ? ink.gold : null)} renderOrder={4} />
      </group>
      {lay && (
        <UiTextStyleProvider value={{ depth: -0.35 }}>
          {lay.rows.map((r, i) =>
            r.kind === "rule" ? (
              <group key={`r${i}`} visible={textOn} position={[0, top - r.y, 0.006]}>
                <mesh geometry={plane()} material={flat(ink.ink, 0.5)} scale={[size.w - PAD * 2, TEXEL, 1]} />
                <mesh geometry={plane()} material={flat(ink.stoneLight, 0.5)} scale={[size.w - PAD * 2, TEXEL, 1]} position={[0, -TEXEL, 0.0002]} />
              </group>
            ) : (
              <group key={`t${i}`}>
                {r.icon && (
                  <UiShow show={textOn}>
                    <PixelSprite
                      name={r.icon.name}
                      tint={r.icon.tint}
                      px={r.icon.px}
                      anchor={[0, 1]}
                      position={[left, top - r.y + (r.icon.px * spriteSize(r.icon.name).h - r.px * 7) / 2, 0.008]}
                      delay={0.05 * i}
                    />
                  </UiShow>
                )}
                <RuneText
                  text={r.text}
                  font={r.font}
                  px={r.px}
                  maxCols={r.maxCols}
                  color={r.color}
                  align="left"
                  anchor={[0, 0]}
                  position={[left + r.x, top - r.y, 0.008]}
                  show={textOn}
                  glow={r.font === "label" ? 0.3 : 0.6}
                  inDuration={0.25}
                  outDuration={0.2}
                  delay={0.03 * i}
                  stagger={0.15}
                />
              </group>
            ),
          )}
        </UiTextStyleProvider>
      )}
    </group>
  );
}
