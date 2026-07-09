import { DUNGEON } from "../core/config";
import { FloorDirectory } from "./matchmaking";
import type { ClientMsg, ServerMsg } from "./protocol";

/** Transport abstraction. Swap LocalTransport for a WebSocketTransport to go
 * online — game code only ever talks to GameSession/Transport. */
export interface Transport {
  connect(): Promise<void>;
  send(msg: ClientMsg): void;
  onMessage(cb: (msg: ServerMsg) => void): () => void;
  close(): void;
}

/** Single-player loopback: a miniature in-process "server" that speaks the
 * real protocol and reuses the real matchmaking logic. */
export class LocalTransport implements Transport {
  private listeners = new Set<(msg: ServerMsg) => void>();
  private directory = new FloorDirectory(DUNGEON.maxPlayersPerFloor);
  private playerId = "local_player";

  async connect(): Promise<void> {
    this.deliver({ t: "welcome", playerId: this.playerId });
  }

  send(msg: ClientMsg): void {
    switch (msg.t) {
      case "hello":
        break;
      case "enterFloor": {
        const inst = this.directory.join(this.playerId, msg.floor);
        this.deliver({
          t: "floorAssigned",
          assignment: {
            instanceId: inst.id,
            floor: inst.floor,
            seed: inst.seed,
            playerCount: inst.players.size,
          },
        });
        break;
      }
      case "leaveDungeon":
        this.directory.leave(this.playerId);
        break;
      case "state":
      case "castAbility":
        // No peers in single-player; the authoritative server would rebroadcast.
        break;
    }
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
