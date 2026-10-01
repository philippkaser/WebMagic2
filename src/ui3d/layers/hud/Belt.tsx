import { useEffect, useRef } from "react";
import { Vector3, type Group } from "three";
import type { ItemStack } from "../../../items/types";
import { useGame } from "../../../state/gameStore";
import { uiNow } from "../../clock";
import { Plate } from "../../Plate";
import { emitUiSparks } from "../../UiSparks";
import { apx, FRAME_TEXEL, plateSize } from "./ap";
import { itemColor, POSE } from "./Equipment";
import { HudAnchor } from "./HudAnchor";
import { HUD_LAYOUT, SLOT, slotStrip } from "./layout";
import { SlotCard } from "./SlotCard";

/** The belt: the two consumables bound to Q and E, beside the vitals they
 * mend — two framed item slots in a small iron panel, each with its key cap
 * on the corner, the potion itself turning in the slot and the stack count
 * as its badge. Using one makes its slot flare and puff sparks; swapping
 * one out makes the old one burn away as the new one arrives. */

const L = HUD_LAYOUT.belt;
const A = apx(L.distance);
const STRIP = slotStrip(2);
const [PW, PH] = plateSize(STRIP.cssW, STRIP.cssH);
const tmp = new Vector3();

export function Belt() {
  const belt = useGame((s) => s.belt);
  const outerW = PW + FRAME_TEXEL * 2;
  const outerH = PH + FRAME_TEXEL * 2;
  return (
    <HudAnchor h={L.h} v={L.v} inset={L.inset} distance={L.distance}>
      <group position={[(outerW / 2) * A, (outerH / 2) * A, 0]}>
        <Plate width={PW * A} height={PH * A} frame="iron" texel={FRAME_TEXEL * A} fillOpacity={0.94}>
          {(["Q", "E"] as const).map((key, i) => (
            <BeltSlot
              key={key}
              hotkey={key}
              stack={belt[i] ?? null}
              index={i}
              position={[(-STRIP.cssW / 2 + 10 + SLOT.w / 2 + i * (SLOT.w + SLOT.gap)) * A, (STRIP.cssH / 2 - 10 - SLOT.h / 2) * A, 0]}
            />
          ))}
        </Plate>
      </group>
    </HudAnchor>
  );
}

function BeltSlot({ hotkey, stack, index, position }: { hotkey: string; stack: ItemStack | null; index: number; position: readonly [number, number, number] }) {
  const defId = stack?.defId ?? null;
  const color = defId ? itemColor(defId) : "#2e2735";
  const qty = stack?.qty ?? 0;
  const lastQty = useRef(qty);
  const flashAt = useRef(-10);
  const at = useRef<Group>(null);

  // Fewer than before, same potion: it was used — a flare and a puff.
  useEffect(() => {
    if (qty < lastQty.current && at.current) {
      flashAt.current = uiNow();
      const p = at.current.getWorldPosition(tmp);
      emitUiSparks({ position: [p.x, p.y, p.z], color, count: 14, speed: 0.06, up: 0.05, size: 0.004, spread: 0.02, ttl: 0.8 });
    }
    lastQty.current = qty;
  }, [qty, color]);

  return (
    <group ref={at} position={position as [number, number, number]}>
      <SlotCard
        unit={A}
        itemId={defId}
        color={color}
        icon="flask"
        pose={POSE.consumable}
        badge={qty > 1 ? `${qty}` : null}
        keyCap={hotkey}
        runLoot={!!stack?.runLoot}
        flashAt={flashAt}
        index={index + 1}
        position={[0, 0, 0]}
      />
    </group>
  );
}
