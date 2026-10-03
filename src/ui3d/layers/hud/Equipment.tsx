import { useEffect, useMemo, useState } from "react";
import { ENCHANT_COLOR } from "../../../items/affixes";
import { resolveItem } from "../../../items/catalog";
import type { GearSlot } from "../../../items/types";
import { useGame } from "../../../state/gameStore";
import { getAbility } from "../../../weapons/spells";
import { KeyCap, keyCapWidth } from "../../KeyCap";
import { UiShow } from "../../presence";
import { measureText, RuneText } from "../../text/RuneText";
import { ink } from "../../theme";
import { apx, fontPx, FRAME_TEXEL, plateSize } from "./ap";
import { HudAnchor } from "./HudAnchor";
import { HUD_LAYOUT } from "./layout";
import type { SlotPose } from "./SlotCard";

/** Bottom right: nothing, most of the time — your gear is in your hand
 * and in the satchel (Tab). When you arrive somewhere, or take up another
 * staff, its two spells write themselves there on their mouse buttons for
 * a few breaths ([L] Bolt  [R] Force Blast), then burn away. */

const L = HUD_LAYOUT.equipment;
const A = apx(L.distance);
const KEY_PX = fontPx(9, "label", L.distance);
const SPELL_PX = fontPx(12, "body", L.distance);
/** Seconds the spells stay up. */
const HINT_HOLD = 6;

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
  const staffId = useGame((s) => s.equipment.staff.defId);
  const phase = useGame((s) => s.phase);
  const floor = useGame((s) => s.floor);
  const instanceId = useGame((s) => s.instanceId);
  const [up, setUp] = useState(true);
  useEffect(() => {
    setUp(true);
    const timer = setTimeout(() => setUp(false), HINT_HOLD * 1000);
    return () => clearTimeout(timer);
  }, [staffId, phase, floor, instanceId]);
  return (
    <HudAnchor h={L.h} v={L.v} inset={L.inset} distance={L.distance}>
      <UiShow show={up}>
        <Spells staffId={staffId} bottom={0} />
      </UiShow>
    </HudAnchor>
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
