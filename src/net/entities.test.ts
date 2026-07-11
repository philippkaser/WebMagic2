import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { netBus } from "./bus";
import { netClock } from "./clock";
import {
  authorityTick,
  registerNetEntity,
  registerSyncProvider,
  replicaFrame,
  resetNetEntities,
  setExpectedEntities,
  type NetBodyLike,
} from "./entities";
import { useNet } from "./netStore";
import { session } from "./session";

/** The replication core exercised headlessly: the net store is put into
 * host/replica states directly, envelopes are injected through the netBus
 * (exactly what the session does with relayed messages), and outbound traffic
 * is captured by spying on session.sendEnvelope. */

interface FakeBody extends NetBodyLike {
  pos: { x: number; y: number; z: number };
  vel: { x: number; y: number; z: number };
  sleeping: boolean;
  /** Every pose replicaFrame drove into the body. */
  driven: { x: number; y: number; z: number }[];
}

function fakeBody(x = 0, y = 0, z = 0): FakeBody {
  const body: FakeBody = {
    pos: { x, y, z },
    vel: { x: 0, y: 0, z: 0 },
    sleeping: false,
    driven: [],
    translation: () => body.pos,
    rotation: () => ({ x: 0, y: 0, z: 0, w: 1 }),
    linvel: () => body.vel,
    setNextKinematicTranslation: (v) => body.driven.push({ ...v }),
    setNextKinematicRotation: () => {},
    setLinvel: (v) => {
      body.vel = { ...v };
    },
    isSleeping: () => body.sleeping,
  };
  return body;
}

function asHost(): void {
  useNet.setState({ mode: "online", playerId: "me", hostId: "me", epoch: 1, roster: { me: "Me" } });
}

function asReplica(): void {
  useNet.setState({
    mode: "online",
    playerId: "me",
    hostId: "other",
    epoch: 1,
    roster: { me: "Me", other: "Other" },
  });
}

interface Sent {
  ch: string;
  data: unknown;
  to?: string;
}

let sent: Sent[] = [];

function inject(ch: string, data: unknown, opts: { from?: string; serverTime?: number } = {}): void {
  netBus.emit("envelope", {
    ch,
    from: opts.from ?? "other",
    epoch: 1,
    serverTime: opts.serverTime ?? netClock.serverNow(),
    data,
  });
}

beforeEach(() => {
  sent = [];
  (session as unknown as { sendEnvelope: unknown }).sendEnvelope = (
    ch: string,
    data: unknown,
    to?: string,
  ) => {
    sent.push({ ch, data, to });
  };
});

afterEach(() => {
  // Remove the own-property spy so the prototype method is back in charge.
  delete (session as unknown as { sendEnvelope?: unknown }).sendEnvelope;
  resetNetEntities();
  useNet.setState({ mode: "connecting", playerId: "", hostId: "", epoch: 0, roster: {} });
});

const snapsOf = (s: Sent) => (s.data as { ents: { id: string; p: number[]; f?: Record<string, number> }[] }).ents;

describe("authorityTick delta filter", () => {
  test("sends a fresh entity once, then goes quiet while it is unchanged", () => {
    asHost();
    const body = fakeBody(1, 2, 3);
    registerNetEntity({ id: "e1", body: () => body });

    authorityTick();
    expect(sent).toHaveLength(1);
    expect(sent[0].ch).toBe("a:snap");
    expect(snapsOf(sent[0])[0]).toMatchObject({ id: "e1", p: [1, 2, 3] });

    authorityTick(); // nothing moved, keepalive not due
    expect(sent).toHaveLength(1);
  });

  test("resends when the entity moves or a field changes", () => {
    asHost();
    const body = fakeBody(0, 0, 0);
    let hp = 30;
    registerNetEntity({ id: "e1", body: () => body, fields: () => ({ hp }) });

    authorityTick();
    body.pos = { x: 5, y: 0, z: 0 };
    authorityTick();
    expect(sent).toHaveLength(2);

    hp = 12; // damage — fields differ even though the body is still
    authorityTick();
    expect(sent).toHaveLength(3);
    expect(snapsOf(sent[2])[0].f).toEqual({ hp: 12 });
  });

  test("a sleeping, settled entity stops broadcasting entirely", () => {
    asHost();
    const body = fakeBody(0, 0, 0);
    body.sleeping = true;
    registerNetEntity({ id: "e1", body: () => body });

    authorityTick(); // records the settled pose
    authorityTick();
    authorityTick();
    expect(sent).toHaveLength(1);
  });
});

describe("replica snapshot application", () => {
  test("incoming snaps drive the kinematic body through interpolated poses", () => {
    asReplica();
    const body = fakeBody();
    registerNetEntity({ id: "e1", body: () => body });

    // Two snaps straddling the render time (serverNow − 140 ms delay).
    const now = netClock.serverNow();
    inject("a:snap", { ents: [{ id: "e1", p: [0, 0, 0] }] }, { serverTime: now - 200 });
    inject("a:snap", { ents: [{ id: "e1", p: [10, 0, 0] }] }, { serverTime: now - 100 });

    replicaFrame();
    expect(body.driven).toHaveLength(1);
    // renderTime lands 60% of the way through the 100 ms segment.
    expect(body.driven[0].x).toBeGreaterThan(4);
    expect(body.driven[0].x).toBeLessThan(8);
  });

  test("snap fields reach onFields", () => {
    asReplica();
    const seen: Record<string, number>[] = [];
    registerNetEntity({ id: "e1", body: () => fakeBody(), onFields: (f) => seen.push(f) });
    inject("a:snap", { ents: [{ id: "e1", p: [0, 0, 0], f: { hp: 7 } }] });
    expect(seen).toEqual([{ hp: 7 }]);
  });
});

describe("despawns", () => {
  test("live despawn fires onDespawn with catchup=false", () => {
    asReplica();
    const calls: { data: unknown; catchup: boolean }[] = [];
    registerNetEntity({
      id: "e1",
      body: () => fakeBody(),
      onDespawn: (data, catchup) => calls.push({ data, catchup }),
    });
    inject("a:despawn", { id: "e1", data: { boom: true } });
    expect(calls).toEqual([{ data: { boom: true }, catchup: false }]);
  });

  test("a despawn arriving before the entity mounts replays silently on mount", async () => {
    asReplica();
    inject("a:despawn", { id: "late" }); // floor still loading — nothing registered
    const calls: boolean[] = [];
    registerNetEntity({
      id: "late",
      body: () => fakeBody(),
      onDespawn: (_d, catchup) => calls.push(catchup),
    });
    await new Promise((r) => setTimeout(r, 0)); // replay is queued as a microtask
    expect(calls).toEqual([true]);
  });
});

describe("commands", () => {
  test("host routes an incoming command to the entity's onCommand", () => {
    asHost();
    const calls: { cmd: string; data: unknown; from: string }[] = [];
    registerNetEntity({
      id: "e1",
      body: () => fakeBody(),
      onCommand: (cmd, data, from) => calls.push({ cmd, data, from }),
    });
    inject("h:entityCmd", { id: "e1", cmd: "hit", data: { damage: 9 } }, { from: "peer2" });
    expect(calls).toEqual([{ cmd: "hit", data: { damage: 9 }, from: "peer2" }]);
  });

  test("on the host, handle.command dispatches locally without touching the network", () => {
    asHost();
    const calls: string[] = [];
    const handle = registerNetEntity({
      id: "e1",
      body: () => fakeBody(),
      onCommand: (cmd) => calls.push(cmd),
    });
    handle.command("hit", {});
    expect(calls).toEqual(["hit"]);
    expect(sent).toHaveLength(0);
  });
});

describe("late-join world sync", () => {
  test("host answers a syncRequest with dead ids, live snaps and provider data", () => {
    asHost();
    setExpectedEntities(["e1", "e2", "e3"]);
    registerNetEntity({ id: "e1", body: () => fakeBody(1, 0, 0), fields: () => ({ hp: 5 }) });
    registerNetEntity({ id: "e3", body: () => fakeBody(3, 0, 0) });
    // e2 died earlier this run — it is expected but not registered.
    const unregister = registerSyncProvider("orbs", {
      collect: () => ["orb_1"],
      apply: () => {},
    });

    netBus.emit("syncRequest", { playerId: "joiner" });

    expect(sent).toHaveLength(1);
    expect(sent[0].ch).toBe("a:worldSync");
    expect(sent[0].to).toBe("joiner");
    const msg = sent[0].data as { dead: string[]; ents: { id: string }[]; custom: Record<string, unknown> };
    expect(msg.dead).toEqual(["e2"]);
    expect(msg.ents.map((e) => e.id).sort()).toEqual(["e1", "e3"]);
    expect(msg.custom).toEqual({ orbs: ["orb_1"] });
    unregister();
  });

  test("joining replica applies dead entities, fields and provider payloads as catchup", () => {
    asReplica();
    const despawns: boolean[] = [];
    const fields: Record<string, number>[] = [];
    registerNetEntity({
      id: "dead1",
      body: () => fakeBody(),
      onDespawn: (_d, catchup) => despawns.push(catchup),
    });
    registerNetEntity({ id: "alive1", body: () => fakeBody(), onFields: (f) => fields.push(f) });
    const applied: { data: unknown; catchup: boolean }[] = [];
    const unregister = registerSyncProvider("orbs", {
      collect: () => [],
      apply: (data, catchup) => applied.push({ data, catchup }),
    });

    inject("a:worldSync", {
      dead: ["dead1"],
      ents: [{ id: "alive1", p: [0, 0, 0], f: { hp: 3 } }],
      custom: { orbs: ["orb_9"] },
    });

    expect(despawns).toEqual([true]);
    expect(fields).toEqual([{ hp: 3 }]);
    expect(applied).toEqual([{ data: ["orb_9"], catchup: true }]);
    unregister();
  });
});
