import { gameEvents } from "../core/events";
import type { FloorAssignment, PeerState, ServerMsg, Vec3Like } from "./protocol";
import { LocalTransport, WebSocketTransport, type Transport } from "./transport";

export type SessionMode = "connecting" | "online" | "offline";

/** Client-side session: connects to the game server (falling back to the
 * offline loopback), tracks peers on the current floor instance, and exposes
 * async floor requests to the game state. */
export class GameSession {
  playerId = "";
  mode: SessionMode = "connecting";
  readonly peers = new Map<string, PeerState>();

  private transport: Transport | null = null;
  private unsubscribe: (() => void) | null = null;
  private pendingAssignment: ((a: FloorAssignment) => void) | null = null;

  async ensureConnected(name = "Wizard"): Promise<void> {
    if (this.transport) return;
    // Two attempts before giving up — a slow first paint can starve the
    // handshake without the server being down.
    for (let attempt = 0; attempt < 2 && this.mode !== "online"; attempt++) {
      const ws = new WebSocketTransport();
      try {
        this.attach(ws);
        await ws.connect();
        this.mode = "online";
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
    this.transport!.send({ t: "hello", name });
  }

  /** Ask the server which instance of `floor` we belong to. Resolves with the
   * instance seed used to generate the floor locally. */
  requestFloor(floor: number): Promise<FloorAssignment> {
    return new Promise((resolve, reject) => {
      if (!this.transport) {
        reject(new Error("not connected"));
        return;
      }
      this.pendingAssignment = resolve;
      this.transport.send({ t: "enterFloor", floor });
    });
  }

  leaveDungeon(): void {
    this.peers.clear();
    this.transport?.send({ t: "leaveDungeon" });
  }

  /** Broadcast our transform to floor-mates. Callers throttle (~10 Hz). */
  sendState(position: Vec3Like, yaw: number, staffId: string): void {
    this.transport?.send({ t: "state", position, yaw, staffId });
  }

  /** Tell floor-mates about a cast so they can replay it locally. */
  sendCast(abilityId: string, origin: Vec3Like, dir: Vec3Like): void {
    this.transport?.send({ t: "castAbility", abilityId, origin, dir });
  }

  private attach(transport: Transport): void {
    this.unsubscribe?.();
    this.transport?.close();
    this.transport = transport;
    this.unsubscribe = transport.onMessage((msg) => this.handle(msg));
  }

  private handle(msg: ServerMsg): void {
    switch (msg.t) {
      case "welcome":
        this.playerId = msg.playerId;
        break;
      case "floorAssigned":
        this.peers.clear();
        this.pendingAssignment?.(msg.assignment);
        this.pendingAssignment = null;
        break;
      case "peerJoined":
        this.peers.set(msg.peer.playerId, msg.peer);
        gameEvents.emit("message", `${msg.peer.name} entered the floor`);
        break;
      case "peerLeft": {
        const peer = this.peers.get(msg.playerId);
        this.peers.delete(msg.playerId);
        if (peer) gameEvents.emit("message", `${peer.name} left the floor`);
        break;
      }
      case "snapshot":
        for (const peer of msg.peers) this.peers.set(peer.playerId, peer);
        break;
      case "peerCast":
        gameEvents.emit("peerCast", {
          playerId: msg.playerId,
          abilityId: msg.abilityId,
          origin: msg.origin,
          dir: msg.dir,
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
