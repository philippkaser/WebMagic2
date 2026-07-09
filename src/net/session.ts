import type { FloorAssignment, PeerState, ServerMsg } from "./protocol";
import { LocalTransport, type Transport } from "./transport";

/** Client-side session: owns the transport, tracks peers on the current floor
 * instance, and exposes async floor requests to the game state. */
export class GameSession {
  playerId = "";
  readonly peers = new Map<string, PeerState>();

  private transport: Transport;
  private pendingAssignment: ((a: FloorAssignment) => void) | null = null;
  private connected = false;

  constructor(transport: Transport = new LocalTransport()) {
    this.transport = transport;
    this.transport.onMessage((msg) => this.handle(msg));
  }

  async ensureConnected(name = "Wizard"): Promise<void> {
    if (this.connected) return;
    await this.transport.connect();
    this.transport.send({ t: "hello", name });
    this.connected = true;
  }

  /** Ask the server which instance of `floor` we belong to. Resolves with the
   * instance seed used to generate the floor locally. */
  requestFloor(floor: number): Promise<FloorAssignment> {
    return new Promise((resolve) => {
      this.pendingAssignment = resolve;
      this.transport.send({ t: "enterFloor", floor });
    });
  }

  leaveDungeon(): void {
    this.peers.clear();
    this.transport.send({ t: "leaveDungeon" });
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
        break;
      case "peerLeft":
        this.peers.delete(msg.playerId);
        break;
      case "snapshot":
        for (const peer of msg.peers) this.peers.set(peer.playerId, peer);
        break;
      case "peerCast":
        // Future: replay peer ability VFX locally.
        break;
    }
  }
}

export const session = new GameSession();
