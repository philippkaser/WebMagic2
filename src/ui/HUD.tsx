import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { PLAYER } from "../core/config";
import { gameEvents } from "../core/events";
import { computeStats, getItemDef } from "../items/catalog";
import type { Slot } from "../items/types";
import { session } from "../net/session";
import { entryFloors, useGame } from "../state/gameStore";

/** All DOM UI: crosshair, bars, prompts, message feed, and the fullscreen
 * overlays for menu / portal select / death. */
export function HUD() {
  const phase = useGame((s) => s.phase);
  const [showPerf, setShowPerf] = useState(false);

  // Leaving gameplay always releases the pointer.
  useEffect(() => {
    if (phase !== "village" && phase !== "dungeon" && document.pointerLockElement) {
      document.exitPointerLock();
    }
  }, [phase]);

  // Global quality/debug hotkeys.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "F3") {
        e.preventDefault();
        setShowPerf((v) => !v);
      } else if (e.code === "F4") {
        e.preventDefault();
        useGame.getState().toggleShadows();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div style={styles.root}>
      <style>{css}</style>
      {showPerf && <PerfOverlay />}
      {(phase === "village" || phase === "dungeon") && <PlayHud />}
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
  const prompt = useGame((s) => s.prompt);
  const stats = computeStats(equipment);
  const locked = usePointerLocked();

  return (
    <>
      {/* Crosshair */}
      <div style={styles.crosshair} />
      <HurtFlash />
      <BossBar />

      {/* Top-left: location */}
      <div style={{ ...styles.panel, top: 14, left: 14 }}>
        {phase === "dungeon" ? (
          <>
            <div style={{ fontSize: 18, color: "#e8dfc8" }}>FLOOR {floor}</div>
            <div style={styles.dim}>instance {instanceId || "—"}</div>
          </>
        ) : (
          <div style={{ fontSize: 18, color: "#e8dfc8" }}>THE VILLAGE</div>
        )}
        <div style={styles.dim}>checkpoint: floor {checkpoint}</div>
        <div style={{ ...styles.dim, color: session.mode === "online" ? "#4fd08a" : "#7d7566" }}>
          {session.mode === "online" ? "◉ online" : session.mode === "offline" ? "○ offline" : "◌ connecting"}
        </div>
      </div>

      <MessageFeed />

      {/* Bottom-left: vitals */}
      <div style={{ ...styles.panel, bottom: 16, left: 14, width: 240 }}>
        <Bar label="HP" value={health} max={stats.maxHealth} color="#d84a4a" />
        <Bar label="MP" value={mana} max={PLAYER.maxMana} color="#4a86d8" />
      </div>

      {/* Bottom-right: equipment */}
      <div style={{ ...styles.panel, bottom: 16, right: 14, textAlign: "right" }}>
        <EquipRow slot="staff" defId={equipment.staff.defId} runLoot={equipment.staff.runLoot} />
        <EquipRow slot="amulet" defId={equipment.amulet?.defId} runLoot={equipment.amulet?.runLoot} />
        <EquipRow slot="cloak" defId={equipment.cloak?.defId} runLoot={equipment.cloak?.runLoot} />
        <EquipRow slot="boots" defId={equipment.boots.defId} runLoot={equipment.boots.runLoot} />
      </div>

      {/* Interaction prompt / lock hint */}
      {locked && prompt && <div style={styles.prompt}>{prompt}</div>}
      {!locked && (
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

const SLOT_ICONS: Record<Slot, string> = { staff: "⚚", amulet: "◈", cloak: "▲", boots: "⬢" };

function EquipRow({ slot, defId, runLoot }: { slot: Slot; defId?: string; runLoot?: boolean }) {
  const def = defId ? getItemDef(defId) : null;
  return (
    <div style={{ fontSize: 12, marginBottom: 4, color: def ? "#ded5c2" : "#55505a" }}>
      {def ? (
        <>
          {runLoot && <span style={{ color: "#c8a23c" }} title="Lost on death until banked">◦ </span>}
          <span>{def.name}</span>{" "}
          <span style={{ color: def.color }}>{SLOT_ICONS[slot]}</span>
        </>
      ) : (
        <>
          <span>— no {slot} —</span> <span>{SLOT_ICONS[slot]}</span>
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
  return (
    <Overlay>
      <div style={styles.title}>WEBMAGIC</div>
      <div style={styles.subtitle}>Dungeon of the Hundred Floors</div>
      <p style={styles.blurb}>
        For glory, fame and riches — and to find god at the bottom — the wizards
        of the village step through the portal. One hundred floors down. Leave
        only every fifth floor. Die, and everything you found goes with you.
      </p>
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
        F3 fps overlay · F4 shadows
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
      {lastDeath && lastDeath.lostItems.length > 0 ? (
        <p style={styles.blurb}>
          The dungeon keeps what you carried:{" "}
          <span style={{ color: "#c8a23c" }}>{lastDeath.lostItems.join(", ")}</span>
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
  controls: { marginTop: 26, fontSize: 12, color: "#6d6478", letterSpacing: 1 },
};

const css = `
.wm-msg { animation: wm-fade 5s forwards; padding: 3px 8px; background: rgba(8,6,12,0.55); margin-bottom: 4px; border-right: 2px solid #46ffd0; }
@keyframes wm-fade { 0% { opacity: 0; transform: translateX(8px);} 6% { opacity: 1; transform: none;} 80% { opacity: 1;} 100% { opacity: 0;} }
.wm-hurt { animation: wm-hurt-fade 500ms forwards; }
@keyframes wm-hurt-fade { from { opacity: 1; } to { opacity: 0; } }
button:hover { background: #1c1628 !important; }
`;
