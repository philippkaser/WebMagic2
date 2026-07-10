import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { PLAYER } from "../core/config";
import { gameEvents } from "../core/events";
import { Rng, hashSeed } from "../core/rng";
import { computeStats, getItemDef } from "../items/catalog";
import type { Slot } from "../items/types";
import { selectIsHost, useNet } from "../net/netStore";
import { session } from "../net/session";
import { useGame } from "../state/gameStore";
import { TransitionLayer } from "./Transitions";

/** All DOM UI: crosshair, bars, prompts, message feed, the splash screen and
 * the death rites. Everything else is in-world — floor choice lives on the
 * village waystone, and travel is a warp, not a loading popup. The chrome is
 * built from the same procedural pixel grit as the world: stone-textured
 * panels, chunky hard-shadow frames, segmented bars, scanlines. */
export function HUD() {
  const phase = useGame((s) => s.phase);
  const [showPerf, setShowPerf] = useState(false);

  // Leaving gameplay always releases the pointer. Warping between floors
  // ("loading") is gameplay: the pointer stays locked through the tunnel.
  useEffect(() => {
    if (
      phase !== "village" &&
      phase !== "dungeon" &&
      phase !== "loading" &&
      document.pointerLockElement
    ) {
      document.exitPointerLock();
    }
  }, [phase]);

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
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div style={styles.root}>
      <style>{css}</style>
      <div style={styles.buildStamp}>{__BUILD_INFO__}</div>
      {showPerf && <PerfOverlay />}
      {(phase === "village" || phase === "dungeon") && <PlayHud />}
      {phase === "menu" && <MenuOverlay />}
      {phase === "dead" && <DeathOverlay />}
      <TransitionLayer />
      <div className="wm-scan" />
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
  const floorPlayers = useNet((s) => s.floorPlayers);
  const amHost = useNet(selectIsHost);
  const stats = computeStats(equipment);
  const locked = usePointerLocked();

  return (
    <>
      {/* Crosshair: a pixel cross, not a smooth dot */}
      <div style={styles.crosshair} />
      <HurtFlash />
      <BossBar />

      {/* Top-left: location */}
      <div className="wm-panel" style={{ top: 14, left: 14 }}>
        {phase === "dungeon" ? (
          <>
            <div style={styles.heading}>FLOOR {floor}</div>
            <div style={styles.dim}>
              instance {instanceId || "—"}
              {session.mode === "online" &&
                ` · ${floorPlayers} wizard${floorPlayers === 1 ? "" : "s"}`}
            </div>
          </>
        ) : (
          <div style={styles.heading}>THE VILLAGE</div>
        )}
        <div style={styles.dim}>checkpoint: floor {checkpoint}</div>
        <div style={{ ...styles.dim, color: session.mode === "online" ? "#4fd08a" : "#7d7566" }}>
          {session.mode === "online"
            ? `◉ online${amHost && phase === "dungeon" ? " · host" : ""}`
            : session.mode === "offline"
              ? "○ offline"
              : "◌ connecting"}
        </div>
      </div>

      <MessageFeed />

      {/* Bottom-left: vitals */}
      <div className="wm-panel" style={{ bottom: 16, left: 14, width: 240 }}>
        <Bar label="HP" value={health} max={stats.maxHealth} color="#d84a4a" />
        <Bar label="MP" value={mana} max={PLAYER.maxMana} color="#4a86d8" />
      </div>

      {/* Bottom-right: equipment */}
      <div className="wm-panel" style={{ bottom: 16, right: 14, textAlign: "right" }}>
        <EquipRow slot="staff" defId={equipment.staff.defId} runLoot={equipment.staff.runLoot} />
        <EquipRow slot="amulet" defId={equipment.amulet?.defId} runLoot={equipment.amulet?.runLoot} />
        <EquipRow slot="cloak" defId={equipment.cloak?.defId} runLoot={equipment.cloak?.runLoot} />
        <EquipRow slot="boots" defId={equipment.boots.defId} runLoot={equipment.boots.runLoot} />
      </div>

      {/* Interaction prompt / lock hint */}
      {locked && prompt && <div className="wm-prompt">{prompt}</div>}
      {!locked && (
        <div className="wm-prompt">
          Click to take control — WASD move · Space jump · Mouse casts
        </div>
      )}
    </>
  );
}

function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div style={{ marginBottom: 6 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#b9b0a0", textShadow: "1px 1px 0 #000" }}>
        <span>{label}</span>
        <span>
          {Math.ceil(value)} / {Math.round(max)}
        </span>
      </div>
      <div style={styles.barTrack}>
        <div
          style={{
            height: "100%",
            width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`,
            background: color,
            // Segment the fill into chunky pips.
            backgroundImage:
              "repeating-linear-gradient(90deg, rgba(255,255,255,0.18) 0 2px, transparent 2px 10px, rgba(0,0,0,0.4) 10px 12px)",
            transition: "width 120ms steps(4)",
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
    <div style={{ fontSize: 12, marginBottom: 4, color: def ? "#ded5c2" : "#55505a", textShadow: "1px 1px 0 #000" }}>
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
      <div style={{ fontSize: 13, letterSpacing: 4, color: "#ff6a52", marginBottom: 4, textShadow: "2px 2px 0 #000" }}>
        {boss.name}
      </div>
      <div style={{ ...styles.barTrack, height: 12, borderColor: "#5a2a24" }}>
        <div
          style={{
            height: "100%",
            width: `${Math.max(0, boss.frac * 100)}%`,
            background: "linear-gradient(#ff5136, #8a1d10)",
            backgroundImage:
              "repeating-linear-gradient(90deg, rgba(255,255,255,0.15) 0 2px, transparent 2px 12px, rgba(0,0,0,0.45) 12px 14px)",
            backgroundColor: "#b03222",
            transition: "width 150ms steps(4)",
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
    <div className="wm-panel" style={{ top: 110, left: 14, fontSize: 12, color: "#8fe3a0" }}>
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
  return <div className="wm-overlay">{children}</div>;
}

function MenuOverlay() {
  const startGame = useGame((s) => s.startGame);
  const shadows = useGame((s) => s.shadows);
  const toggleShadows = useGame((s) => s.toggleShadows);
  const playerName = useGame((s) => s.playerName);
  const setPlayerName = useGame((s) => s.setPlayerName);
  return (
    <Overlay>
      <div className="wm-title" style={styles.title}>WEBMAGIC</div>
      <div style={styles.subtitle}>Dungeon of the Hundred Floors</div>
      <p style={styles.blurb}>
        For glory, fame and riches — and to find god at the bottom — the wizards
        of the village step through the rift. One hundred floors down. Leave
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
      <button className="wm-btn" onClick={startGame}>
        BECOME THE WIZARD
      </button>
      <button
        className="wm-btn"
        style={{ marginTop: 14, fontSize: 13, borderColor: "#5a5560", color: "#b8afa0" }}
        onClick={toggleShadows}
      >
        SHADOWS: {shadows ? "ON" : "OFF"}
      </button>
      <div style={styles.controls}>
        WASD move · Space jump · Left/Right click cast · Shift dash (cloak) · E interact
        <br />
        P fps overlay · O shadows
      </div>
    </Overlay>
  );
}

function DeathOverlay() {
  const lastDeath = useGame((s) => s.lastDeath);
  const respawn = useGame((s) => s.respawn);
  return (
    <Overlay>
      <div style={{ ...styles.title, color: "#c23a3a", textShadow: "0 0 18px rgba(194,58,58,0.4), 3px 3px 0 #1a0808" }}>
        YOU DIED
      </div>
      <div style={styles.subtitle}>on floor {lastDeath?.floor ?? "?"}</div>
      {lastDeath && lastDeath.lostItems.length > 0 ? (
        <p style={styles.blurb}>
          The dungeon keeps what you carried:{" "}
          <span style={{ color: "#c8a23c" }}>{lastDeath.lostItems.join(", ")}</span>
        </p>
      ) : (
        <p style={styles.blurb}>You carried nothing the dungeon could take.</p>
      )}
      <button className="wm-btn" onClick={respawn}>
        RETURN TO THE VILLAGE
      </button>
    </Overlay>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

/** Tiny procedural stone tile for the DOM chrome — same gritty pixel family
 * as the world textures, generated once at module load (still zero assets). */
function stoneDataUrl(): string {
  const size = 40;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const rng = new Rng(hashSeed("hud-stone"));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const n = rng.next();
      const crack = n > 0.94;
      const v = crack ? 6 : 15 + n * 13;
      ctx.fillStyle = `rgb(${v | 0},${(v * 0.9) | 0},${(v * 1.28) | 0})`;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  return canvas.toDataURL();
}

const STONE = stoneDataUrl();

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
    width: 4,
    height: 4,
    marginLeft: -2,
    marginTop: -2,
    background: "rgba(240,235,220,0.9)",
    boxShadow:
      "6px 0 rgba(240,235,220,0.9), -6px 0 rgba(240,235,220,0.9), 0 6px rgba(240,235,220,0.9), 0 -6px rgba(240,235,220,0.9), 1px 1px 0 rgba(0,0,0,0.8)",
  },
  heading: { fontSize: 18, color: "#e8dfc8", textShadow: "2px 2px 0 #000" },
  dim: { fontSize: 11, color: "#7d7566", marginTop: 2, textShadow: "1px 1px 0 #000" },
  barTrack: {
    height: 12,
    background: "#0c0a12",
    border: "2px solid #3a333d",
    boxShadow: "inset 2px 2px 0 rgba(0,0,0,0.6)",
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
    zIndex: 60,
  },
  title: {
    fontSize: 52,
    letterSpacing: 10,
    color: "#e8dfc8",
    textShadow: "0 0 18px rgba(70,255,208,0.35), 3px 3px 0 #1a1420, 6px 6px 0 rgba(0,0,0,0.6)",
  },
  subtitle: { fontSize: 18, letterSpacing: 4, color: "#8f86a0", marginTop: 8, textShadow: "2px 2px 0 #000" },
  blurb: { maxWidth: 460, fontSize: 14, lineHeight: 1.6, color: "#a89e8c", margin: "18px 0" },
  nameInput: {
    fontFamily: "'Courier New', monospace",
    fontSize: 16,
    letterSpacing: 2,
    padding: "9px 14px",
    background: "#0e0b16",
    color: "#e8dfc8",
    border: "2px solid #3f3946",
    boxShadow: "3px 3px 0 rgba(0,0,0,0.6)",
    textAlign: "center",
    outline: "none",
    width: 220,
  },
  controls: { marginTop: 26, fontSize: 12, color: "#6d6478", letterSpacing: 1 },
};

const css = `
.wm-panel {
  position: absolute;
  padding: 10px 12px;
  letter-spacing: 1px;
  color: #cfc6b4;
  background-image: linear-gradient(rgba(10,7,15,0.72), rgba(10,7,15,0.72)), url(${STONE});
  background-size: auto, 80px 80px;
  image-rendering: pixelated;
  border: 2px solid #38313f;
  box-shadow: 0 0 0 2px #0a0810, 4px 4px 0 rgba(0,0,0,0.55), inset 0 0 0 1px #171221;
}
.wm-prompt {
  position: absolute;
  bottom: 22%;
  left: 50%;
  transform: translateX(-50%);
  padding: 8px 16px;
  font-size: 14px;
  letter-spacing: 1px;
  white-space: nowrap;
  text-shadow: 1px 1px 0 #000;
  background-image: linear-gradient(rgba(10,7,15,0.8), rgba(10,7,15,0.8)), url(${STONE});
  background-size: auto, 80px 80px;
  image-rendering: pixelated;
  border: 2px solid #3f3946;
  border-left: 4px solid #46ffd0;
  border-right: 4px solid #46ffd0;
  box-shadow: 0 0 0 2px #0a0810, 4px 4px 0 rgba(0,0,0,0.55);
}
.wm-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  pointer-events: auto;
  text-align: center;
  padding: 24px;
  background-image:
    radial-gradient(ellipse at center, rgba(8,5,14,0.82) 0%, rgba(3,2,8,0.96) 75%),
    url(${STONE});
  background-size: auto, 120px 120px;
  image-rendering: pixelated;
}
.wm-btn {
  font-family: 'Courier New', monospace;
  font-size: 16px;
  letter-spacing: 2px;
  padding: 12px 26px;
  color: #e8dfc8;
  cursor: pointer;
  background-image: linear-gradient(rgba(14,10,22,0.85), rgba(14,10,22,0.85)), url(${STONE});
  background-size: auto, 80px 80px;
  image-rendering: pixelated;
  border: 2px solid #46ffd0;
  box-shadow: 0 0 0 2px #0a0810, 4px 4px 0 rgba(0,0,0,0.7);
  text-shadow: 2px 2px 0 #000;
}
.wm-btn:hover {
  background-image: linear-gradient(rgba(26,20,40,0.85), rgba(26,20,40,0.85)), url(${STONE});
  box-shadow: 0 0 0 2px #0a0810, 4px 4px 0 rgba(0,0,0,0.7), 0 0 14px rgba(70,255,208,0.25);
}
.wm-btn:active {
  transform: translate(3px, 3px);
  box-shadow: 0 0 0 2px #0a0810, 1px 1px 0 rgba(0,0,0,0.7);
}
.wm-scan {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 50;
  background: repeating-linear-gradient(0deg, rgba(0,0,0,0.09) 0 1px, transparent 1px 4px);
  mix-blend-mode: multiply;
}
.wm-title { animation: wm-flicker 4.2s steps(1) infinite; }
@keyframes wm-flicker {
  0%, 100% { opacity: 1; }
  87% { opacity: 1; }
  88% { opacity: 0.55; }
  89% { opacity: 1; }
  93% { opacity: 0.75; }
  94% { opacity: 1; }
}
.wm-msg {
  animation: wm-fade 5s steps(12) forwards;
  padding: 3px 8px;
  margin-bottom: 4px;
  text-shadow: 1px 1px 0 #000;
  background-image: linear-gradient(rgba(10,7,15,0.66), rgba(10,7,15,0.66)), url(${STONE});
  background-size: auto, 80px 80px;
  image-rendering: pixelated;
  border: 1px solid #23202c;
  border-right: 3px solid #46ffd0;
}
@keyframes wm-fade { 0% { opacity: 0; transform: translateX(8px);} 6% { opacity: 1; transform: none;} 80% { opacity: 1;} 100% { opacity: 0;} }
.wm-hurt { animation: wm-hurt-fade 500ms steps(6) forwards; }
@keyframes wm-hurt-fade { from { opacity: 1; } to { opacity: 0; } }
`;
