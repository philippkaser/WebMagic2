import { useEffect, useState, type CSSProperties } from "react";
import { getItemDef } from "../items/catalog";
import { MERCHANT_STOCK } from "../items/economy";
import type { ItemDef, ItemStack } from "../items/types";
import { useGame, type Overlay } from "../state/gameStore";
import { statLines } from "./itemInfo";

/** The inventory screen family. One layout, three flavors:
 *  - "inventory": the wizard, gear, belt and bag
 *  - "chest":     inventory + the 30-slot village chest below
 *  - "merchant":  inventory + Maro's ware list below
 * The screen only calls store actions — every rule about what may move where
 * lives in the game store (and is re-validated server-side). */
export function InventoryScreen({ mode }: { mode: Exclude<Overlay, "none"> }) {
  const equipment = useGame((s) => s.equipment);
  const bag = useGame((s) => s.bag);
  const belt = useGame((s) => s.belt);
  const chest = useGame((s) => s.chest);
  const gold = useGame((s) => s.gold);
  const runGold = useGame((s) => s.runGold);
  const phase = useGame((s) => s.phase);
  const [inspected, setInspected] = useState<ItemDef | null>(null);

  // Escape (already unlocks the pointer) also closes the screen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "Escape") useGame.getState().setOverlay("none");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const inspect = (defId: string | undefined) =>
    setInspected(defId ? getItemDef(defId) : null);
  const act = useGame.getState();
  const inVillage = phase === "village";

  const title =
    mode === "chest" ? "YOUR CHEST" : mode === "merchant" ? "MARO THE PROVISIONER" : "INVENTORY";

  return (
    <div style={styles.backdrop}>
      <div style={styles.panel}>
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
              stack={{ defId: equipment.staff.defId, qty: 1, runLoot: equipment.staff.runLoot }}
              onHover={inspect}
            />
            <SlotCell
              label="Q"
              stack={belt[0]}
              onHover={inspect}
              onClick={() => act.moveBeltToBag(0)}
              accent
            />
            <SlotCell
              label="E"
              stack={belt[1]}
              onHover={inspect}
              onClick={() => act.moveBeltToBag(1)}
              accent
            />
          </div>

          <WizardPortrait />

          {/* Right: gear */}
          <div style={styles.sideColumn}>
            <SlotCell
              label="amulet"
              stack={toStack(equipment.amulet)}
              onHover={inspect}
              onClick={() => act.unequipToBag("amulet")}
            />
            <SlotCell
              label="cloak"
              stack={toStack(equipment.cloak)}
              onHover={inspect}
              onClick={() => act.unequipToBag("cloak")}
            />
            <SlotCell
              label="boots"
              stack={{ defId: equipment.boots.defId, qty: 1, runLoot: equipment.boots.runLoot }}
              onHover={inspect}
            />
          </div>
        </div>

        {/* Bag */}
        <div style={styles.bagRow}>
          {bag.map((stack, i) => (
            <SlotCell
              key={i}
              label={`${i + 1}`}
              stack={stack}
              onHover={inspect}
              onClick={() =>
                mode === "chest" && inVillage ? act.moveBagToChest(i) : act.equipFromBag(i)
              }
            />
          ))}
        </div>

        {/* Detail strip: the stats of whatever the cursor is over. */}
        <div style={styles.detail}>
          {inspected ? (
            <>
              <div style={{ color: inspected.color, fontSize: 14 }}>
                {inspected.name}
                <span style={{ color: "#7d7566", fontSize: 11 }}>
                  {"  ·  "}
                  {"tier " + inspected.tier}
                </span>
              </div>
              {statLines(inspected).map((line) => (
                <div key={line} style={{ color: "#b9b0a0", fontSize: 12 }}>
                  {line}
                </div>
              ))}
            </>
          ) : (
            <div style={{ color: "#55505a", fontSize: 12 }}>
              {mode === "chest"
                ? "Click bag items to store them · click chest items to take them"
                : mode === "merchant"
                  ? "Everything is banked gold up front — Maro doesn't do credit"
                  : "Click bag items to equip · click Q/E to unassign"}
            </div>
          )}
        </div>

        {mode === "chest" && (
          <div style={styles.chestGrid}>
            {chest.map((stack, i) => (
              <SlotCell
                key={i}
                small
                stack={stack}
                onHover={inspect}
                onClick={() => act.moveChestToBag(i)}
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
                  <span style={{ color: def.color, width: 22, textAlign: "center" }}>◆</span>
                  <span
                    style={{ flex: 1, color: "#ded5c2", cursor: "default" }}
                    onMouseEnter={() => inspect(id)}
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
          </div>
        )}

        <div style={styles.footer}>Q / E use belt items · I closes</div>
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
  onClick,
  onHover,
  accent = false,
  small = false,
}: {
  label?: string;
  stack: ItemStack | null;
  onClick?: () => void;
  onHover: (defId: string | undefined) => void;
  accent?: boolean;
  small?: boolean;
}) {
  const def = stack ? getItemDef(stack.defId) : null;
  const size = small ? 42 : 58;
  return (
    <div style={{ textAlign: "center" }}>
      <button
        style={{
          ...styles.cell,
          width: size,
          height: size,
          borderColor: accent ? "#4a4436" : "#2f2a36",
          cursor: def && onClick ? "pointer" : "default",
        }}
        onClick={def && onClick ? onClick : undefined}
        onMouseEnter={() => onHover(def?.id)}
        onMouseLeave={() => onHover(undefined)}
      >
        {def ? (
          <>
            <span style={{ color: def.color, fontSize: small ? 16 : 22, textShadow: `0 0 8px ${def.color}` }}>
              ◆
            </span>
            {stack!.qty > 1 && <span style={styles.qty}>{stack!.qty}</span>}
            {stack!.runLoot && (
              <span style={styles.runLoot} title="Lost on death until banked">
                ◦
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

// ── The wizard portrait ──────────────────────────────────────────────────────
// Pixel-art in code (the zero-asset rule): a char-map "sprite" rendered as
// SVG rects. The palette is LIVE — robe, boots, crystal and amulet pixels
// take the colors of what's actually equipped.

const SPRITE = [
  "......HHH.......",
  ".....HHHHH......",
  "....HHHHHHH.....",
  "...HHHHHHHHH....",
  "..HHHHHHHHHHH...",
  "......SSS.....CC",
  ".....SESES....CC",
  "......SSS......T",
  ".....RRARR.....T",
  "....RRRARRR....T",
  "...RRRRRRRRR..GT",
  "...RRRRRRRRR...T",
  "..RRRRRRRRRRR..T",
  "..RRRRRRRRRRR..T",
  ".RRRRRRRRRRRRR.T",
  ".RRRRRRRRRRRRR.T",
  "..BB.......BB..T",
  "..BB.......BB...",
];

function WizardPortrait() {
  const equipment = useGame((s) => s.equipment);
  const staffColor = getItemDef(equipment.staff.defId).color;
  const robe = equipment.cloak ? getItemDef(equipment.cloak.defId).color : "#4a4458";
  const boots = getItemDef(equipment.boots.defId).color;
  const amulet = equipment.amulet ? getItemDef(equipment.amulet.defId).color : null;

  const palette: Record<string, string> = {
    H: "#33284a",
    S: "#d8b894",
    E: "#7fd4ff",
    R: robe,
    A: amulet ?? robe,
    B: boots,
    T: "#4a3526",
    G: "#d8b894",
    C: staffColor,
  };

  return (
    <svg
      viewBox="0 0 16 18"
      width={170}
      height={192}
      style={{ imageRendering: "pixelated", flexShrink: 0 }}
      shapeRendering="crispEdges"
    >
      {/* Crystal glow */}
      <circle cx={15} cy={6} r={2.3} fill={staffColor} opacity={0.2} />
      {amulet && <circle cx={7.5} cy={9} r={1.6} fill={amulet} opacity={0.3} />}
      {SPRITE.flatMap((row, y) =>
        [...row].map((ch, x) =>
          ch === "." ? null : (
            <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill={palette[ch]} />
          ),
        ),
      )}
    </svg>
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
    background: "rgba(5,3,9,0.78)",
    pointerEvents: "auto",
  },
  panel: {
    width: "min(92vw, 620px)",
    maxHeight: "92vh",
    overflowY: "auto",
    background: "rgba(12,9,18,0.96)",
    border: "1px solid #3f3946",
    padding: "16px 22px 12px",
    letterSpacing: 1,
  },
  header: {
    display: "flex",
    alignItems: "baseline",
    gap: 16,
    borderBottom: "1px solid #2f2a36",
    paddingBottom: 10,
    marginBottom: 14,
  },
  title: { fontSize: 18, letterSpacing: 4, color: "#e8dfc8", flex: 1 },
  gold: { fontSize: 15, color: "#ffcf4d" },
  close: {
    fontFamily: "'Courier New', monospace",
    fontSize: 14,
    background: "none",
    color: "#8f86a0",
    border: "1px solid #3f3946",
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
  bagRow: {
    display: "flex",
    justifyContent: "center",
    gap: 10,
    marginTop: 14,
  },
  cell: {
    position: "relative",
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    background: "#151218",
    border: "1px solid #2f2a36",
    fontFamily: "'Courier New', monospace",
    padding: 0,
  },
  cellLabel: { fontSize: 10, color: "#7d7566", marginTop: 3, letterSpacing: 1 },
  qty: {
    position: "absolute",
    right: 3,
    bottom: 1,
    fontSize: 11,
    color: "#e8dfc8",
    textShadow: "1px 1px 0 #000",
  },
  runLoot: { position: "absolute", left: 3, top: 0, fontSize: 12, color: "#c8a23c" },
  detail: {
    minHeight: 52,
    marginTop: 12,
    padding: "8px 12px",
    background: "#0d0a13",
    border: "1px solid #2f2a36",
  },
  chestGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(6, 1fr)",
    gap: 8,
    marginTop: 12,
    justifyItems: "center",
  },
  wares: { marginTop: 12, display: "flex", flexDirection: "column", gap: 6 },
  wareRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "7px 10px",
    background: "#0d0a13",
    border: "1px solid #2f2a36",
    fontSize: 13,
  },
  buyButton: {
    fontFamily: "'Courier New', monospace",
    fontSize: 12,
    letterSpacing: 2,
    padding: "5px 14px",
    background: "#120e1a",
    color: "#e8dfc8",
    border: "1px solid #46ffd0",
    cursor: "pointer",
  },
  buyDisabled: { borderColor: "#3a3540", color: "#55505a", cursor: "default" },
  footer: { marginTop: 12, fontSize: 10, color: "#55505a", textAlign: "center", letterSpacing: 2 },
};
