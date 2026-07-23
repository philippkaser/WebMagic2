import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { PLAYER } from "../core/config";
import { gameEvents } from "../core/events";
import { parseColor, renderTear } from "../fx/tearField";
import { computeStats, resolveItem } from "../items/catalog";
import type { GearSlot, ItemStack } from "../items/types";
import { floorPlayerCount, selectIsHost, useNet } from "../net/netStore";
import { entryFloors, useGame } from "../state/gameStore";
import { DevRoom } from "./DevRoom";
import { InventoryScreen } from "./InventoryScreen";
import { ITEM_ICONS, iconOf } from "./itemInfo";
import {
  barSegments,
  conjuredPanel,
  manaWell,
  runeButton,
  scarred,
  themeCss,
} from "./theme";

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
      {phase === "loading" && <RiftCrossing />}
      <ArrivalFade phase={phase} />
    </div>
  );
}

// ── Crossing the tear ─────────────────────────────────────────────────────────

/** The crossing itself: the same wound you stepped into, blown up to swallow
 * the eye. A low-res canvas (a few thousand fat pixels, pixel-upscaled to fill
 * the screen) runs the portal's own shader in 2D — ragged vertical slit,
 * domain-warped void, dead stars, white-hot frayed rim — staged as being
 * pulled bodily through the tear. Sits over the R3F canvas while the next
 * floor streams in. */
function RiftCrossing() {
  const ref = useRef<HTMLCanvasElement>(null);
  const portalColor = useGame((s) => s.portalColor);
  const colorRef = useRef(parseColor(portalColor));
  useEffect(() => {
    colorRef.current = parseColor(portalColor);
  }, [portalColor]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Fixed tiny buffer — the browser upscales it with the pixelated hint, so
    // the whole warp is intrinsically chunky and cheap no matter the screen.
    const W = 104;
    const H = 60;
    canvas.width = W;
    canvas.height = H;
    const img = ctx.createImageData(W, H);
    const seed = Math.random() * 37;

    let raf = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      renderTear(img.data, W, H, (now - t0) / 1000, seed, "enter", colorRef.current);
      ctx.putImageData(img, 0, 0);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div
      className="wm-tear-veil"
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "auto",
        backgroundColor: "#030108",
        overflow: "hidden",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <canvas
        ref={ref}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          imageRendering: "pixelated",
        }}
      />
      {/* Vignette so the tunnel funnels toward the center. */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "radial-gradient(ellipse at 50% 50%, transparent 30%, rgba(3,1,8,0.85) 82%)",
        }}
      />
      <div
        className="wm-tear-text"
        style={{
          position: "absolute",
          bottom: "16%",
          fontSize: 15,
          letterSpacing: 8,
          ...scarred,
          color: "#9fe8d4",
        }}
      >
        THROUGH THE TEAR
      </div>
    </div>
  );
}

/** Stepping out the far side (loading→dungeon, menu→village, any arrival into
 * play): the other half of the crossing. A rip of the far side tears open over
 * the live scene and widens you back out into it — the frayed lip flaring as
 * you break through — then the last of the void drains away. Same portal
 * shader as the crossing, run in reverse over the scene beneath. */
function ArrivalFade({ phase }: { phase: ReturnType<typeof useGame.getState>["phase"] }) {
  const prev = useRef(phase);
  const [fadeKey, setFadeKey] = useState(0);
  const ref = useRef<HTMLCanvasElement>(null);
  const portalColor = useGame((s) => s.portalColor);
  const colorRef = useRef(parseColor(portalColor));
  colorRef.current = parseColor(portalColor);
  useEffect(() => {
    const was = prev.current;
    prev.current = phase;
    const arriving =
      (phase === "dungeon" || phase === "village") && (was === "loading" || was === "menu" || was === "dead");
    if (arriving) setFadeKey((k) => k + 1);
  }, [phase]);

  useEffect(() => {
    if (fadeKey === 0) return;
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = 104;
    const H = 60;
    canvas.width = W;
    canvas.height = H;
    const img = ctx.createImageData(W, H);
    const seed = Math.random() * 37;

    let raf = 0;
    const t0 = performance.now();
    const draw = (now: number) => {
      const t = (now - t0) / 1000;
      renderTear(img.data, W, H, t, seed, "exit", colorRef.current);
      ctx.putImageData(img, 0, 0);
      // Once the void has fully drained the passage is over — stop redrawing
      // and clear the buffer so nothing lingers over the scene.
      if (t > 1.05) {
        ctx.clearRect(0, 0, W, H);
        return;
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [fadeKey]);

  if (fadeKey === 0) return null;
  return (
    <canvas
      key={fadeKey}
      ref={ref}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        pointerEvents: "none",
        imageRendering: "pixelated",
      }}
    />
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

      {/* Top-left: location, scarred into a graft of hide */}
      <div className="wm-conjure" style={{ ...styles.panel, ...conjuredPanel("loc"), top: 14, left: 14, ...anchor(4) }}>
        {phase === "dungeon" ? (
          <>
            <div style={{ fontSize: 18, ...scarred }}>FLOOR {floor}</div>
            <div style={styles.dim}>
              instance {instanceId || "—"}
              {netMode === "online" &&
                ` · ${floorPlayers} wizard${floorPlayers === 1 ? "" : "s"}`}
            </div>
          </>
        ) : (
          <div style={{ fontSize: 18, ...scarred }}>THE VILLAGE</div>
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
      <div
        className="wm-conjure"
        style={{ ...styles.panel, ...conjuredPanel("vitals"), bottom: 16, left: 14, width: 240, ...anchor(4) }}
      >
        <Bar
          label="♥ BLOOD"
          value={health}
          max={stats.maxHealth}
          color="linear-gradient(180deg, #c93f2e 0%, #911d14 55%, #560b08 100%)"
        />
        <Bar
          label="◆ MANA"
          value={mana}
          max={PLAYER.maxMana}
          color="linear-gradient(180deg, #4f8fd8 0%, #2c55a8 55%, #14275c 100%)"
        />
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
      <div
        className="wm-conjure"
        style={{ ...styles.panel, ...conjuredPanel("gear"), bottom: 16, right: 14, textAlign: "right", ...anchor(-4) }}
      >
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

/** An open wound in the graft: recessed cut, liquid fill chopped into
 * pixel-block segments. `color` takes the full fill gradient. */
function Bar({ label, value, max, color }: { label: string; value: number; max: number; color: string }) {
  return (
    <div style={{ marginBottom: 7 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#c8b8a0", textShadow: "0 1px 0 #000" }}>
        <span>{label}</span>
        <span>
          {Math.ceil(value)} / {Math.round(max)}
        </span>
      </div>
      <div style={{ height: 12, ...manaWell }}>
        <div
          style={{
            height: "100%",
            width: `${Math.max(0, Math.min(100, (value / max) * 100))}%`,
            backgroundImage: `${barSegments}, ${color}`,
            boxShadow: "inset 0 -2px 0 rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.25)",
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
        background: "#0c0508",
        boxShadow: "inset 0 0 0 1px #000, inset 0 2px 3px rgba(0,0,0,0.85), 0 0 0 1px rgba(200,180,150,0.18)",
        fontSize: 11,
        color: def ? "#ded5c2" : "#6a5a50",
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
      <div style={{ fontSize: 13, letterSpacing: 4, color: "#ff6a52", marginBottom: 4, textShadow: "0 2px 0 #000" }}>
        ☠ {boss.name} ☠
      </div>
      <div
        style={{
          height: 14,
          ...manaWell,
          boxShadow: "0 0 0 2px rgba(200,184,152,0.5), 0 0 0 3px #000, inset 0 2px 3px rgba(0,0,0,0.9)",
        }}
      >
        <div
          style={{
            height: "100%",
            width: `${Math.max(0, boss.frac * 100)}%`,
            backgroundImage: `${barSegments}, linear-gradient(180deg, #ff5136, #8a1d10)`,
            boxShadow: "inset 0 -2px 0 rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.25)",
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
    <div style={{ ...styles.panel, ...conjuredPanel("perf"), top: 110, left: 14, fontSize: 12, color: "#8fe3a0" }}>
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

/** The slab of stitched hide the fullscreen overlays mount their content on —
 * a thing hanging in the world (it breathes), not a window over it. */
function Sheet({ children }: { children: ReactNode }) {
  return (
    <div className="wm-conjure" style={styles.sheet}>
      {children}
    </div>
  );
}

function MenuOverlay() {
  const startGame = useGame((s) => s.startGame);
  const shadows = useGame((s) => s.shadows);
  const toggleShadows = useGame((s) => s.toggleShadows);
  const playerName = useGame((s) => s.playerName);
  const setPlayerName = useGame((s) => s.setPlayerName);
  return (
    <Overlay>
      <Sheet>
        <div style={styles.title}>WEBMAGIC</div>
        <div style={styles.subtitle}>DUNGEON OF THE HUNDRED FLOORS</div>
        <p style={styles.blurb}>
          For glory, fame and riches — and to find god at the bottom — the wizards
          of the village step through the tear. One hundred floors down. Leave
          only every fifth floor. Die, and everything you found goes with you.
        </p>
        <div style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, letterSpacing: 2, color: "#8a8072", marginBottom: 5 }}>
            SCRATCH YOUR NAME INTO THE LEDGER
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
          style={{ ...styles.buttonSmall, marginTop: 14 }}
          onClick={toggleShadows}
        >
          SHADOWS: {shadows ? "ON" : "OFF"}
        </button>
        <div style={styles.controls}>
          WASD move · Space jump · Left/Right click cast · Shift dash (cloak) · E interact
          <br />
          I inventory · Q/E use belt items · P fps overlay · O shadows
        </div>
      </Sheet>
    </Overlay>
  );
}

function SelectOverlay() {
  const checkpoint = useGame((s) => s.checkpoint);
  const enterDungeon = useGame((s) => s.enterDungeon);
  const closePortalSelect = useGame((s) => s.closePortalSelect);
  return (
    <Overlay>
      <Sheet>
        <div style={styles.subtitle}>THE TEAR AWAITS</div>
        <p style={{ ...styles.blurb, marginTop: 4 }}>
          You may step through to any floor whose seal you have banked.
        </p>
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap", justifyContent: "center", maxWidth: 480 }}>
          {entryFloors(checkpoint).map((f) => (
            <button key={f} style={styles.button} onClick={() => void enterDungeon(f)}>
              FLOOR {f}
            </button>
          ))}
        </div>
        <button style={{ ...styles.buttonSmall, marginTop: 22 }} onClick={closePortalSelect}>
          STAY IN THE VILLAGE
        </button>
      </Sheet>
    </Overlay>
  );
}

function DeathOverlay() {
  const lastDeath = useGame((s) => s.lastDeath);
  const respawn = useGame((s) => s.respawn);
  return (
    <Overlay>
      <div style={styles.deathTitle}>YOU DIED</div>
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

/** Perspective anchor for HUD grafts: a small yaw so the corner panels sit IN
 * the view instead of ON the glass. Fed to the breathe animation as a CSS var
 * so the two transforms compose. */
function anchor(deg: number): CSSProperties {
  return { "--wm-anchor": `perspective(720px) rotateY(${deg}deg)` } as CSSProperties;
}

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
  // Four fat pixels — a crosshair a rat could have gnawed.
  crosshair: {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: 2,
    height: 2,
    marginLeft: -1,
    marginTop: -1,
    background: "rgba(240,235,220,0.9)",
    boxShadow:
      "0 -5px 0 rgba(240,235,220,0.9), 0 5px 0 rgba(240,235,220,0.9), -5px 0 0 rgba(240,235,220,0.9), 5px 0 0 rgba(240,235,220,0.9), 0 0 4px rgba(0,0,0,0.9)",
  },
  chargeTrack: {
    position: "absolute",
    top: "calc(50% + 16px)",
    left: "50%",
    width: 64,
    height: 5,
    marginLeft: -32,
    ...manaWell,
  },
  chargeFill: {
    height: "100%",
    transition: "width 40ms linear",
  },
  // Base graft geometry — each call site layers conjuredPanel(seed) over this.
  panel: {
    position: "absolute",
    padding: "12px 16px",
    letterSpacing: 1,
  },
  dim: { fontSize: 11, color: "#8a7568", marginTop: 2, textShadow: "0 1px 0 #000" },
  // The interaction prompt: a strip of hide stitched up at eye level.
  prompt: {
    position: "absolute",
    bottom: "22%",
    left: "50%",
    transform: "translateX(-50%)",
    padding: "10px 26px",
    fontSize: 14,
    letterSpacing: 1,
    whiteSpace: "nowrap",
    ...conjuredPanel("prompt"),
    ...scarred,
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
  // Overlays barely dim the world — the village is still there behind the
  // graft, which is the point.
  overlay: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    background:
      "radial-gradient(ellipse at 50% 45%, rgba(6,3,8,0.45) 0%, rgba(2,1,4,0.85) 85%)",
    pointerEvents: "auto",
    textAlign: "center",
    padding: 24,
  },
  sheet: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    padding: "38px 52px 32px",
    maxWidth: 640,
    ...conjuredPanel("sheet"),
  },
  title: {
    fontSize: 52,
    letterSpacing: 10,
    color: "#e0d4b8",
    textShadow: "0 0 20px rgba(70,255,208,0.35), 0 4px 0 rgba(0,0,0,0.9)",
  },
  deathTitle: {
    fontSize: 56,
    letterSpacing: 10,
    color: "#c23a3a",
    textShadow: "0 5px 0 #4a0808, 0 8px 0 #000, 0 0 26px rgba(160,10,10,0.5)",
  },
  subtitle: { fontSize: 18, letterSpacing: 4, color: "#b09a90", marginTop: 8, textShadow: "0 2px 0 #000" },
  blurb: { maxWidth: 460, fontSize: 14, lineHeight: 1.6, color: "#b8a494", margin: "18px 0", textShadow: "0 1px 0 #000" },
  button: runeButton("main"),
  buttonSmall: { ...runeButton("small"), fontSize: 12, padding: "8px 18px", opacity: 0.85 },
  nameInput: {
    fontFamily: "'Courier New', monospace",
    fontSize: 16,
    letterSpacing: 2,
    padding: "9px 14px",
    color: "#e0d4b8",
    border: "none",
    ...manaWell,
    textAlign: "center",
    outline: "none",
    width: 220,
  },
  controls: { marginTop: 26, fontSize: 12, color: "#8a7568", letterSpacing: 1, textShadow: "0 1px 0 #000" },
};

const css = `
.wm-msg { animation: wm-fade 5s forwards; padding: 4px 10px; background: rgba(26,10,14,0.82); margin-bottom: 4px; box-shadow: inset 0 0 0 1px rgba(0,0,0,0.8), inset 0 0 12px rgba(0,0,0,0.5); border-right: 3px solid #46ffd0; text-shadow: 0 1px 0 #000; clip-path: polygon(0 3px, 3px 3px, 3px 0, 100% 0, 100% calc(100% - 3px), calc(100% - 3px) calc(100% - 3px), calc(100% - 3px) 100%, 0 100%); }
@keyframes wm-fade { 0% { opacity: 0; transform: translateX(8px);} 6% { opacity: 1; transform: none;} 80% { opacity: 1;} 100% { opacity: 0;} }
.wm-hurt { animation: wm-hurt-fade 500ms forwards; }
@keyframes wm-hurt-fade { from { opacity: 1; } to { opacity: 0; } }
button:hover { filter: brightness(1.18) saturate(1.1); }
button:active { transform: translateY(2px); }
${themeCss}
`;
