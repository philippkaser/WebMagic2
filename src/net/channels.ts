import { netBus } from "./bus";
import { isHost, useNet } from "./netStore";
import { CHANNEL_AUTHORITY, CHANNEL_PEER, CHANNEL_TO_HOST } from "./protocol";
import { session } from "./session";

/** Typed gameplay messages over the relay's opaque envelopes.
 *
 * Game systems declare messages at module level and never look at sockets,
 * hosts or the server again. Three shapes cover everything:
 *
 *  - hostEvent:   authoritative fact ("this orb spawned", "the boss fired").
 *                 `announce()` applies it locally AND broadcasts when we are
 *                 the host; on replicas the handler runs on receive. Exactly
 *                 one simulation ever decides the fact.
 *  - hostCommand: request for the authority ("give me this orb", "apply this
 *                 hit"). `request()` dispatches locally when we ARE the host
 *                 (single-player = the same code path, no branches at call
 *                 sites) and sends to the host otherwise.
 *  - peerMessage: non-authoritative broadcast between players ("I cast this
 *                 spell"), replayed by everyone else.
 *
 * Meta passed to handlers carries `from` (player id) and `serverTime` (the
 * shared timeline — use it to compensate latency when replaying). */

export interface MsgMeta {
  from: string;
  serverTime: number;
  /** True when the handler runs on the machine that announced/requested. */
  self: boolean;
}

type Handler<T> = (data: T, meta: MsgMeta) => void;

const handlers = new Map<string, Set<Handler<never>>>();

function subscribe<T>(ch: string, fn: Handler<T>): () => void {
  let set = handlers.get(ch);
  if (!set) {
    set = new Set();
    handlers.set(ch, set);
  }
  set.add(fn as Handler<never>);
  return () => set!.delete(fn as Handler<never>);
}

function dispatch<T>(ch: string, data: T, meta: MsgMeta): void {
  const set = handlers.get(ch);
  if (!set) return;
  for (const fn of set) (fn as Handler<T>)(data, meta);
}

netBus.on("envelope", (env) => {
  dispatch(env.ch, env.data, { from: env.from, serverTime: env.serverTime, self: false });
});

function localMeta(): MsgMeta {
  return {
    from: useNet.getState().playerId || "self",
    serverTime: 0, // filled by callers that care; local application is "now"
    self: true,
  };
}

const usedNames = new Set<string>();

function claim(ch: string): string {
  // Warn (don't throw): a genuine collision is a bug, but vite HMR re-running
  // a defining module must not take the game down.
  if (usedNames.has(ch)) console.warn(`[net] duplicate message name: ${ch}`);
  usedNames.add(ch);
  return ch;
}

export interface HostEvent<T> {
  /** Host only (no-op otherwise): apply the fact locally and broadcast it. */
  announce(data: T): void;
  /** Runs everywhere the fact applies — locally on announce, on receive on
   * replicas. Register once at module/mount level. */
  on(handler: Handler<T>): () => void;
}

export function hostEvent<T>(name: string, handler?: Handler<T>): HostEvent<T> {
  const ch = claim(CHANNEL_AUTHORITY + name);
  if (handler) subscribe(ch, handler);
  return {
    announce(data: T) {
      if (!isHost()) return;
      session.sendEnvelope(ch, data);
      dispatch(ch, data, localMeta());
    },
    on: (fn) => subscribe(ch, fn),
  };
}

export interface HostCommand<T> {
  /** Anyone: ask the authority to do this. On the host it dispatches
   * immediately (single-player never touches the network). */
  request(data: T): void;
  /** Authority-side handler. Guarded — never fires on non-hosts. */
  on(handler: Handler<T>): () => void;
}

export function hostCommand<T>(name: string, handler?: Handler<T>): HostCommand<T> {
  const ch = claim(CHANNEL_TO_HOST + name);
  const guarded = (fn: Handler<T>): Handler<T> => (data, meta) => {
    if (isHost()) fn(data, meta);
  };
  if (handler) subscribe(ch, guarded(handler));
  return {
    request(data: T) {
      if (isHost()) dispatch(ch, data, localMeta());
      else session.sendEnvelope(ch, data);
    },
    on: (fn) => subscribe(ch, guarded(fn)),
  };
}

export interface PeerMessage<T> {
  /** Broadcast to the other players on the floor (never echoed back). */
  send(data: T): void;
  on(handler: Handler<T>): () => void;
}

export function peerMessage<T>(name: string, handler?: Handler<T>): PeerMessage<T> {
  const ch = claim(CHANNEL_PEER + name);
  if (handler) subscribe(ch, handler);
  return {
    send: (data: T) => session.sendEnvelope(ch, data),
    on: (fn) => subscribe(ch, fn),
  };
}

/** Raw authority send with a direct recipient — used by the world-sync layer
 * (host → one late joiner). Not for gameplay code. */
export function sendAuthorityTo(name: string, data: unknown, to: string): void {
  session.sendEnvelope(CHANNEL_AUTHORITY + name, data, to);
}

export function onAuthority<T>(name: string, fn: Handler<T>): () => void {
  return subscribe(CHANNEL_AUTHORITY + name, fn);
}
