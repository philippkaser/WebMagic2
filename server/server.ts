/** WebMagic game server (Bun) — a thin socket wrapper around the gameplay-
 * blind Relay core (relay.ts). It owns nothing but I/O: websocket lifecycle,
 * JSON parsing with basic abuse guards, and static hosting for production.
 *
 * Dev:  bun run dev:server   (vite proxies /ws to it)
 * Prod: bun run start        (serves dist/ and /ws from one process)
 */
import RAPIER from "@dimforge/rapier3d-compat";
import type { ServerWebSocket } from "bun";
import { writeFileSync } from "node:fs";
import { ENCOUNTERS } from "../src/core/config";
import { FloorDirectory } from "../src/net/matchmaking";
import type { ClientMsg } from "../src/net/protocol";
import { PACE } from "../src/run/rules";
import { AccountStore } from "./accounts";
import { parseHostingPolicy, serverHosting } from "./hosting";
import { Relay, type RelayPeer } from "./relay";

const PORT = Number(process.env.PORT ?? 3001);
const MAX_PLAYERS_PER_FLOOR = 4;
const MAX_FRAME_BYTES = 64 * 1024;

/** Per-connection token bucket. A legit client peaks around 40 msg/s (20 Hz
 * pose + 15 Hz host snapshots + casts + pings); beyond the refill rate frames
 * are dropped, and a sustained flood gets the socket closed. */
const MSGS_PER_SEC = 80;
const BUCKET_BURST = 160;
const FLOOD_CLOSE_AFTER = 400; // consecutive dropped frames

/** Close sockets with no traffic for this long (seconds). Clients ping every
 * 2 s, so only dead/half-open connections trip it — otherwise a vanished
 * host would freeze its floor until the OS gives up on the TCP connection. */
const IDLE_TIMEOUT_S = 30;

interface SocketData {
  id: string;
  tokens: number;
  lastRefill: number;
  dropped: number;
}

const log = (text: string) => console.log(`[webmagic] ${text}`);

// Accounts persist to a JSON file (override with DATA_FILE), write-debounced.
// Swapping this for a real database later means replacing only `persist`.
const DATA_FILE = process.env.DATA_FILE ?? new URL("../server-data.json", import.meta.url).pathname;
const dataFile = Bun.file(DATA_FILE);
const initialAccounts = (await dataFile.exists()) ? await dataFile.text() : null;
let writeTimer: ReturnType<typeof setTimeout> | null = null;
let pendingJson: string | null = null;
const persistAccounts = (json: string) => {
  pendingJson = json;
  if (writeTimer !== null) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    pendingJson = null;
    Bun.write(DATA_FILE, json).catch((err) => log(`save write failed: ${err}`));
  }, 300);
};
// Debounced writes must not lose the last mutation on shutdown.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    if (pendingJson !== null) {
      try {
        writeFileSync(DATA_FILE, pendingJson);
      } catch (err) {
        log(`final save write failed: ${err}`);
      }
    }
    process.exit(0);
  });
}
const accounts = new AccountStore(persistAccounts, initialAccounts);
log(`accounts: ${accounts.size} loaded from ${DATA_FILE}`);

// ENCOUNTER_CHANCE=1 makes every same-floor entry meet whoever is there — a
// testing knob (two local clients would otherwise meet ~12% of the time).
// Unset, the tension clock in core/config.ts ENCOUNTERS applies.
const encounterOverride = Number(process.env.ENCOUNTER_CHANCE);
const encounterTuning = Number.isFinite(encounterOverride)
  ? { baseChance: encounterOverride, perSoloFloor: 0, maxChance: encounterOverride }
  : ENCOUNTERS;
// FLOOR_PACE_MS sets how long a new floor takes to come due (ms per floor;
// 0 lifts the pace — a testing knob: the e2e smoke test descends faster than
// any wizard could walk). Unset, run/rules.ts PACE applies.
const paceEnv = process.env.FLOOR_PACE_MS;
const paceOverride = paceEnv === undefined || paceEnv === "" ? NaN : Number(paceEnv);
const pace = Number.isFinite(paceOverride)
  ? paceOverride > 0
    ? { ...PACE, msPerFloor: paceOverride }
    : null
  : PACE;
// DEV_LOOT=1 lets a floor host ask the loot book for a SPECIFIC orb — the
// e2e smoke test and the dev room use it. A cheat by definition: never set
// it on a real server.
const devLoot = process.env.DEV_LOOT === "1";
// SERVER_HOSTS picks who hosts floors (server/hosting.ts): "shared" (the
// default) hands a floor to the server once a second wizard is on it,
// "always" hosts every floor here, "never" leaves every floor to its
// wizards' browsers.
const hostingPolicy = parseHostingPolicy(process.env.SERVER_HOSTS);
await RAPIER.init();
const relay = new Relay(
  new FloorDirectory(MAX_PLAYERS_PER_FLOOR, undefined, undefined, undefined, encounterTuning),
  accounts,
  () => Date.now(),
  log,
  { pace, devLoot, hosting: serverHosting(RAPIER, hostingPolicy) },
);
log(`floors hosted server-side: ${hostingPolicy}`);
// The server-hosted floors' clock: ~60 Hz, real elapsed time (the hosts
// step in fixed steps of their own).
let lastTick = performance.now();
setInterval(() => {
  const now = performance.now();
  relay.tick(Math.min((now - lastTick) / 1000, 0.25));
  lastTick = now;
}, 1000 / 60);
if (devLoot) log("DEV_LOOT is on — hosts may spawn any item. Testing only!");
if (encounterTuning !== ENCOUNTERS) log(`encounter chance forced to ${encounterOverride}`);
if (pace !== PACE) log(pace ? `floor pace forced to ${pace.msPerFloor} ms` : "floor pace lifted");
const sockets = new Map<string, ServerWebSocket<SocketData>>();

function peerFor(ws: ServerWebSocket<SocketData>): RelayPeer {
  return {
    id: ws.data.id,
    name: "Wizard",
    send(msg) {
      const socket = sockets.get(ws.data.id);
      if (socket) socket.send(JSON.stringify(msg));
    },
  };
}

const DIST = new URL("../dist", import.meta.url).pathname;

Bun.serve<SocketData>({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const ok = server.upgrade(req, {
        data: {
          id: crypto.randomUUID().slice(0, 8),
          tokens: BUCKET_BURST,
          lastRefill: Date.now(),
          dropped: 0,
        },
      });
      return ok ? undefined : new Response("websocket upgrade failed", { status: 400 });
    }
    // Static hosting for production builds.
    const path = url.pathname === "/" ? "/index.html" : url.pathname;
    const file = Bun.file(DIST + path);
    if (await file.exists()) return new Response(file);
    const index = Bun.file(DIST + "/index.html");
    if (await index.exists()) return new Response(index);
    return new Response("webmagic server: run `bun run build` for static hosting, or use vite dev", {
      status: 503,
    });
  },
  websocket: {
    idleTimeout: IDLE_TIMEOUT_S,
    // Snapshots are most of the traffic and JSON compresses 3–4× (measured:
    // bun run physics-bench). Browsers negotiate it on their own.
    perMessageDeflate: true,
    open(ws) {
      sockets.set(ws.data.id, ws);
      relay.connect(peerFor(ws));
      log(`${ws.data.id} connected (${sockets.size} online)`);
    },
    message(ws, raw) {
      const d = ws.data;
      const now = Date.now();
      d.tokens = Math.min(BUCKET_BURST, d.tokens + ((now - d.lastRefill) / 1000) * MSGS_PER_SEC);
      d.lastRefill = now;
      if (d.tokens < 1) {
        if (++d.dropped >= FLOOD_CLOSE_AFTER) {
          log(`${d.id} flooding — closing`);
          ws.close(1008, "rate limit");
        }
        return;
      }
      d.tokens -= 1;
      d.dropped = 0;
      const text = String(raw);
      if (text.length > MAX_FRAME_BYTES) return; // oversized frame — drop
      try {
        relay.handle(d.id, JSON.parse(text) as ClientMsg);
      } catch (err) {
        log(`bad message from ${d.id}: ${String(err)}`);
      }
    },
    close(ws) {
      relay.disconnect(ws.data.id);
      sockets.delete(ws.data.id);
      log(`${ws.data.id} disconnected (${sockets.size} online)`);
    },
  },
});

log(`listening on :${PORT} (ws at /ws)`);
