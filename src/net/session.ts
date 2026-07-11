import { gameEvents } from "../core/events";
import { netBus } from "./bus";
import { netClock } from "./clock";
import { useNet } from "./netStore";
import type { FloorAssignment, ServerMsg, WireInventory } from "./protocol";
import { LocalTransport, WebSocketTransport, type Transport } from "./transport";

const TOKEN_KEY = "webmagic.token.v1";

function loadToken(): string | undefined {
  try {
    return localStorage.getItem(TOKEN_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private mode etc. — a fresh account per session.
  }
}

export type SessionMode = "connecting" | "online" | "offline";

/** Client-side connection lifecycle: connects to the game server (falling
 * back to the offline loopback), keeps the shared clock synced, requests
 * floors, auto-reconnects, and publishes everything else onto the netBus.
 *
 * All gameplay traffic goes through channels.ts — this class only knows
 * about opaque envelopes. */
export class GameSession {
  playerId = "";
  mode: SessionMode = "connecting";

  private transport: Transport | null = null;
  private unsubscribe: (() => void) | null = null;
  private pendingAssignment: ((a: FloorAssignment) => void) | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private name = "Wizard";
  /** Floor we're currently in (for reconnect re-entry); null in the village. */
  private currentFloor: number | null = null;
  private reconnecting = false;

  async ensureConnected(name = "Wizard"): Promise<void> {
    this.name = name;
    if (this.transport) {
      this.login();
      return;
    }
    await this.establish();
    this.login();
  }

  private login(): void {
    this.transport?.send({ t: "login", name: this.name, token: loadToken() });
  }

  /** Ask the server which instance of `floor` we belong to. Resolves with the
   * instance seed used to generate the floor locally. */
  requestFloor(floor: number): Promise<FloorAssignment> {
    return new Promise((resolve, reject) => {
      if (!this.transport) {
        reject(new Error("not connected"));
        return;
      }
      this.currentFloor = floor;
      this.pendingAssignment = resolve;
      this.transport.send({ t: "enterFloor", floor });
    });
  }

  leaveDungeon(): void {
    this.currentFloor = null;
    useNet.setState({ roster: {}, hostId: "", epoch: 0 });
    netBus.emit("leftDungeon", undefined);
    this.transport?.send({ t: "leaveDungeon" });
  }

  /** Send a gameplay envelope. Channel semantics live in channels.ts. */
  sendEnvelope(ch: string, data: unknown, to?: string): void {
    this.transport?.send({ t: "msg", ch, data, to });
  }

  /** Bank at the current checkpoint floor — the server validates provenance
   * and answers with the authoritative save (netBus "serverSave"). */
  sendBank(inventory: WireInventory): void {
    this.transport?.send({ t: "bank", inventory });
  }

  /** Feather escape: bank from any floor by spending a Feather of Safe
   * Passage (the server verifies one was owned and is now gone). */
  sendEscape(inventory: WireInventory): void {
    this.transport?.send({ t: "escape", inventory });
  }

  /** Village inventory rearrangement (chest/bag/belt moves, discards). */
  sendStash(inventory: WireInventory): void {
    this.transport?.send({ t: "stash", inventory });
  }

  /** Merchant purchase: `inventory` is the post-purchase arrangement; the
   * server validates the price against banked gold. */
  sendBuy(itemId: string, inventory: WireInventory): void {
    this.transport?.send({ t: "buy", itemId, inventory });
  }

  /** Merchant sale: post-sale arrangement; the server validates ownership of
   * the sold copies and credits the shared sell value. */
  sendSell(itemId: string, qty: number, inventory: WireInventory): void {
    this.transport?.send({ t: "sell", itemId, qty, inventory });
  }

  /** Orb of Fortune — the server rolls and answers with the new save. */
  sendGamble(): void {
    this.transport?.send({ t: "gamble" });
  }

  /** The run is lost — the server discards its grants. */
  sendDied(): void {
    this.transport?.send({ t: "died" });
  }

  /** HOST only (the server ignores anyone else): attest that a player
   * legitimately picked up an item, making it bankable for them. */
  attestGrant(playerId: string, itemId: string): void {
    this.transport?.send({ t: "grant", playerId, itemId });
  }

  /** HOST only: attest a gold pickup — gold's provenance path. */
  attestGold(playerId: string, amount: number): void {
    this.transport?.send({ t: "grantGold", playerId, amount });
  }

  // ── Connection plumbing ────────────────────────────────────────────────────

  private async establish(): Promise<void> {
    this.mode = "connecting";
    // Two attempts before giving up — a slow first paint can starve the
    // handshake without the server being down.
    for (let attempt = 0; attempt < 2 && this.mode !== "online"; attempt++) {
      const ws = new WebSocketTransport();
      try {
        this.attach(ws);
        await ws.connect();
        this.mode = "online";
        ws.onClose(() => this.handleDrop());
      } catch {
        this.unsubscribe?.();
        this.transport = null;
      }
    }
    if (this.mode !== "online") {
      const local = new LocalTransport();
      this.attach(local);
      await local.connect();
      this.mode = "offline";
      gameEvents.emit("message", "No server reachable — playing offline");
    }
    useNet.setState({ mode: this.mode });
    this.startPinging();
  }

  /** Unexpected socket drop: try to get back online, re-entering our floor —
   * the normal join path resyncs world state. Falls back to offline. */
  private async handleDrop(): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;
    this.stopPinging();
    this.unsubscribe?.();
    this.transport = null;
    netClock.reset();
    gameEvents.emit("message", "Connection lost — reconnecting…");
    try {
      await this.establish();
      this.login(); // same token → same account, run floor and grants intact
      netBus.emit("reconnected", undefined);
      if (this.currentFloor !== null) {
        this.transport!.send({ t: "enterFloor", floor: this.currentFloor });
      }
      if (this.mode === "online") gameEvents.emit("message", "Reconnected");
    } finally {
      this.reconnecting = false;
    }
  }

  private attach(transport: Transport): void {
    this.unsubscribe?.();
    this.transport?.close();
    this.transport = transport;
    this.unsubscribe = transport.onMessage((msg) => this.handle(msg));
  }

  private startPinging(): void {
    this.stopPinging();
    const ping = () => this.transport?.send({ t: "ping", sent: performance.now() });
    // A quick early burst converges the clock before the first snapshots.
    ping();
    setTimeout(ping, 250);
    setTimeout(ping, 600);
    this.pingTimer = setInterval(ping, 2000);
  }

  private stopPinging(): void {
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }

  private handle(msg: ServerMsg): void {
    switch (msg.t) {
      case "welcome":
        this.playerId = msg.playerId;
        useNet.setState({ playerId: msg.playerId });
        break;
      case "loggedIn":
        storeToken(msg.token);
        netBus.emit("serverSave", msg.save);
        break;
      case "saved":
        netBus.emit("serverSave", msg.save);
        break;
      case "pong":
        netClock.onPong(msg.sent, msg.serverTime);
        break;
      case "floorAssigned": {
        const a = msg.assignment;
        const roster: Record<string, string> = {};
        for (const m of a.members) roster[m.id] = m.name;
        useNet.setState({ hostId: a.hostId, epoch: a.epoch, roster });
        netBus.emit("assigned", a);
        this.pendingAssignment?.(a);
        this.pendingAssignment = null;
        break;
      }
      case "peerJoined": {
        const roster = { ...useNet.getState().roster, [msg.member.id]: msg.member.name };
        useNet.setState({ roster });
        netBus.emit("peerJoined", msg.member);
        gameEvents.emit("message", `${msg.member.name} entered the floor`);
        break;
      }
      case "peerLeft": {
        const roster = { ...useNet.getState().roster };
        const name = roster[msg.playerId];
        delete roster[msg.playerId];
        useNet.setState({ roster });
        netBus.emit("peerLeft", { playerId: msg.playerId });
        if (name) gameEvents.emit("message", `${name} left the floor`);
        break;
      }
      case "hostChanged":
        useNet.setState({ hostId: msg.hostId, epoch: msg.epoch });
        netBus.emit("hostChanged", { hostId: msg.hostId, epoch: msg.epoch });
        if (msg.hostId === this.playerId) {
          gameEvents.emit("message", "You are now the floor host");
        }
        break;
      case "syncRequest":
        netBus.emit("syncRequest", { playerId: msg.playerId });
        break;
      case "msg":
        netBus.emit("envelope", {
          ch: msg.ch,
          from: msg.from,
          epoch: msg.epoch,
          serverTime: msg.serverTime,
          data: msg.data,
        });
        break;
    }
  }
}

export const session = new GameSession();

// Dev-only hook for debugging and end-to-end scripts.
if (typeof window !== "undefined" && import.meta.env?.DEV) {
  (window as unknown as Record<string, unknown>).__session = session;
}
