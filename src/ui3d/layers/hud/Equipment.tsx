import { useEffect, useMemo, useRef, useState } from "react";
import { ENCHANT_COLOR } from "../../../items/affixes";
import { resolveItem } from "../../../items/catalog";
import type { GearSlot, ItemInstance } from "../../../items/types";
import { useGame } from "../../../state/gameStore";
import { getAbility } from "../../../weapons/spells";
import { uiNow } from "../../clock";
import { KeyCap, keyCapWidth } from "../../KeyCap";
import { measureText, RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { apx, fontPx, FRAME_TEXEL, plateSize } from "./ap";
import { HudAnchor } from "./HudAnchor";
import { HUD_LAYOUT, SLOT, slotStrip } from "./layout";
import { SlotCard, type SlotPose } from "./SlotCard";

/** Bottom right, as artpass lays it out (hud/EquipStrip): the staff's two
 * spells on their mouse buttons, and under them the four worn pieces as
 * item cards carried in a row (no panel around them) — each with the piece itself, the 3D
 * model, turning in it. When a piece changes, the old one burns away as the
 * new one arrives, its slot flares in its colour and its name writes itself
 * above the strip for a moment. */

const L = HUD_LAYOUT.equipment;
const A = apx(L.distance);
const SLOTS: readonly GearSlot[] = ["staff", "amulet", "cloak", "boots"];
const STRIP = slotStrip(SLOTS.length);
const [PW, PH] = plateSize(STRIP.cssW, STRIP.cssH);
const KEY_PX = fontPx(9, "label", L.distance);
const SPELL_PX = fontPx(12, "body", L.distance);
const NAME_PX = fontPx(13, "body", L.distance);

/** Per-slot presentation: size and lean so four very different shapes read
 * as one row. Scales are in artpass pixels. */
export const POSE: Record<GearSlot | "consumable", SlotPose> = {
  staff: { scale: 40, rot: [0, 0, -0.62] },
  amulet: { scale: 33, rot: [0.1, 0, 0] },
  cloak: { scale: 30, rot: [0.15, 0, 0] },
  boots: { scale: 33, rot: [0.3, -0.5, 0] },
  consumable: { scale: 36, rot: [0.15, 0, 0] },
};

/** An item's card colour: its own, or the enchantment's violet. */
export function itemColor(defId: string): string {
  const item = resolveItem(defId);
  return item.affix ? ENCHANT_COLOR : item.def.color;
}

export function Equipment() {
  const equipment = useGame((s) => s.equipment);
  const [named, setNamed] = useState<{ id: number; text: string; color: string } | null>(null);
  const previous = useRef<Record<GearSlot, string | null> | null>(null);

  // A changed piece gets its name written above the strip for a moment.
  useEffect(() => {
    const now: Record<GearSlot, string | null> = {
      staff: equipment.staff.defId,
      amulet: equipment.amulet?.defId ?? null,
      cloak: equipment.cloak?.defId ?? null,
      boots: equipment.boots?.defId ?? null,
    };
    const before = previous.current;
    previous.current = now;
    if (!before) return;
    const slot = SLOTS.find((s) => now[s] !== before[s] && now[s] !== null);
    if (!slot) return;
    const item = resolveItem(now[slot]!);
    setNamed({ id: Date.now(), text: item.name, color: item.affix ? ENCHANT_COLOR : ink.parchment });
    const timer = setTimeout(() => setNamed((n) => (n && n.text === item.name ? { ...n, id: -n.id } : n)), 3200);
    return () => clearTimeout(timer);
  }, [equipment]);

  const outerW = PW + FRAME_TEXEL * 2;
  const outerH = PH + FRAME_TEXEL * 2;
  return (
    <HudAnchor h={L.h} v={L.v} inset={L.inset} distance={L.distance}>
      <group position={[-(outerW / 2) * A, (outerH / 2) * A, 0]}>
        <group position={[0, 0, 0.003]}>
          {SLOTS.map((slot, i) => (
            <GearSlotCard
              key={slot}
              slot={slot}
              worn={slot === "staff" ? equipment.staff : equipment[slot]}
              index={i}
              position={[(-STRIP.cssW / 2 + 10 + SLOT.w / 2 + i * (SLOT.w + SLOT.gap)) * A, (STRIP.cssH / 2 - 10 - SLOT.h / 2) * A, 0]}
            />
          ))}
        </group>
      </group>
      <Spells staffId={equipment.staff.defId} bottom={outerH + 6} />
      <RuneText
        text={named?.text ?? ""}
        show={!!named && named.id > 0}
        font="body"
        px={NAME_PX}
        color={named?.color ?? ink.parchment}
        anchor={[1, 0.5]}
        align="right"
        position={[-2 * A, (outerH + 6 + 38 + 12) * A, 0]}
        glow={0.8}
        outline={0.6}
      />
    </HudAnchor>
  );
}

function GearSlotCard({ slot, worn, index, position }: { slot: GearSlot; worn: ItemInstance | null; index: number; position: readonly [number, number, number] }) {
  const defId = worn?.defId ?? null;
  const item = useMemo(() => (defId ? resolveItem(defId) : null), [defId]);
  const flashAt = useRef(-10);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    flashAt.current = uiNow();
  }, [defId]);
  return (
    <SlotCard
      unit={A}
      itemId={defId}
      color={defId ? itemColor(defId) : "#2e2735"}
      icon={slot}
      pose={POSE[slot]}
      badge={item && item.level > 0 ? `${item.level}` : null}
      enchanted={!!item?.affix}
      runLoot={!!worn?.runLoot}
      flashAt={flashAt}
      index={index}
      position={position}
    />
  );
}

/** The staff's spells on their mouse buttons (`.wm-abil`): [L] Bolt
 * [R] Force Blast, key caps and names right-aligned over the slots. */
function Spells({ staffId, bottom }: { staffId: string; bottom: number }) {
  const def = useMemo(() => resolveItem(staffId).def, [staffId]);
  const parts = useMemo(() => {
    const out: { key: string; name: string }[] = [];
    if (def.primary) out.push({ key: "L", name: getAbility(def.primary).name });
    if (def.secondary) out.push({ key: "R", name: getAbility(def.secondary).name });
    return out;
  }, [def]);
  // Layout in artpass pixels: key cap, 4, name, 10, key cap, 4, name.
  const items = parts.map((p) => ({
    ...p,
    capW: keyCapWidth(p.key, KEY_PX) / A,
    nameW: measureText(p.name, SPELL_PX, undefined, "body").width / A,
  }));
  const contentW = items.reduce((w, it) => w + it.capW + 4 + it.nameW, 0) + Math.max(0, items.length - 1) * 10;
  const [pw, ph] = plateSize(contentW + 8, 22);
  const outerW = pw + FRAME_TEXEL * 2;
  const outerH = ph + FRAME_TEXEL * 2;
  let x = -(contentW / 2);
  return (
    <group position={[-(outerW / 2) * A, (bottom + outerH / 2) * A, 0]}>
      <group position={[0, 0, 0.003]}>
        {items.map((it, i) => {
          const capX = x + it.capW / 2;
          const nameX = x + it.capW + 4;
          x += it.capW + 4 + it.nameW + 10;
          return (
            <group key={it.key}>
              <KeyCap k={it.key} px={KEY_PX} position={[capX * A, 0, 0.001]} />
              <RuneText
                text={it.name}
                font="body"
                px={SPELL_PX}
                color={ink.parchmentDim}
                anchor={[0, 0.5]}
                align="left"
                position={[nameX * A, 0, 0]}
                glow={0.4}
                outline={0.6}
                delay={0.3 + i * 0.1}
              />
            </group>
          );
        })}
      </group>
    </group>
  );
}
