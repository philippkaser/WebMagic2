import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { BoxGeometry, Color, Group, MeshStandardMaterial, Vector3 } from "three";
import { resolveItem, type ResolvedItem } from "../../../items/catalog";
import { GAMBLE_PRICE, merchantPrice } from "../../../items/economy";
import { readSlot } from "../../../items/inventory";
import { useGame } from "../../../state/gameStore";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { stoneMaterial } from "../../materials";
import { useUiShow } from "../../presence";
import { UiTextStyleProvider } from "../../style";
import { measureText, RuneText } from "../../text/RuneText";
import { sellOffer } from "./dropTarget";
import { carriedNow, useInventory, useInventoryVersion, type InventoryInteraction } from "./interaction";
import { GAMBLE_WARE, placePlaque, SCENE_DISTANCE, slotKey, TEXT, viewHalfExtent } from "./layout";
import { fortuneText, plaqueText, wornCounterpart, type PlaqueText } from "./plaqueText";

/** The plaque that reads an item to you: hover anything and a slate plaque
 * unfolds beside it — off the tablet's edge where there's room — and its
 * name, kind, stats and footnotes write themselves on. Moving to the next
 * socket re-writes only what differs; moving away burns the words off and
 * folds the plaque away.
 *
 * It hangs a little in front of the tablets (PLAQUE_Z), so it's never
 * clipped by a tablet turned toward you; its text is sized for that nearer
 * distance so it stays the planned share of the screen. */

const PLAQUE_Z = 0.24;
const DIST = SCENE_DISTANCE - PLAQUE_Z;
const NAME_PX = pxFor(DIST, TEXT.plaqueName);
const LINE_PX = pxFor(DIST, TEXT.plaqueLine);
const MAX_COLS = 38;
const PAD = 0.045;
const GAP = 0.022;

const box = new BoxGeometry(1, 1, 1);
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
  let worn: ResolvedItem | null = null;
  if (item.def.slot !== "consumable") {
    const w = inv.equipment[item.def.slot];
    worn = wornCounterpart(item, w ? resolveItem(w.defId) : null, spec.ref.container === "equipment");
  }
  return {
    key,
    text: plaqueText(item, worn, {
      qty: stack.qty,
      runLoot: stack.runLoot,
      sellFor: ix.mode === "merchant" && state.phase === "village" ? sellOffer(inv, spec.ref) : null,
    }),
  };
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

  // Hovering a bag item faintly kindles the gear socket it would replace.
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

  const size = useMemo(() => {
    if (!text) return { w: 0.4, h: 0.2, nameH: 0 };
    const n = measureText(text.title, NAME_PX, MAX_COLS - 6);
    const b = measureText(text.body, LINE_PX, MAX_COLS);
    return { w: Math.max(n.width, b.width) + PAD * 2, h: n.height + GAP + b.height + PAD * 2, nameH: n.height };
  }, [text]);

  // Where it hangs: computed when the reading or the view changes, not per
  // frame (the sockets don't move in the scene's frame).
  const viewSize = useThree((s) => s.size);
  const target = useRef(new Vector3());
  const placed = useRef(false);
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
  }, [reading, size, viewSize, ix]);

  const accent = useMemo(() => new Color(text?.accent ?? "#46ffd0"), [text?.accent]);
  const seam = useMemo(
    () => new MeshStandardMaterial({ color: "#050407", emissive: accent, emissiveIntensity: 0.9, toneMapped: false, roughness: 0.5 }),
    [accent],
  );
  useEffect(() => () => seam.dispose(), [seam]);

  const group = useRef<Group>(null);
  const plate = useRef<Group>(null);
  const k = useRef({ open: 0, w: size.w, h: size.h });
  const [textOn, setTextOn] = useState(false);
  useFrame((_, dt) => {
    const g = group.current;
    const pl = plate.current;
    if (!g || !pl) return;
    const s = k.current;
    const q = 1 - Math.exp(-dt * 16);
    s.open += ((on ? 1 : 0) - s.open) * (1 - Math.exp(-dt * (on ? 14 : 8)));
    if (!placed.current || s.open < 0.02) {
      g.position.copy(target.current);
      s.w = size.w;
      s.h = size.h;
      placed.current = on;
    } else {
      g.position.lerp(target.current, q);
      s.w += (size.w - s.w) * q;
      s.h += (size.h - s.h) * q;
    }
    // Unfolds downward from its top edge, like a hinged plaque.
    const open = s.open;
    pl.scale.set(s.w * (0.7 + 0.3 * open), Math.max(0.0001, s.h * open), 1);
    pl.position.y = (s.h * (1 - open)) / 2;
    g.visible = open > 0.01;
    const wantText = on && open > 0.75;
    if (wantText !== textOn) setTextOn(wantText);
    seam.emissiveIntensity = 0.7 + Math.sin(uiNow() * 3) * 0.2;
  });

  return (
    <group ref={group} visible={false}>
      <group ref={plate}>
        <mesh geometry={box} material={seam} scale={[1 + 0.016 / size.w, 1 + 0.016 / size.h, 0.012]} position={[0, 0, -0.006]} />
        <mesh geometry={box} material={stoneMaterial("#221f28")} scale={[1, 1, 0.02]} />
      </group>
      {text && (
        <UiTextStyleProvider value={{ depth: -0.35 }}>
          <RuneText
            text={text.title}
            px={NAME_PX}
            maxCols={MAX_COLS - 6}
            align="left"
            anchor={[0, 0]}
            position={[-size.w / 2 + PAD, size.h / 2 - PAD, 0.012]}
            show={textOn}
            glow={1}
            inDuration={0.3}
            outDuration={0.25}
            stagger={0.15}
          />
          <RuneText
            text={text.body}
            px={LINE_PX}
            maxCols={MAX_COLS}
            align="left"
            anchor={[0, 0]}
            position={[-size.w / 2 + PAD, size.h / 2 - PAD - size.nameH - GAP, 0.012]}
            show={textOn}
            glow={0.6}
            inDuration={0.3}
            outDuration={0.25}
            stagger={0.3}
          />
        </UiTextStyleProvider>
      )}
    </group>
  );
}
