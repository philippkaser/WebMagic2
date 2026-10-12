import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkAccountsFile } from "./accounts";
import { DataFile, stamp } from "./storage";

/** storage.ts against a real temp directory: atomic writes, rotating
 * backups, and never overwriting a file it couldn't read. */

let dir: string;
let file: string;
let now: number;
let logs: string[];

function make(opts: Partial<ConstructorParameters<typeof DataFile>[0]> = {}): DataFile {
  return new DataFile({
    file,
    now: () => now,
    log: (t) => logs.push(t),
    validate: checkAccountsFile,
    debounceMs: 5,
    ...opts,
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const doc = (n: number) => JSON.stringify({ version: 2, accounts: [{ token: `t${n}`, name: `W${n}` }] });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "wm-storage-"));
  file = join(dir, "wm.json");
  now = Date.UTC(2026, 9, 12, 12, 0, 0);
  logs = [];
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("writing", () => {
  test("no file → a fresh start (null), and nothing is invented", () => {
    expect(make().load()).toBeNull();
    expect(existsSync(file)).toBe(false);
  });

  test("debounced writes coalesce into one atomic write of the newest state", async () => {
    const store = make();
    store.load();
    store.schedule(doc(1));
    store.schedule(doc(2));
    store.schedule(doc(3));
    expect(store.dirty).toBe(true);
    await sleep(20);
    await store.flush();
    expect(readFileSync(file, "utf8")).toBe(doc(3));
    // No temp files left behind.
    expect(readdirSync(dir).filter((n) => n.includes(".tmp-"))).toEqual([]);
  });

  test("writes replace the file by rename — a reader never sees half a file", async () => {
    const store = make();
    writeFileSync(file, doc(0));
    store.load();
    const big = JSON.stringify({ version: 2, accounts: Array.from({ length: 5000 }, (_, i) => ({ token: `t${i}`, name: "x".repeat(40) })) });
    store.schedule(big);
    const writing = store.flush();
    // While the async write runs, the file is always one whole document.
    for (let i = 0; i < 20; i++) {
      const text = readFileSync(file, "utf8");
      expect(() => JSON.parse(text)).not.toThrow();
      await sleep(0);
    }
    await writing;
    expect(readFileSync(file, "utf8")).toBe(big);
  });

  test("flushSync writes what's pending at shutdown, and nothing lands after it", async () => {
    const store = make({ debounceMs: 10_000 });
    store.load();
    store.schedule(doc(7));
    store.flushSync();
    expect(readFileSync(file, "utf8")).toBe(doc(7));
    store.schedule(doc(8)); // too late: closed
    await store.flush();
    expect(readFileSync(file, "utf8")).toBe(doc(7));
  });

  test("a failed write is retried rather than lost", async () => {
    // The data file's directory is a FILE: the first write must fail.
    const blocked = join(dir, "blocked");
    writeFileSync(blocked, "not a dir");
    const store = new DataFile({ file: join(blocked, "wm.json"), log: (t) => logs.push(t), debounceMs: 1 });
    store.schedule(doc(1));
    await store.flush();
    expect(logs.some((l) => l.includes("save write failed"))).toBe(true);
    expect(store.dirty).toBe(true); // queued again for the retry
    // Shutdown still tries, and says so (server.ts logs it).
    expect(() => store.flushSync()).toThrow();
  });
});

describe("backups", () => {
  test("a good file is snapshotted on startup", () => {
    writeFileSync(file, doc(1));
    expect(make().load()).toBe(doc(1));
    const backups = make().backups();
    expect(backups).toHaveLength(1);
    expect(backups[0]).toContain("startup");
    expect(readFileSync(join(dir, "backups", backups[0]!), "utf8")).toBe(doc(1));
  });

  test("at most one snapshot per interval while data changes, the oldest pruned", async () => {
    writeFileSync(file, doc(0));
    const store = make({ keepBackups: 3, backupEveryMs: 60_000 });
    store.load(); // startup snapshot
    for (let i = 1; i <= 6; i++) {
      now += 30_000; // every other write crosses the interval
      store.schedule(doc(i));
      await store.flush();
    }
    const names = store.backups();
    expect(names).toHaveLength(3);
    // The newest snapshot is the newest data written at an interval mark.
    expect(readFileSync(join(store.backupDir, names.at(-1)!), "utf8")).toBe(doc(6));
    // Names sort by time.
    expect([...names].sort()).toEqual(names);
  });

  test("timestamps are filesystem-safe and sortable", () => {
    expect(stamp(Date.UTC(2026, 0, 2, 3, 4, 5, 6))).toBe("2026-01-02T03-04-05-006Z");
  });
});

describe("a file it can't read is never overwritten", () => {
  test("corrupt JSON is moved aside, loudly, and the newest readable backup restored", () => {
    // Two snapshots exist; the newer one is itself damaged.
    const backups = join(dir, "backups");
    mkdirSync(backups);
    writeFileSync(join(backups, `wm.json.${stamp(now - 7200_000)}-hourly.json`), doc(1));
    writeFileSync(join(backups, `wm.json.${stamp(now - 3600_000)}-hourly.json`), "{truncated");
    writeFileSync(file, '{"version":2,"accounts":[{"tok');
    const text = make().load();
    expect(text).toBe(doc(1));
    expect(readFileSync(file, "utf8")).toBe(doc(1));
    const aside = readdirSync(dir).filter((n) => n.startsWith("wm.json.corrupt-"));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(dir, aside[0]!), "utf8")).toBe('{"version":2,"accounts":[{"tok');
    expect(logs.some((l) => l.includes("UNREADABLE"))).toBe(true);
    expect(logs.some((l) => l.includes("RESTORED"))).toBe(true);
  });

  test("with no usable backup it starts empty — but keeps the unreadable file", () => {
    writeFileSync(file, "garbage");
    expect(make().load()).toBeNull();
    expect(existsSync(file)).toBe(false);
    expect(readdirSync(dir).some((n) => n.startsWith("wm.json.corrupt-"))).toBe(true);
    expect(logs.some((l) => l.includes("NO READABLE BACKUP"))).toBe(true);
  });

  test("an empty file and valid-JSON-but-not-accounts are corrupt too", () => {
    writeFileSync(file, "");
    expect(make().load()).toBeNull();
    writeFileSync(file, '{"hello":"world"}');
    now += 1;
    expect(make().load()).toBeNull();
    expect(readdirSync(dir).filter((n) => n.startsWith("wm.json.corrupt-"))).toHaveLength(2);
  });

  test("the old bare-array format is not corrupt", () => {
    writeFileSync(file, JSON.stringify([{ token: "old", name: "Vet" }]));
    expect(make().load()).toContain("old");
    expect(readdirSync(dir).some((n) => n.includes("corrupt"))).toBe(false);
  });

  test("a file from a newer server refuses to start and is left untouched", () => {
    const newer = JSON.stringify({ version: 99, accounts: [] });
    writeFileSync(file, newer);
    expect(() => make().load()).toThrow(/version 99/);
    expect(readFileSync(file, "utf8")).toBe(newer);
  });
});
