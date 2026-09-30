import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { BoxGeometry, type Group } from "three";
import { resolveItem } from "../../../items/catalog";
import type { GearSlot, ItemInstance } from "../../../items/types";
import { useGame } from "../../../state/gameStore";
import { ITEM_ICONS } from "../../../ui/itemInfo";
import { palette } from "../../../ui/theme";
import { pxFor } from "../../anchors";
import { uiNow } from "../../clock";
import { ItemModel } from "../../ItemModel";
import { stoneMaterial } from "../../materials";
import { useUiShow } from "../../presence";
import { RuneText } from "../../text/RuneText";
import { glowQuad, makeGlowMaterial } from "./glow";
import { HudAnchor, hudUnit, Undistort } from "./HudAnchor";
import { HUD_LAYOUT } from "./layout";
import { Materialize } from "./Materialize";
import { usePresenceList } from "./usePresenceList";

/** What you're wearing, as the things themselves: staff, amulet, cloak and
 * boots hang in a row over a slim stone ledge at the lower right, dim and
 * quiet — until one changes: the old piece burns away, the new one arrives
 * in a flare, glows bright for a moment and its name writes itself under
 * the ledge. Unbanked run loot wears a small amber bead (lost on death until
 * banked); an empty slot is only a faint rune of what belongs there. */

const L = HUD_LAYOUT.equipment;
const U = hudUnit(L.distance);
const STEP = 0.07 * U;
const ROW_Y = 0.05 * U;
const LEDGE_Y = 0.008 * U;
const HINT_Y = -0.016 * U;
const NAME_PX = pxFor(L.distance, 0.017);
const HINT_PX = pxFor(L.distance, 0.016);
const ICON_PX = pxFor(L.distance, 0.024);

const SLOTS: readonly GearSlot[] = ["staff", "amulet", "cloak", "boots"];

/** Per-slot presentation: size and lean so four very different shapes read
 * as one row. */
const POSE: Record<GearSlot, { scale: number; rot: [number, number, number]; y: number }> = {
  staff: { scale: 0.082, rot: [0, 0, -0.42], y: 0 },
  amulet: { scale: 0.078, rot: [0.1, 0, 0], y: 0.004 },
  cloak: { scale: 0.068, rot: [0.15, 0, 0], y: 0.002 },
  boots: { scale: 0.08, rot: [0.3, -0.5, 0], y: 0 },
};

let ledgeGeo: BoxGeometry | null = null;

export function Equipment() {
  const equipment = useGame((s) => s.equipment);
  const [named, setNamed] = useState<{ id: number; text: string; color: string } | null>(null);
  const previous = useRef<Record<GearSlot, string | null> | null>(null);

  // A changed piece gets its name written under the ledge for a moment.
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
    setNamed({ id: Date.now(), text: item.name, color: item.affix ? palette.enchant : palette.item });
    const timer = setTimeout(() => setNamed((n) => (n && n.text === item.name ? { ...n, id: -n.id } : n)), 3200);
    return () => clearTimeout(timer);
  }, [equipment]);

  return (
    <HudAnchor h={L.h} v={L.v} inset={L.inset} distance={L.distance}>
      {/* The ledge is wide, not a small solid: no undistortion (it would
          shear it into a slant). */}
      <Materialize position={[-STEP * 1.5 - 0.035 * U, LEDGE_Y, 0]} delay={0.15} color="#8f86a0" size={0.05 * U} from={[0, -0.02 * U, -0.1 * U]} spin={0.4}>
        <mesh
          geometry={(ledgeGeo ??= new BoxGeometry(1, 1, 1))}
          material={stoneMaterial("#3d3845")}
          scale={[STEP * 4.1, 0.007 * U, 0.03 * U]}
          rotation={[0.5, 0, 0]}
        />
      </Materialize>
      {SLOTS.map((slot, i) => (
        <GearPiece key={slot} slot={slot} worn={slot === "staff" ? equipment.staff : equipment[slot]} x={-0.035 * U - (SLOTS.length - 1 - i) * STEP} index={i} />
      ))}
      <RuneText
        text={named?.text ?? ""}
        show={!!named && named.id > 0}
        px={NAME_PX}
        color={named?.color ?? palette.item}
        anchor={[1, 0.5]}
        align="right"
        position={[-0.035 * U + 0.012 * U, HINT_Y, 0]}
        glow={0.8}
        outline={0.6}
      />
      <RuneText text="I — inventory" show={!named || named.id < 0} px={HINT_PX} color={palette.faint} anchor={[1, 0.5]} align="right" position={[-0.035 * U + 0.012 * U, HINT_Y, 0]} glow={0.3} outline={0.5} delay={0.9} />
    </HudAnchor>
  );
}

function GearPiece({ slot, worn, x, index }: { slot: GearSlot; worn: ItemInstance | null; x: number; index: number }) {
  const defId = worn?.defId ?? null;
  const item = useMemo(() => (defId ? resolveItem(defId) : null), [defId]);
  const color = item?.def.color ?? palette.slotEmpty;
  const glow = useMemo(() => makeGlowMaterial(color, 0.1), [color]);
  useEffect(() => () => glow.dispose(), [glow]);
  const { entries, remove } = usePresenceList(defId, defId);
  const changedAt = useRef(-10);
  const first = useRef(true);
  const sway = useRef<Group>(null);
  const pose = POSE[slot];
  // The glow isn't inside the item's Materialize: fade it with the HUD.
  const visible = useUiShow();
  const lit = useRef(0);

  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    changedAt.current = uiNow();
  }, [defId]);

  useFrame((_, rawDt) => {
    const now = uiNow();
    const since = now - changedAt.current;
    lit.current += ((visible ? 1 : 0) - lit.current) * (1 - Math.exp(-Math.min(rawDt, 0.05) * 5));
    // Brightens when it changes, then settles back to a dim ember.
    const bright = since < 3 ? Math.exp(-since * 1.4) : 0;
    glow.uniforms.uIntensity.value = ((item ? 0.07 : 0) + bright * 1.1) * lit.current;
    const s = sway.current;
    if (s) {
      s.rotation.y = Math.sin(now * 0.6 + index * 1.7) * 0.35;
      s.position.y = ROW_Y + pose.y * U + Math.sin(now * 1.1 + index) * 0.0015 * U + bright * 0.012 * U;
      s.scale.setScalar(1 + bright * 0.18);
    }
  });

  return (
    <group position={[x, 0, 0]}>
      <Undistort at={[0, ROW_Y, 0]}>
        <mesh geometry={glowQuad()} material={glow} position={[0, 0, -0.03 * U]} scale={0.075 * U} renderOrder={1} />
      </Undistort>
      <Undistort>
        <group ref={sway} position={[0, ROW_Y, 0]}>
          {entries.map((e) => (
            <Materialize key={e.id} show={e.shown} delay={0.25 + index * 0.08} color={color} size={0.03 * U} onHidden={() => remove(e.id)}>
              <group rotation={pose.rot}>
                <ItemModel itemId={e.value} scale={pose.scale * U} />
              </group>
            </Materialize>
          ))}
        </group>
      </Undistort>
      <RuneText text={ITEM_ICONS[slot]} show={!item} px={ICON_PX} color={palette.faint} position={[0, ROW_Y, 0]} glow={0.3} outline={0.4} />
      <RuneText text="•" show={!!worn?.runLoot} px={NAME_PX} color={palette.runLoot} position={[0.022 * U, 0.018 * U, 0]} glow={1} outline={0.5} delay={0.8} />
    </group>
  );
}
