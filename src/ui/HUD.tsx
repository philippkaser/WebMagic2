import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { PLAYER } from "../core/config";
import { gameEvents } from "../core/events";
import { computeStats, resolveItem } from "../items/catalog";
import type { GearSlot, ItemStack } from "../items/types";
import { floorPlayerCount, selectIsHost, useNet } from "../net/netStore";
import { entryFloors, useGame } from "../state/gameStore";
import { DevRoom } from "./DevRoom";
import { InventoryScreen } from "./InventoryScreen";
import { ITEM_ICONS, iconOf } from "./itemInfo";

/** All DOM UI: crosshair, bars, prompts, message feed, and the fullscreen
 * overlays for menu / portal select / death. */
export function HUD() {
  const phase = useGame((s) => s.phase);
  const overlay = useGame((s) => s.overlay);
  const [showPerf, setShowPerf] = useState(false);

  // Leaving gameplay or opening an overlay always releases the pointer.
  useEffect(() => {
    const playing = phase === "village" || phase === "dungeon";
    if ((!playing || overlay !== "none") && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, [phase, overlay]);

  // Global quality/debug hotkeys. Letter keys are primary — macOS reserves
  // F-keys (Mission Control, Spotlight) so they often never reach the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return; // typing a name
      if (e.code === "KeyP" || e.code === "F3") {
        e.preventDefault();
        setShowPerf((v) => !v);
      } else if (e.code === "KeyO" || e.code === "F4") {
        e.preventDefault();
        useGame.getState().toggleShadows();
      } else if (e.code === "KeyI" || e.code === "Tab") {
        const state = useGame.getState();
        if (state.phase !== "village" && state.phase !== "dungeon") return;
        e.preventDefault();
        if (state.overlay === "none") {
          document.exitPointerLock();
          state.setOverlay("inventory");
        } else {
          state.setOverlay("none");
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const playing = phase === "village" || phase === "dungeon";
  return (
    <div style={styles.root}>
      <style>{css}</style>
      <div style={styles.buildStamp}>{__BUILD_INFO__}</div>
      {showPerf && <PerfOverlay />}
      {playing && <PlayHud />}
      {playing && overlay === "devroom" && import.meta.env.DEV && <DevRoom />}
      {playing && overlay !== "none" && overlay !== "devroom" && <InventoryScreen mode={overlay} />}
      {phase === "menu" && <MenuOverlay />}
      {phase === "select" && <SelectOverlay />}
      {phase === "dead" && <DeathOverlay />}
      {phase === "loading" && (
        <Overlay>
          <div style={styles.title}>DESCENDING…</div>
        </Overlay>
      )}
    </div>
  );
}

// ── In-game HUD ───────────────────────────────────────────────────────────────

function PlayHud() {
  const phase = useGame((s) => s.phase);
  const floor = useGame((s) => s.floor);
  const instanceId = useGame((s) => s.instanceId);
  const checkpoint = useGame((s) => s.checkpoint);
  const health = useGame((s) => s.health);
  const mana = useGame((s) => s.mana);
  const equipment = useGame((s) => s.equipment);
  const belt = useGame((s) => s.belt);
  const gold = useGame((s) => s.gold);
  const runGold = useGame((s) => s.runGold);
  const prompt = useGame((s) => s.prompt);
  const floorPlayers = useNet(floorPlayerCount);
  const amHost = useNet(selectIsHost);
  const netMode = useNet((s) => s.mode);
  const overlay = useGame((s) => s.overlay);
  const stats = computeStats(equipment);
  const locked = usePointerLocked();

  return (
    <>
      {/* Crosshair */}
      <div style={styles.crosshair} />
      <ChargeMeter />
      <HurtFlash />
      <BossBar />

      {/* Top-left: location */}
      <div style={{ ...styles.panel, top: 14, left: 14 }}>
        {phase === "dungeon" ? (
          <>
            <div style={{ fontSize: 18, color: "#e8dfc8" }}>FLOOR {floor}</div>
            <div style={styles.dim}>
              instance {instanceId || "—"}
              {netMode === "online" &&
                ` · ${floorPlayers} wizard${floorPlayers === 1 ? "" : "s"}`}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 18, color: "#e8dfc8" }}>THE VILLAGE</div>
        )}
        <div style={styles.dim}>checkpoint: floor {checkpoint}</div>
        <div style={{ ...styles.dim, color: netMode === "online" ? "#4fd08a" : "#7d7566" }}>
          {netMode === "online"
            ? `◉ online${amHost && phase === "dungeon" ? " · host" : ""}`
            : netMode === "offline"
              ? "○ offline"
              : "◌ connecting"}
        </div>
      </div>

      <MessageFeed />

      {/* Bottom-left: vitals, purse and belt */}
      <div style={{ ...styles.panel, bottom: 16, left: 14, width: 240 }}>
        <Bar label="HP" value={health} max={stats.maxHealth} color="#d84a4a" />
        <Bar label="MP" value={mana} max={PLAYER.maxMana} color="#4a86d8" />
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 2 }}>
          <span style={{ fontSize: 13, color: "#ffcf4d" }}>
            ◈ {gold}
            {runGold > 0 && (
              <span style={{ color: "#c8a23c" }} title="Unbanked — lost on death">
                {" "}+{runGold}◦
              </span>
            )}
          </span>
          <span style={{ display: "flex", gap: 6 }}>
            <BeltSlot hotkey="Q" stack={belt[0]} />
            <BeltSlot hotkey="E" stack={belt[1]} />
          </span>
        </div>
      </div>

      {/* Bottom-right: equipment */}
      <div style={{ ...styles.panel, bottom: 16, right: 14, textAlign: "right" }}>
        <EquipRow slot="staff" defId={equipment.staff.defId} runLoot={equipment.staff.runLoot} />
        <EquipRow slot="amulet" defId={equipment.amulet?.defId} runLoot={equipment.amulet?.runLoot} />
        <EquipRow slot="cloak" defId={equipment.cloak?.defId} runLoot={equipment.cloak?.runLoot} />
        <EquipRow slot="boots" defId={equipment.boots?.defId} runLoot={equipment.boots?.runLoot} />
        <div style={{ fontSize: 10, color: "#55505a", marginTop: 3 }}>I — inventory</div>
      </div>

      {/* Interaction prompt / lock hint */}
      {locked && prompt && <div style={styles.prompt}>{prompt}</div>}
      {!locked && overlay === "none" && (
        <div style={styles.prompt}>Click to take control — WASD move · Space jump · Mouse casts</div>
      )}
    </>
  );
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#b9b0a0" }}>
        <span>{label}</span>
        <span>
          {Math.ceil(value)} / {Math.round(max)}
        </span>
      </div>
      <div style={{ height: 10, background: "#151218", border: "1px solid #3a333d" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`,
            background: color,
            transition: "width 120ms linear",
          }}
        />
      </div>
    </div>
  );
}

function BeltSlot({ hotkey, stack }: { hotkey: string; stack: ItemStack | null }) {
  const item = stack ? resolveItem(stack.defId) : null;
  const def = item?.def ?? null;
  return (
    <span
      title={item ? `${hotkey} — ${item.name}` : `${hotkey} — empty (assign in inventory)`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "1px 5px",
        border: "1px solid #3a333d",
        background: "#151218",
        fontSize: 11,
        color: def ? "#ded5c2" : "#55505a",
      }}
    >
      <span style={{ color: "#7d7566" }}>{hotkey}</span>
      {def ? (
        <>
          <span style={{ color: def.color }}>{iconOf(def)}</span>
          {stack!.qty > 1 && <span>{stack!.qty}</span>}
        </>
      ) : (
        <span>·</span>
      )}
    </span>
  );
}

function EquipRow({ slot, defId, runLoot }: { slot: GearSlot; defId?: string; runLoot?: boolean }) {
  const item = defId ? resolveItem(defId) : null;
  return (
    <div style={{ fontSize: 12, marginBottom: 4, color: item ? "#ded5c2" : "#55505a" }}>
      {item ? (
        <>
          {runLoot && <span style={{ color: "#c8a23c" }} title="Lost on death until banked">◦ </span>}
          {item.affix && <span style={{ color: "#c9a5ff" }} title={item.affix.desc}>✦ </span>}
          <span>{item.name}</span>{" "}
          <span style={{ color: item.def.color }}>{ITEM_ICONS[slot]}</span>
        </>
      ) : (
        <>
          <span>— no {slot} —</span> <span>{ITEM_ICONS[slot]}</span>
        </>
      )}
    </div>
  );
}

function MessageFeed() {
  const [messages, setMessages] = useState<{ id: number; text: string }[]>([]);
  useEffect(() => {
    let nextId = 1;
    return gameEvents.on("message", (text) => {
      const id = nextId++;
      setMessages((prev) => [...prev.slice(-4), { id, text }]);
      setTimeout(() => setMessages((prev) => prev.filter((m) => m.id !== id)), 5000);
    });
  }, []);
  return (
    <div style={styles.feed}>
      {messages.map((m) => (
        <div key={m.id} className="wm-msg">
          {m.text}
        </div>
      ))}
    </div>
  );
}

function BossBar() {
  const [boss, setBoss] = useState<{ name: string; frac: number } | null>(null);
  useEffect(() => gameEvents.on("bossHp", setBoss), []);
  if (!boss) return null;
  return (
    <div style={styles.bossBar}>
      <div style={{ fontSize: 13, letterSpacing: 4, color: "#ff6a52", marginBottom: 4 }}>
        {boss.name}
      </div>
      <div style={{ height: 12, background: "#170a0a", border: "1px solid #5a2a24" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.max(0, boss.frac * 100)}%`,
            background: "linear-gradient(#ff5136, #8a1d10)",
            transition: "width 150ms linear",
          }}
        />
      </div>
    </div>
  );
}

/** Thin arc under the crosshair while holding a charged ability (the laser
 * staff): fills with charge, flares white when full. */
function ChargeMeter() {
  const [frac, setFrac] = useState(0);
  useEffect(() => gameEvents.on("charge", setFrac), []);
  if (frac <= 0) return null;
  const full = frac >= 0.999;
  return (
    <div style={styles.chargeTrack}>
      <div
        style={{
          ...styles.chargeFill,
          width: `${Math.round(frac * 100)}%`,
          background: full ? "#ffffff" : "#ffb35d",
          boxShadow: full ? "0 0 8px #fff" : "0 0 4px #ffb35d88",
        }}
      />
    </div>
  );
}

function HurtFlash() {
  const [flashId, setFlashId] = useState(0);
  useEffect(
    () => gameEvents.on("playerHurt", () => setFlashId((n) => n + 1)),
    [],
  );
  if (flashId === 0) return null;
  return <div key={flashId} className="wm-hurt" style={styles.hurt} />;
}

/** F3: rolling frame-time stats so perf reports are numbers, not vibes. */
function PerfOverlay() {
  const [stats, setStats] = useState({ fps: 0, p95: 0, worst: 0 });
  useEffect(() => {
    let deltas: number[] = [];
    let last = performance.now();
    let lastFlush = last;
    let raf = 0;
    const tick = (now: number) => {
      deltas.push(now - last);
      last = now;
      if (now - lastFlush > 500) {
        const sorted = [...deltas].sort((a, b) => a - b);
        const sum = sorted.reduce((a, b) => a + b, 0);
        setStats({
          fps: Math.round((sorted.length / sum) * 1000),
          p95: Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0),
          worst: Math.round(sorted[sorted.length - 1] ?? 0),
        });
        deltas = [];
        lastFlush = now;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return (
    <div style={{ ...styles.panel, top: 110, left: 14, fontSize: 12, color: "#8fe3a0" }}>
      {stats.fps} fps · p95 {stats.p95}ms · worst {stats.worst}ms
    </div>
  );
}

function usePointerLocked(): boolean {
  const [locked, setLocked] = useState(!!document.pointerLockElement);
  useEffect(() => {
    const update = () => setLocked(!!document.pointerLockElement);
    document.addEventListener("pointerlockchange", update);
    return () => document.removeEventListener("pointerlockchange", update);
  }, []);
  return locked;
}

// ── Overlays ─────────────────────────────────────────────────────────────────

function Overlay({ children }: { children: ReactNode }) {
  return <div style={styles.overlay}>{children}</div>;
}

function MenuOverlay() {
  const startGame = useGame((s) => s.startGame);
  const shadows = useGame((s) => s.shadows);
  const toggleShadows = useGame((s) => s.toggleShadows);
  const playerName = useGame((s) => s.playerName);
  const setPlayerName = useGame((s) => s.setPlayerName);
  return (
    <Overlay>
      <div style={styles.title}>WEBMAGIC</div>
      <div style={styles.subtitle}>Dungeon of the Hundred Floors</div>
      <p style={styles.blurb}>
        For glory, fame and riches — and to find god at the bottom — the wizards
        of the village step through the portal. One hundred floors down. Leave
        only every fifth floor. Die, and everything you found goes with you.
      </p>
      <div style={{ marginBottom: 18 }}>
        <div style={{ fontSize: 11, letterSpacing: 2, color: "#7d7566", marginBottom: 5 }}>
          YOUR NAME
        </div>
        <input
          style={styles.nameInput}
          defaultValue={playerName}
          maxLength={16}
          spellCheck={false}
          onBlur={(e) => setPlayerName(e.target.value)}
          onKeyDown={(e) => {
            e.stopPropagation(); // typing must not trigger game hotkeys
            if (e.key === "Enter") (e.target as HTMLInputElement).blur();
          }}
        />
      </div>
      <button style={styles.button} onClick={startGame}>
        ENTER THE VILLAGE
      </button>
      <button
        style={{ ...styles.button, marginTop: 14, fontSize: 13, borderColor: "#5a5560", color: "#b8afa0" }}
        onClick={toggleShadows}
      >
        SHADOWS: {shadows ? "ON" : "OFF"}
      </button>
      <div style={styles.controls}>
        WASD move · Space jump · Left/Right click cast · Shift dash (cloak) · E interact
        <br />
        I inventory · Q/E use belt items · P fps overlay · O shadows
      </div>
    </Overlay>
  );
}

function SelectOverlay() {
  const checkpoint = useGame((s) => s.checkpoint);
  const enterDungeon = useGame((s) => s.enterDungeon);
  const closePortalSelect = useGame((s) => s.closePortalSelect);
  return (
    <Overlay>
      <div style={styles.subtitle}>CHOOSE YOUR ENTRY FLOOR</div>
      <p style={{ ...styles.blurb, marginTop: 4 }}>
        You may begin from any checkpoint you have banked at.
      </p>
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", maxWidth: 480 }}>
        {entryFloors(checkpoint).map((f) => (
          <button key={f} style={styles.button} onClick={() => void enterDungeon(f)}>
            FLOOR {f}
          </button>
        ))}
      </div>
      <button style={{ ...styles.button, marginTop: 22, borderColor: "#5a5560", color: "#9a94a0" }} onClick={closePortalSelect}>
        STAY IN THE VILLAGE
      </button>
    </Overlay>
  );
}

function DeathOverlay() {
  const lastDeath = useGame((s) => s.lastDeath);
  const respawn = useGame((s) => s.respawn);
  return (
    <Overlay>
      <div style={{ ...styles.title, color: "#c23a3a" }}>YOU DIED</div>
      <div style={styles.subtitle}>on floor {lastDeath?.floor ?? "?"}</div>
      {lastDeath && (lastDeath.lostItems.length > 0 || lastDeath.lostGold > 0) ? (
        <p style={styles.blurb}>
          The dungeon keeps what you carried:{" "}
          <span style={{ color: "#c8a23c" }}>
            {[
              ...lastDeath.lostItems,
              ...(lastDeath.lostGold > 0 ? [`${lastDeath.lostGold} gold`] : []),
            ].join(", ")}
          </span>
        </p>
      ) : (
        <p style={styles.blurb}>You carried nothing the dungeon could take.</p>
      )}
      <button style={styles.button} onClick={respawn}>
        RETURN TO THE VILLAGE
      </button>
    </Overlay>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, CSSProperties> = {
  root: {
    position: "fixed",
    inset: 0,
    pointerEvents: "none",
    fontFamily: "'Courier New', monospace",
    color: "#cfc6b4",
    userSelect: "none",
    zIndex: 10,
  },
  crosshair: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 6,
    height: 6,
    marginLeft: -3,
    marginTop: -3,
    borderRadius: "50%",
    background: "rgba(240,235,220,0.85)",
    boxShadow: "0 0 4px rgba(0,0,0,0.9)",
  },
  chargeTrack: {
    position: "absolute",
    top: "calc(50% + 16px)",
    left: "50%",
    width: 64,
    height: 4,
    marginLeft: -32,
    background: "rgba(8,6,12,0.7)",
    border: "1px solid #3f3946",
  },
  chargeFill: {
    height: "100%",
    transition: "width 40ms linear",
  },
  panel: {
    position: "absolute",
    padding: "10px 12px",
    background: "rgba(8,6,12,0.62)",
    border: "1px solid #2f2a36",
    letterSpacing: 1,
  },
  dim: { fontSize: 11, color: "#7d7566", marginTop: 2 },
  prompt: {
    position: "absolute",
    bottom: "22%",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "8px 16px",
    background: "rgba(8,6,12,0.75)",
    border: "1px solid #3f3946",
    fontSize: 14,
    letterSpacing: 1,
    whiteSpace: "nowrap",
  },
  feed: {
    position: "absolute",
    top: 14,
    right: 14,
    textAlign: "right",
    fontSize: 13,
    letterSpacing: 0.5,
  },
  hurt: {
    position: "absolute",
    inset: 0,
    boxShadow: "inset 0 0 120px 40px rgba(180,20,20,0.55)",
  },
  bossBar: {
    position: "absolute",
    top: 20,
    left: "50%",
    transform: "translateX(-50%)",
    width: "min(46vw, 520px)",
    textAlign: "center",
  },
  buildStamp: {
    position: "absolute",
    bottom: 2,
    right: 8,
    fontSize: 10,
    letterSpacing: 1,
    color: "#4d4756",
    textShadow: "1px 1px 0 #000",
  },
  overlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(5,3,9,0.88)",
    pointerEvents: "auto",
    textAlign: "center",
    padding: 24,
  },
  title: {
    fontSize: 52,
    letterSpacing: 10,
    color: "#e8dfc8",
    textShadow: "0 0 18px rgba(70,255,208,0.35), 3px 3px 0 #1a1420",
  },
  subtitle: { fontSize: 18, letterSpacing: 4, color: "#8f86a0", marginTop: 8 },
  blurb: { maxWidth: 460, fontSize: 14, lineHeight: 1.6, color: "#a89e8c", margin: "18px 0" },
  button: {
    fontFamily: "'Courier New', monospace",
    fontSize: 16,
    letterSpacing: 2,
    padding: "12px 26px",
    background: "#120e1a",
    color: "#e8dfc8",
    border: "1px solid #46ffd0",
    cursor: "pointer",
  },
  nameInput: {
    fontFamily: "'Courier New', monospace",
    fontSize: 16,
    letterSpacing: 2,
    padding: "9px 14px",
    background: "#120e1a",
    color: "#e8dfc8",
    border: "1px solid #3f3946",
    textAlign: "center",
    outline: "none",
    width: 220,
  },
  controls: { marginTop: 26, fontSize: 12, color: "#6d6478", letterSpacing: 1 },
};

const css = `
.wm-msg { animation: wm-fade 5s forwards; padding: 3px 8px; background: rgba(8,6,12,0.55); margin-bottom: 4px; border-right: 2px solid #46ffd0; }
@keyframes wm-fade { 0% { opacity: 0; transform: translateX(8px);} 6% { opacity: 1; transform: none;} 80% { opacity: 1;} 100% { opacity: 0;} }
.wm-hurt { animation: wm-hurt-fade 500ms forwards; }
@keyframes wm-hurt-fade { from { opacity: 1; } to { opacity: 0; } }
button:hover { background: #1c1628 !important; }
`;
