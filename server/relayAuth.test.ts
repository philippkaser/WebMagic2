import { beforeEach, describe, expect, test } from "bun:test";
import { FloorDirectory } from "../src/net/matchmaking";
import type { ClientMsg, ServerMsg } from "../src/net/protocol";
import { AccountStore } from "./accounts";
import type { PasswordHasher } from "./auth";
import { Relay, type RelayPeer } from "./relay";

/** The ledger over the wire: what the relay answers to register / sign in /
 * claim / logout, and how the connection's identity follows. */

interface TestPeer extends RelayPeer {
  inbox: ServerMsg[];
}

const fakeHasher: PasswordHasher = {
  hash: async (p) => `fake$${p}`,
  verify: async (p, h) => h === `fake$${p}`,
};

let relay: Relay;
let store: AccountStore;
let now = 50_000;
let n = 0;

function peer(): TestPeer {
  const p: TestPeer = {
    id: `P${++n}`,
    name: "Wizard",
    inbox: [],
    send(msg) {
      p.inbox.push(msg);
    },
  };
  relay.connect(p);
  return p;
}

function last<T extends ServerMsg["t"]>(p: TestPeer, t: T) {
  return [...p.inbox].reverse().find((m) => m.t === t) as Extract<ServerMsg, { t: T }> | undefined;
}

/** Send and let the (fake, async) hashing settle. */
async function send(p: TestPeer, msg: ClientMsg): Promise<void> {
  relay.handle(p.id, msg);
  await new Promise((r) => setTimeout(r, 0));
}

beforeEach(() => {
  now = 50_000;
  store = new AccountStore();
  relay = new Relay(new FloorDirectory(4, () => 1234, () => now, () => 0), store, () => now, () => {}, {
    hasher: fakeHasher,
  });
});

describe("register and sign in", () => {
  test("register answers authOk with a session token, and the connection is that wizard", async () => {
    const a = peer();
    await send(a, { t: "register", username: "Orla", password: "password1", name: "Orla the Grey" });
    const ok = last(a, "authOk")!;
    expect(ok.username).toBe("Orla");
    expect(ok.name).toBe("Orla the Grey");
    expect(ok.token).toMatch(/^[0-9a-f]{64}$/);
    expect(ok.save.deepest).toBe(0);
    expect(a.name).toBe("Orla the Grey");
    // Bound: a floor entry runs on this account.
    relay.handle(a.id, { t: "enterFloor", floor: 1, fresh: true });
    expect(store.get(store.all().next().value!.token)!.runFloors).toBe(1);
  });

  test("the session token resumes the same wizard on a new connection (loggedIn names the member)", async () => {
    const a = peer();
    await send(a, { t: "register", username: "Orla", password: "password1" });
    const token = last(a, "authOk")!.token;
    [...store.all()][0]!.deepest = 12;
    const b = peer();
    await send(b, { t: "login", name: "Orla", token });
    const back = last(b, "loggedIn")!;
    expect(back.token).toBe(token);
    expect(back.username).toBe("Orla");
    expect(back.save.deepest).toBe(12);
  });

  test("guests' loggedIn carries no username", async () => {
    const a = peer();
    await send(a, { t: "login", name: "Dana" });
    expect(last(a, "loggedIn")!.username).toBeUndefined();
  });

  test("sign in from a fresh connection reaches the same save; a wrong password is refused", async () => {
    const a = peer();
    await send(a, { t: "register", username: "Orla", password: "password1" });
    [...store.all()][0]!.inventory.gold = 77;
    const b = peer();
    await send(b, { t: "loginPassword", username: "orla", password: "nope-nope" });
    expect(last(b, "authError")!.reason).toBe("bad-credentials");
    expect(last(b, "authOk")).toBeUndefined();
    await send(b, { t: "loginPassword", username: "orla", password: "password1" });
    const ok = last(b, "authOk")!;
    expect(ok.save.inventory.gold).toBe(77);
    expect(ok.token).not.toBe(last(a, "authOk")!.token);
  });

  test("taken usernames, bad shapes and junk payloads come back as authError", async () => {
    const a = peer();
    await send(a, { t: "register", username: "Orla", password: "password1" });
    const b = peer();
    await send(b, { t: "register", username: "ORLA", password: "password1" });
    expect(last(b, "authError")!.reason).toBe("username-taken");
    await send(b, { t: "register", username: "x", password: "password1" });
    expect(last(b, "authError")!.reason).toBe("bad-username");
    await send(b, { t: "register", username: 5, password: null } as unknown as ClientMsg);
    expect(last(b, "authError")!.reason).toBe("bad-username");
  });

  test("repeated failures are rate-limited with a retry hint", async () => {
    const a = peer();
    for (let i = 0; i < 6; i++) await send(a, { t: "loginPassword", username: "Ghost", password: `wrong${i}xx` });
    await send(a, { t: "loginPassword", username: "Ghost", password: "whatever1" });
    const err = last(a, "authError")!;
    expect(err.reason).toBe("rate-limited");
    expect(err.retryAfterMs).toBeGreaterThan(0);
  });

  test("the ledger is shut mid-dungeon: no wizard changes hands on a floor", async () => {
    const a = peer();
    await send(a, { t: "login", name: "Dana" });
    relay.handle(a.id, { t: "enterFloor", floor: 1, fresh: true });
    await send(a, { t: "loginPassword", username: "Orla", password: "password1" });
    expect(last(a, "authError")!.reason).toBe("in-dungeon");
    await send(a, { t: "logout" });
    expect(last(a, "authError")!.reason).toBe("in-dungeon");
    expect(last(a, "loggedOut")).toBeUndefined();
  });

  test("a connection that leaves mid-hash is simply dropped", async () => {
    const a = peer();
    relay.handle(a.id, { t: "register", username: "Orla", password: "password1" });
    relay.disconnect(a.id);
    await new Promise((r) => setTimeout(r, 0));
    expect(last(a, "authOk")).toBeUndefined();
    expect(store.size).toBe(0);
  });
});

describe("sessions over the wire", () => {
  test("a lapsed session token is told so — no silent new guest", async () => {
    const a = peer();
    await send(a, { t: "register", username: "Orla", password: "password1" });
    const token = last(a, "authOk")!.token;
    now += 31 * 24 * 60 * 60 * 1000;
    const b = peer();
    const before = store.size;
    await send(b, { t: "login", name: "Orla", token });
    expect(last(b, "authError")!.reason).toBe("session-expired");
    expect(last(b, "loggedIn")).toBeUndefined();
    expect(store.size).toBe(before);
  });

  test("logout revokes the token and unbinds; signing in again works", async () => {
    const a = peer();
    await send(a, { t: "register", username: "Orla", password: "password1" });
    const token = last(a, "authOk")!.token;
    await send(a, { t: "logout" });
    expect(last(a, "loggedOut")).toBeDefined();
    expect(a.name).toBe("Wizard");
    const b = peer();
    await send(b, { t: "login", name: "Orla", token });
    expect(last(b, "authError")!.reason).toBe("session-expired");
    await send(b, { t: "loginPassword", username: "Orla", password: "password1" });
    expect(last(b, "authOk")!.username).toBe("Orla");
  });

  test("logout everywhere revokes every device's token", async () => {
    const a = peer();
    await send(a, { t: "register", username: "Orla", password: "password1" });
    const b = peer();
    await send(b, { t: "loginPassword", username: "Orla", password: "password1" });
    const tokenB = last(b, "authOk")!.token;
    await send(a, { t: "logout", everywhere: true });
    const c = peer();
    await send(c, { t: "login", name: "Orla", token: tokenB });
    expect(last(c, "authError")!.reason).toBe("session-expired");
  });
});

describe("claiming a guest", () => {
  test("the guest's progress carries over; its device token stops opening it", async () => {
    const a = peer();
    await send(a, { t: "login", name: "Dana" });
    const device = last(a, "loggedIn")!.token;
    const guest = store.get(device)!;
    guest.deepest = 9;
    guest.inventory.gold = 300;
    await send(a, { t: "claim", username: "Dana", password: "password1" });
    const ok = last(a, "authOk")!;
    expect(ok.username).toBe("Dana");
    expect(ok.save.deepest).toBe(9);
    expect(ok.save.inventory.gold).toBe(300);
    expect(store.size).toBe(1);
    // The device token is retired …
    const b = peer();
    await send(b, { t: "login", name: "Dana", token: device });
    expect(last(b, "authError")!.reason).toBe("session-expired");
    // … the session token and the password open the same wizard.
    await send(b, { t: "login", name: "Dana", token: ok.token });
    expect(last(b, "loggedIn")!.save.deepest).toBe(9);
    const c = peer();
    await send(c, { t: "loginPassword", username: "dana", password: "password1" });
    expect(last(c, "authOk")!.save.inventory.gold).toBe(300);
  });

  test("a connection with no wizard has nothing to claim; a member can't claim twice", async () => {
    const a = peer();
    await send(a, { t: "claim", username: "Dana", password: "password1" });
    expect(last(a, "authError")!.reason).toBe("no-wizard");
    await send(a, { t: "register", username: "Orla", password: "password1" });
    await send(a, { t: "claim", username: "Orla2", password: "password1" });
    expect(last(a, "authError")!.reason).toBe("already-claimed");
  });
});
