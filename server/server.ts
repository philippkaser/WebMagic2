/** WebMagic game server (Bun): WebSocket plumbing around GameServerCore.
 *
 * All game rules — encounter matchmaking, relays, wizard-vs-wizard hits,
 * pacts, death chests — live in src/net/serverCore.ts, which the offline
 * loopback also runs. World simulation is host-authoritative on clients; see
 * docs/ARCHITECTURE.md for the authority model and roadmap.
 *
 * Dev:  bun run dev:server   (vite proxies /ws to it)
 * Prod: bun run start        (serves dist/ and /ws from one process)
 */
import { GameServerCore } from "../src/net/serverCore";
import type { ClientMsg } from "../src/net/protocol";

const PORT = Number(process.env.PORT ?? 3001);

interface SocketData {
  id: string;
}

const log = (text: string) => console.log(`[webmagic] ${text}`);
// WEBMAGIC_JOIN_CHANCE=1 forces every wizard on a floor together (playtests).
const joinChance = process.env.WEBMAGIC_JOIN_CHANCE ? Number(process.env.WEBMAGIC_JOIN_CHANCE) : undefined;
const core = new GameServerCore({ log, joinChance });
const DIST = new URL("../dist", import.meta.url).pathname;

Bun.serve<SocketData>({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const ok = server.upgrade(req, { data: { id: crypto.randomUUID().slice(0, 8) } });
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
    open(ws) {
      core.connect(ws.data.id, (msg) => ws.send(JSON.stringify(msg)));
    },
    message(ws, raw) {
      try {
        core.receive(ws.data.id, JSON.parse(String(raw)) as ClientMsg);
      } catch (err) {
        log(`bad message from ${ws.data.id}: ${String(err)}`);
      }
    },
    close(ws) {
      core.disconnect(ws.data.id);
    },
  },
});

log(`listening on :${PORT} (ws at /ws)`);
