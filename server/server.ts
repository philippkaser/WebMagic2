/** WebMagic authoritative-ish game server (Bun).
 *
 * Owns the floor-instance directory (the max-4-per-floor matchmaking rule)
 * and relays peer state/casts within each instance. World simulation is still
 * client-side for now — see docs/ARCHITECTURE.md for the authority roadmap.
 *
 * Dev:  bun run dev:server   (vite proxies /ws to it)
 * Prod: bun run start        (serves dist/ and /ws from one process)
 */
import type { ServerWebSocket } from "bun";
import { FloorDirectory } from "../src/net/matchmaking";
import type { ClientMsg, PeerState, ServerMsg } from "../src/net/protocol";

const PORT = Number(process.env.PORT ?? 3001);
const MAX_PLAYERS_PER_FLOOR = 4;

interface SocketData {
  id: string;
}

interface Client {
  id: string;
  name: string;
  ws: ServerWebSocket<SocketData>;
  state: PeerState | null;
}

const clients = new Map<string, Client>();
const directory = new FloorDirectory(MAX_PLAYERS_PER_FLOOR);

function send(client: Client, msg: ServerMsg): void {
  client.ws.send(JSON.stringify(msg));
}

/** Everyone sharing the client's current floor instance, excluding itself. */
function mates(id: string): Client[] {
  const inst = directory.instanceOf(id);
  if (!inst) return [];
  const result: Client[] = [];
  for (const pid of inst.players) {
    if (pid === id) continue;
    const c = clients.get(pid);
    if (c) result.push(c);
  }
  return result;
}

function leaveCurrentInstance(client: Client): void {
  for (const m of mates(client.id)) send(m, { t: "peerLeft", playerId: client.id });
  directory.leave(client.id);
}

function handleMessage(client: Client, msg: ClientMsg): void {
  switch (msg.t) {
    case "hello":
      client.name = msg.name.slice(0, 24) || "Wizard";
      break;

    case "enterFloor": {
      const floor = Math.max(1, Math.min(100, Math.floor(msg.floor)));
      leaveCurrentInstance(client);
      client.state = null; // stale position from the previous floor
      const inst = directory.join(client.id, floor);
      send(client, {
        t: "floorAssigned",
        assignment: {
          instanceId: inst.id,
          floor: inst.floor,
          seed: inst.seed,
          playerCount: inst.players.size,
        },
      });
      const others = mates(client.id);
      for (const m of others) {
        send(m, { t: "peerJoined", peer: client.state ?? placeholderState(client) });
      }
      // The joiner must learn about EVERY mate, including ones that haven't
      // broadcast a position yet (placeholder below the world until they do).
      const peers = others.map((m) => m.state ?? placeholderState(m));
      if (peers.length > 0) send(client, { t: "snapshot", peers });
      log(`${client.id} -> floor ${floor} (${inst.id}, ${inst.players.size} player(s))`);
      break;
    }

    case "state": {
      client.state = {
        playerId: client.id,
        name: client.name,
        position: msg.position,
        yaw: msg.yaw,
        staffId: msg.staffId,
      };
      const snapshot: ServerMsg = { t: "snapshot", peers: [client.state] };
      for (const m of mates(client.id)) send(m, snapshot);
      break;
    }

    case "castAbility": {
      const relay: ServerMsg = {
        t: "peerCast",
        playerId: client.id,
        abilityId: msg.abilityId,
        origin: msg.origin,
        dir: msg.dir,
      };
      for (const m of mates(client.id)) send(m, relay);
      break;
    }

    case "leaveDungeon":
      leaveCurrentInstance(client);
      break;
  }
}

function placeholderState(client: Client): PeerState {
  return {
    playerId: client.id,
    name: client.name,
    position: { x: 0, y: -999, z: 0 },
    yaw: 0,
    staffId: "apprentice_staff",
  };
}

function log(text: string): void {
  console.log(`[webmagic] ${text}`);
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
      const client: Client = { id: ws.data.id, name: "Wizard", ws, state: null };
      clients.set(client.id, client);
      send(client, { t: "welcome", playerId: client.id });
      log(`${client.id} connected (${clients.size} online)`);
    },
    message(ws, raw) {
      const client = clients.get(ws.data.id);
      if (!client) return;
      try {
        handleMessage(client, JSON.parse(String(raw)) as ClientMsg);
      } catch (err) {
        log(`bad message from ${client.id}: ${String(err)}`);
      }
    },
    close(ws) {
      const client = clients.get(ws.data.id);
      if (!client) return;
      leaveCurrentInstance(client);
      clients.delete(client.id);
      log(`${client.id} disconnected (${clients.size} online)`);
    },
  },
});

log(`listening on :${PORT} (ws at /ws)`);
