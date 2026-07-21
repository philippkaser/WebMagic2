import { Canvas, useFrame } from "@react-three/fiber";
import { useEffect, useRef, useState, type CSSProperties, type DragEvent } from "react";
import { Group } from "three";
import { getItemDef, resolveItem, type ResolvedItem } from "../items/catalog";
import { ENCHANT_COLOR } from "../items/affixes";
import { GAMBLE_PRICE, MERCHANT_STOCK, sellValue } from "../items/economy";
import {
  moveItem as moveItemPure,
  readSlot,
  refsEqual,
  type Carried,
  type SlotRef,
} from "../items/inventory";
import type { GearSlot, ItemStack } from "../items/types";
import { WizardModel } from "../render/WizardModel";
import { useGame, type Overlay } from "../state/gameStore";
import { iconOf, statLines } from "./itemInfo";
import { boneButton, fleshPanel, scarred } from "./theme";

/** The inventory screen family. One layout, three flavors:
 *  - "inventory": the wizard, gear, belt and bag
 *  - "chest":     inventory + the 30-slot village chest below
 *  - "merchant":  inventory + Maro's ware list below
 * Items move by DRAG & DROP between any cells (click still does the obvious
 * quick-move). All rules live in items/inventory.ts#moveItem — this screen
 * only proposes moves; the store (and the server) decide. */
export function InventoryScreen({ mode }: { mode: Exclude<Overlay, "none" | "devroom"> }) {
  const equipment = useGame((s) => s.equipment);
  const bag = useGame((s) => s.bag);
  const belt = useGame((s) => s.belt);
  const chest = useGame((s) => s.chest);
  const gold = useGame((s) => s.gold);
  const runGold = useGame((s) => s.runGold);
  const phase = useGame((s) => s.phase);
  const [inspected, setInspected] = useState<ResolvedItem | null>(null);
  const [drag, setDrag] = useState<SlotRef | null>(null);

  // Escape (already unlocks the pointer) also closes the screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") useGame.getState().setOverlay("none");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const act = useGame.getState();
  const inv: Carried = { equipment, bag, belt, chest };
  const inVillage = phase === "village";

  const cellProps = (ref: SlotRef, stack: ItemStack | null) => ({
    stack,
    dragRef: ref,
    dragging: drag,
    onBeginDrag: setDrag,
    onEndDrag: () => setDrag(null),
    canDrop: (from: SlotRef) =>
      moveItemPure(inv, from, ref) !== null &&
      // Chest moves only work in the village (the store enforces it too).
      (inVillage || (from.container !== "chest" && ref.container !== "chest")),
    onDropItem: (from: SlotRef) => act.moveItem(from, ref),
    onHover: (itemId: string | undefined) => setInspected(itemId ? resolveItem(itemId) : null),
  });

  const firstFree = (grid: (ItemStack | null)[]) => grid.indexOf(null);
  /** Click = the obvious quick-move for that cell. */
  const quickMove = (ref: SlotRef) => {
    const stack = readSlot(inv, ref);
    if (!stack) return;
    const def = getItemDef(stack.defId);
    if (ref.container === "bag" || ref.container === "chest") {
      if (mode === "chest" && ref.container === "bag" && inVillage) {
        const free = firstFree(chest);
        if (free !== -1) act.moveItem(ref, { container: "chest", index: free });
        return;
      }
      if (ref.container === "chest") {
        const free = firstFree(bag);
        if (free !== -1) act.moveItem(ref, { container: "bag", index: free });
        return;
      }
      if (def.slot === "consumable") {
        const free = firstFree(belt);
        act.moveItem(ref, { container: "belt", index: free === -1 ? 0 : free });
      } else {
        act.moveItem(ref, { container: "equipment", slot: def.slot as GearSlot });
      }
      return;
    }
    // Equipment/belt → back to the bag.
    const free = firstFree(bag);
    if (free !== -1) act.moveItem(ref, { container: "bag", index: free });
  };

  const title =
    mode === "chest" ? "YOUR CHEST" : mode === "merchant" ? "MARO THE PROVISIONER" : "INVENTORY";

  return (
    <div style={styles.backdrop}>
      <div className="wm-breathe" style={styles.panel}>
        <div style={styles.header}>
          <span style={styles.title}>{title}</span>
          <span style={styles.gold}>
            ◈ {gold}
            {runGold > 0 && <span style={{ color: "#c8a23c" }}> +{runGold}◦</span>}
            <span style={{ color: "#7d7566" }}> gold</span>
          </span>
          <button style={styles.close} onClick={() => act.setOverlay("none")}>
            ✕
          </button>
        </div>

        <div style={styles.columns}>
          {/* Left: staff + belt */}
          <div style={styles.sideColumn}>
            <SlotCell
              label="staff"
              {...cellProps({ container: "equipment", slot: "staff" }, toStack(equipment.staff))}
            />
            {[0, 1].map((i) => (
              <SlotCell
                key={i}
                label={i === 0 ? "Q" : "E"}
                accent
                {...cellProps({ container: "belt", index: i }, belt[i])}
                onClick={() => quickMove({ container: "belt", index: i })}
              />
            ))}
          </div>

          <WizardViewer />

          {/* Right: gear */}
          <div style={styles.sideColumn}>
            {(["amulet", "cloak", "boots"] as const).map((slot) => (
              <SlotCell
                key={slot}
                label={slot}
                {...cellProps({ container: "equipment", slot }, toStack(equipment[slot]))}
                onClick={() => quickMove({ container: "equipment", slot })}
              />
            ))}
          </div>
        </div>

        {/* Bag + the drop zone */}
        <div style={styles.bagRow}>
          {bag.map((stack, i) => (
            <SlotCell
              key={i}
              label={`${i + 1}`}
              {...cellProps({ container: "bag", index: i }, stack)}
              onClick={() => quickMove({ container: "bag", index: i })}
            />
          ))}
          <DropZone
            drag={drag}
            inv={inv}
            mode={mode === "merchant" ? "sell" : phase === "dungeon" ? "drop" : "discard"}
            onDropItem={(from) => {
              if (mode === "merchant") act.sellStack(from);
              else act.dropStack(from);
              setDrag(null);
            }}
          />
        </div>

        {/* Detail strip: whatever the cursor is over, compared to what's worn. */}
        <DetailStrip inspected={inspected} inv={inv} mode={mode} />

        {mode === "chest" && (
          <div style={styles.chestGrid}>
            {chest.map((stack, i) => (
              <SlotCell
                key={i}
                small
                {...cellProps({ container: "chest", index: i }, stack)}
                onClick={() => quickMove({ container: "chest", index: i })}
              />
            ))}
          </div>
        )}

        {mode === "merchant" && (
          <div style={styles.wares}>
            {MERCHANT_STOCK.map(({ id, price }) => {
              const def = getItemDef(id);
              const affordable = gold >= price;
              return (
                <div key={id} style={styles.wareRow}>
                  <span style={{ color: def.color, width: 22, textAlign: "center" }}>
                    {iconOf(def)}
                  </span>
                  <span
                    style={{ flex: 1, color: "#ded5c2", cursor: "default" }}
                    onMouseEnter={() => setInspected(resolveItem(id))}
                  >
                    {def.name}
                    <span style={{ color: "#7d7566", fontSize: 11 }}> — {def.desc}</span>
                  </span>
                  <span style={{ color: affordable ? "#ffcf4d" : "#7d6a3a", width: 70, textAlign: "right" }}>
                    ◈ {price}
                  </span>
                  <button
                    style={{ ...styles.buyButton, ...(affordable ? {} : styles.buyDisabled) }}
                    disabled={!affordable}
                    onClick={() => act.buyItem(id)}
                  >
                    BUY
                  </button>
                </div>
              );
            })}
            {/* The gold sink: gear only, rolled past your checkpoint, juiced
                enchant odds. The dungeon decides; Maro just takes the coin. */}
            <div style={{ ...styles.wareRow, borderColor: "#4a3d5c" }}>
              <span style={{ color: ENCHANT_COLOR, width: 22, textAlign: "center" }}>❖</span>
              <span style={{ flex: 1, color: "#ded5c2" }}>
                Orb of Fortune
                <span style={{ color: "#7d7566", fontSize: 11 }}>
                  {" "}— random gear, rolled beyond your checkpoint · often enchanted
                </span>
              </span>
              <span style={{ color: gold >= GAMBLE_PRICE ? "#ffcf4d" : "#7d6a3a", width: 70, textAlign: "right" }}>
                ◈ {GAMBLE_PRICE}
              </span>
              <button
                style={{
                  ...styles.buyButton,
                  ...(gold >= GAMBLE_PRICE ? { color: "#6a2d9a" } : styles.buyDisabled),
                }}
                disabled={gold < GAMBLE_PRICE}
                onClick={() => act.gamble()}
              >
                TEMPT
              </button>
            </div>
          </div>
        )}

        <div style={styles.footer}>
          drag items to move · drag onto ⤓ to{" "}
          {mode === "merchant" ? "sell" : phase === "dungeon" ? "drop" : "discard"} · Q/E use belt ·
          I closes
        </div>
      </div>
    </div>
  );
}

function toStack(inst: { defId: string; runLoot: boolean } | null): ItemStack | null {
  return inst ? { defId: inst.defId, qty: 1, runLoot: inst.runLoot } : null;
}

// ── Cells ────────────────────────────────────────────────────────────────────

function SlotCell({
  label,
  stack,
  dragRef,
  dragging,
  canDrop,
  onDropItem,
  onBeginDrag,
  onEndDrag,
  onClick,
  onHover,
  accent = false,
  small = false,
}: {
  label?: string;
  stack: ItemStack | null;
  dragRef: SlotRef;
  dragging: SlotRef | null;
  canDrop: (from: SlotRef) => boolean;
  onDropItem: (from: SlotRef) => void;
  onBeginDrag: (ref: SlotRef) => void;
  onEndDrag: () => void;
  onClick?: () => void;
  onHover: (itemId: string | undefined) => void;
  accent?: boolean;
  small?: boolean;
}) {
  const item = stack ? resolveItem(stack.defId) : null;
  const def = item?.def ?? null;
  const size = small ? 42 : 58;
  const droppable = dragging !== null && !refsEqual(dragging, dragRef) && canDrop(dragging);
  return (
    <div style={{ textAlign: "center" }}>
      <button
        draggable={!!def}
        onDragStart={(e: DragEvent) => {
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", item?.name ?? "");
          onBeginDrag(dragRef);
        }}
        onDragEnd={onEndDrag}
        onDragOver={(e: DragEvent) => {
          if (droppable) e.preventDefault();
        }}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          if (dragging && droppable) onDropItem(dragging);
          onEndDrag();
        }}
        style={{
          ...styles.cell,
          width: size,
          height: size,
          ...(accent
            ? { boxShadow: "inset 0 0 0 1px #000, inset 0 3px 5px rgba(0,0,0,0.85), 0 0 0 1px rgba(224,196,128,0.4)" }
            : null),
          ...(droppable
            ? {
                background: "#0e2a20",
                boxShadow: "inset 0 0 0 1px #46ffd0, inset 0 3px 5px rgba(0,0,0,0.6), 0 0 8px rgba(70,255,208,0.35)",
              }
            : null),
          cursor: def ? "grab" : "default",
        }}
        onClick={def && onClick ? onClick : undefined}
        onMouseEnter={() => onHover(stack?.defId)}
        onMouseLeave={() => onHover(undefined)}
      >
        {item && def ? (
          <>
            <span style={{ color: def.color, fontSize: small ? 15 : 20, textShadow: `0 0 8px ${def.color}` }}>
              {iconOf(def)}
            </span>
            {stack!.qty > 1 && <span style={styles.qty}>{stack!.qty}</span>}
            {stack!.runLoot && (
              <span style={styles.runLoot} title="Lost on death until banked">
                ◦
              </span>
            )}
            {item.affix && (
              <span style={styles.enchantMark} title={`Enchanted: ${item.affix.desc}`}>
                ✦
              </span>
            )}
          </>
        ) : (
          <span style={{ color: "#3a3540", fontSize: small ? 12 : 16 }}>·</span>
        )}
      </button>
      {label && <div style={styles.cellLabel}>{label}</div>}
    </div>
  );
}

/** Drag an item here to get rid of it. In the dungeon it drops as real orbs
 * at your feet (floor-mates can grab them — gifting!); in the village it
 * discards; at the merchant it SELLS, showing Maro's offer live. */
function DropZone({
  drag,
  inv,
  mode,
  onDropItem,
}: {
  drag: SlotRef | null;
  inv: Carried;
  mode: "drop" | "discard" | "sell";
  onDropItem: (from: SlotRef) => void;
}) {
  const active =
    drag !== null && !(drag.container === "equipment" && drag.slot === "staff");
  const stack = active && drag ? readSlot(inv, drag) : null;
  const offer =
    mode === "sell" && stack ? (sellValue(stack.defId) ?? 0) * stack.qty : null;
  const hue = mode === "sell" ? "#ffcf4d" : "#d84a4a";
  return (
    <div style={{ textAlign: "center" }}>
      <div
        onDragOver={(e: DragEvent) => {
          if (active) e.preventDefault();
        }}
        onDrop={(e: DragEvent) => {
          e.preventDefault();
          if (drag && active) onDropItem(drag);
        }}
        style={{
          ...styles.cell,
          width: 58,
          height: 58,
          border: `1px dashed ${active ? hue : "#4a3830"}`,
          background: active ? (mode === "sell" ? "#241f10" : "#241214") : "#0c0508",
          color: active ? hue : "#6a5a50",
          fontSize: offer !== null ? 13 : 20,
        }}
      >
        {offer !== null ? `+${offer}◈` : "⤓"}
      </div>
      <div style={styles.cellLabel}>{mode}</div>
    </div>
  );
}

// ── Detail strip with equipped-item comparison ───────────────────────────────

function DetailStrip({
  inspected,
  inv,
  mode,
}: {
  inspected: ResolvedItem | null;
  inv: Carried;
  mode: Exclude<Overlay, "none">;
}) {
  if (!inspected) {
    return (
      <div style={styles.detail}>
        <div style={{ color: "#55505a", fontSize: 12 }}>
          {mode === "chest"
            ? "Drag between bag and chest · click for the quick move"
            : mode === "merchant"
              ? "Everything is banked gold up front — Maro doesn't do credit"
              : "Drag items between slots · click for the quick move"}
        </div>
      </div>
    );
  }
  // What would this replace? Compare against the worn counterpart, with
  // per-stat arrows (▲ strictly better, ▼ worse — including what a swap
  // would give up).
  const def = inspected.def;
  const worn =
    def.slot !== "consumable" ? inv.equipment[def.slot as GearSlot] : null;
  const wornItem =
    worn && worn.defId !== inspected.itemId ? resolveItem(worn.defId) : null;
  return (
    <div style={styles.detail}>
      <div style={{ display: "flex", gap: 24 }}>
        <div style={{ flex: 1 }}>
          <div style={{ color: inspected.affix ? ENCHANT_COLOR : def.color, fontSize: 14 }}>
            {inspected.affix && "✦ "}
            {iconOf(def)} {inspected.name}
            <span style={{ color: "#7d7566", fontSize: 11 }}>{`  ·  tier ${def.tier}`}</span>
          </div>
          {statLines(inspected, wornItem).map((line) => (
            <div key={line.text} style={{ color: "#b9b0a0", fontSize: 12 }}>
              {line.text}
              {line.delta !== undefined && (
                <span style={{ color: line.delta > 0 ? "#7fdc8a" : "#e06a6a" }}>
                  {line.delta > 0 ? " ▲" : " ▼"}
                </span>
              )}
            </div>
          ))}
        </div>
        {wornItem && (
          <div style={{ flex: 1, opacity: 0.62 }}>
            <div style={{ color: "#7d7566", fontSize: 10, letterSpacing: 2 }}>WEARING</div>
            <div style={{ color: wornItem.affix ? ENCHANT_COLOR : wornItem.def.color, fontSize: 13 }}>
              {wornItem.affix && "✦ "}
              {iconOf(wornItem.def)} {wornItem.name}
            </div>
            {statLines(wornItem).map((line) => (
              <div key={line.text} style={{ color: "#b9b0a0", fontSize: 11 }}>
                {line.text}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── The wizard, in the flesh ─────────────────────────────────────────────────
// A tiny second R3F canvas: the SAME WizardModel the multiplayer wizards use,
// on a slow turntable, dressed in what's actually equipped. Rendered at low
// dpr + pixelated upscale so it matches the game's look.

function WizardViewer() {
  const equipment = useGame((s) => s.equipment);
  const staffColor = getItemDef(equipment.staff.defId).color;
  const robeColor = equipment.cloak ? getItemDef(equipment.cloak.defId).color : "#4a4458";
  const bootsColor = equipment.boots ? getItemDef(equipment.boots.defId).color : null;
  const amuletColor = equipment.amulet ? getItemDef(equipment.amulet.defId).color : null;

  return (
    <div style={styles.viewer}>
      <Canvas
        dpr={0.5}
        gl={{ antialias: false, alpha: true }}
        camera={{ position: [0, 0.3, 3.6], fov: 44 }}
        style={{ width: "100%", height: "100%", imageRendering: "pixelated" }}
      >
        {/* Dressing-room lighting: brighter than the dungeon so you can
            actually admire the robe. */}
        <ambientLight intensity={1.15} color="#9aa0c8" />
        <directionalLight position={[2.5, 3, 2]} intensity={2.6} color="#ffd9a8" />
        <directionalLight position={[-3, 1, -2]} intensity={1} color="#46ffd0" />
        <Turntable>
          <WizardModel
            robeColor={robeColor}
            staffColor={staffColor}
            bootsColor={bootsColor}
            amuletColor={amuletColor}
          />
        </Turntable>
      </Canvas>
    </div>
  );
}

function Turntable({ children }: { children: React.ReactNode }) {
  const group = useRef<Group>(null);
  useFrame(({ clock }) => {
    const g = group.current;
    if (!g) return;
    g.rotation.y = clock.elapsedTime * 0.6;
    g.position.y = 0.06 + Math.sin(clock.elapsedTime * 1.7) * 0.03;
  });
  return (
    <group ref={group} position={[0, 0.06, 0]}>
      {children}
    </group>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  backdrop: {
    position: "absolute",
    inset: 0,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background:
      "radial-gradient(ellipse at 50% 45%, rgba(6,3,8,0.5) 0%, rgba(2,1,4,0.85) 85%)",
    pointerEvents: "auto",
  },
  // The pack itself: a slab of stitched hide hanging in the world in front of
  // you — chewed edges, veins, a slow breath (class wm-breathe on the div).
  panel: {
    width: "min(92vw, 640px)",
    maxHeight: "92vh",
    overflowY: "auto",
    padding: "20px 26px 16px",
    letterSpacing: 1,
    ...fleshPanel("pack"),
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    gap: 16,
    borderBottom: "2px solid rgba(0,0,0,0.55)",
    boxShadow: "0 1px 0 rgba(224,212,184,0.08)",
    paddingBottom: 10,
    marginBottom: 14,
  },
  title: { fontSize: 18, letterSpacing: 4, flex: 1, ...scarred },
  gold: { fontSize: 15, color: "#ffcf4d", textShadow: "0 2px 0 #000" },
  close: {
    fontFamily: "'Courier New', monospace",
    fontSize: 14,
    background: "#0c0508",
    color: "#b09a90",
    border: "none",
    boxShadow: "inset 0 0 0 1px #000, 0 0 0 1px rgba(200,180,150,0.25)",
    cursor: "pointer",
    padding: "2px 8px",
  },
  columns: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    gap: 26,
  },
  sideColumn: { display: "flex", flexDirection: "column", gap: 10 },
  // The wizard stands in a dark socket carved out of the graft.
  viewer: {
    width: 190,
    height: 210,
    flexShrink: 0,
    boxShadow: "inset 0 0 0 2px #000, inset 0 4px 12px rgba(0,0,0,0.85), 0 0 0 1px rgba(200,180,150,0.2)",
    background:
      "radial-gradient(ellipse at 50% 62%, rgba(70,60,110,0.35), rgba(4,2,7,0.95) 70%)",
  },
  bagRow: {
    display: "flex",
    justifyContent: "center",
    gap: 10,
    marginTop: 14,
  },
  // Sockets cut into the hide — wounds that hold things.
  cell: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#0c0508",
    border: "none",
    boxShadow: "inset 0 0 0 1px #000, inset 0 3px 5px rgba(0,0,0,0.85), 0 0 0 1px rgba(200,180,150,0.2)",
    fontFamily: "'Courier New', monospace",
    padding: 0,
  },
  cellLabel: { fontSize: 10, color: "#9a8578", marginTop: 3, letterSpacing: 1, textShadow: "0 1px 0 #000" },
  qty: {
    position: "absolute",
    right: 3,
    bottom: 1,
    fontSize: 11,
    color: "#e8dfc8",
    textShadow: "1px 1px 0 #000",
  },
  runLoot: { position: "absolute", left: 3, top: 0, fontSize: 12, color: "#c8a23c" },
  enchantMark: { position: "absolute", right: 3, top: 0, fontSize: 10, color: "#c9a5ff" },
  // The appraisal strip: a deeper cut under the sockets.
  detail: {
    minHeight: 58,
    marginTop: 12,
    padding: "8px 12px",
    background: "#0c0508",
    boxShadow: "inset 0 0 0 1px #000, inset 0 3px 6px rgba(0,0,0,0.8), 0 0 0 1px rgba(200,180,150,0.16)",
  },
  chestGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(6, 1fr)",
    gap: 8,
    marginTop: 12,
    justifyItems: "center",
  },
  wares: { marginTop: 12, display: "flex", flexDirection: "column", gap: 6 },
  // Maro's ledger: lines gouged into the hide.
  wareRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "7px 10px",
    background: "#0c0508",
    boxShadow: "inset 0 0 0 1px #000, inset 0 2px 4px rgba(0,0,0,0.7), 0 0 0 1px rgba(200,180,150,0.14)",
    fontSize: 13,
  },
  buyButton: {
    ...boneButton("buy"),
    fontSize: 12,
    padding: "5px 14px",
  },
  buyDisabled: { opacity: 0.4, cursor: "default" },
  footer: { marginTop: 12, fontSize: 10, color: "#8a7568", textAlign: "center", letterSpacing: 2, textShadow: "0 1px 0 #000" },
};
