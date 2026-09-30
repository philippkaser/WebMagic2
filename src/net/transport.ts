import type { ClientMsg, ServerMsg } from "./protocol";
import { GameServerCore } from "./serverCore";

/** Transport abstraction. The session prefers WebSocketTransport (real
 * multiplayer via server/server.ts) and falls back to LocalTransport
 * (single-player loopback) when no server is reachable. */
export interface Transport {
  connect(): Promise<void>;
  send(msg: ClientMsg): void;
  onMessage(cb: (msg: ServerMsg) => void): () => void;
  close(): void;
}

/** Real networking against the Bun game server. In dev, vite proxies /ws to
 * the server process; in prod the server hosts both static files and /ws. */
export class WebSocketTransport implements Transport {
  private ws: WebSocket | null = null;
  private listeners = new Set<(msg: ServerMsg) => void>();
  private queue: ServerMsg[] = [];

  constructor(private url: string = defaultWsUrl()) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (reason: string) => {
        if (settled) return;
        settled = true;
        this.ws?.close();
        this.ws = null;
        reject(new Error(reason));
      };
      const timeout = setTimeout(() => fail("websocket connect timeout"), 8000);
      let ws: WebSocket;
      try {
        ws = new WebSocket(this.url);
      } catch (err) {
        clearTimeout(timeout);
        reject(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      this.ws = ws;
      ws.onopen = () => {
        clearTimeout(timeout);
        settled = true;
        resolve();
      };
      ws.onerror = () => {
        clearTimeout(timeout);
        fail("websocket error");
      };
      ws.onclose = () => {
        clearTimeout(timeout);
        fail("websocket closed");
      };
      ws.onmessage = (event) => {
        try {
          this.deliver(JSON.parse(String(event.data)) as ServerMsg);
        } catch {
          // Malformed frame — drop it.
        }
      };
    });
  }

  send(msg: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  onMessage(cb: (msg: ServerMsg) => void): () => void {
    this.listeners.add(cb);
    // Flush anything that arrived before a listener attached (e.g. welcome).
    if (this.queue.length > 0) {
      const pending = this.queue;
      this.queue = [];
      for (const msg of pending) cb(msg);
    }
    return () => this.listeners.delete(cb);
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
    this.listeners.clear();
  }

  private deliver(msg: ServerMsg): void {
    if (this.listeners.size === 0) {
      this.queue.push(msg);
      return;
    }
    for (const cb of this.listeners) cb(msg);
  }
}

function defaultWsUrl(): string {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${location.host}/ws`;
}

/** Single-player loopback: the real GameServerCore running in-process with
 * one client — offline play exercises the exact server rules (matchmaking,
 * death chests, remains of your past lives) with zero network. */
export class LocalTransport implements Transport {
  private listeners = new Set<(msg: ServerMsg) => void>();
  private static core: GameServerCore | null = null;
  private readonly playerId = "local_player";

  async connect(): Promise<void> {
    // One core per page session: remains of earlier deaths survive re-entry.
    LocalTransport.core ??= new GameServerCore();
    LocalTransport.core.disconnect(this.playerId);
    LocalTransport.core.connect(this.playerId, (msg) => this.deliver(msg));
  }

  send(msg: ClientMsg): void {
    LocalTransport.core?.receive(this.playerId, msg);
  }

  onMessage(cb: (msg: ServerMsg) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  close(): void {
    this.listeners.clear();
  }

  private deliver(msg: ServerMsg): void {
    // Async delivery mirrors real network behavior and avoids reentrancy.
    queueMicrotask(() => {
      for (const cb of this.listeners) cb(msg);
    });
  }
}
