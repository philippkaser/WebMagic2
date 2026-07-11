/** WebMagic game server (Bun) — a thin socket wrapper around the gameplay-
 * blind Relay core (relay.ts). It owns nothing but I/O: websocket lifecycle,
 * JSON parsing with basic abuse guards, and static hosting for production.
 *
 * Dev:  bun run dev:server   (vite proxies /ws to it)
 * Prod: bun run start        (serves dist/ and /ws from one process)
 */
import type { ServerWebSocket } from "bun";
import { FloorDirectory } from "../src/net/matchmaking";
import type { ClientMsg } from "../src/net/protocol";
import { Relay, type RelayPeer } from "./relay";

const PORT = Number(process.env.PORT ?? 3001);
const MAX_PLAYERS_PER_FLOOR = 4;
const MAX_FRAME_BYTES = 64 * 1024;

interface SocketData {
  id: string;
}

const log = (text: string) => console.log(`[webmagic] ${text}`);
const relay = new Relay(new FloorDirectory(MAX_PLAYERS_PER_FLOOR), () => Date.now(), log);
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
      sockets.set(ws.data.id, ws);
      relay.connect(peerFor(ws));
      log(`${ws.data.id} connected (${sockets.size} online)`);
    },
    message(ws, raw) {
      const text = String(raw);
      if (text.length > MAX_FRAME_BYTES) return; // oversized frame — drop
      try {
        relay.handle(ws.data.id, JSON.parse(text) as ClientMsg);
      } catch (err) {
        log(`bad message from ${ws.data.id}: ${String(err)}`);
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
