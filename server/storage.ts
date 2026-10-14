import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, unlinkSync, writeSync } from "node:fs";
import { open, rename, unlink } from "node:fs/promises";
import { basename, dirname, join } from "node:path";

/** The data file, kept safe: the one place the server's saves touch disk.
 *
 *  - **Atomic writes** — every write goes to a temp file beside the data
 *    file, is fsynced, then renamed over it. A crash mid-write leaves the
 *    old file whole, never half a file.
 *  - **Debounced** — `schedule(json)` coalesces a burst of mutations into
 *    one write (the AccountStore's `persist` seam calls it after every
 *    change); `flushSync()` writes whatever is pending at shutdown.
 *  - **Rotating backups** in `backups/` next to the data file: one on
 *    startup and then at most one per `backupEveryMs` while data changes,
 *    keeping the newest `keepBackups`.
 *  - **Never overwrites what it couldn't read.** A data file that doesn't
 *    parse (or fails the caller's `validate`) is moved aside as
 *    `<file>.corrupt-<timestamp>`, loudly, and the newest backup that does
 *    parse is restored in its place; only with no usable backup does it
 *    start empty. `validate` may throw to refuse to start at all (e.g. a
 *    file from a newer server).
 *
 * Synchronous node:fs for load/shutdown, async for the hot path, so the
 * whole thing is testable against a temp directory. */

export interface StorageOptions {
  file: string;
  /** Default: `backups/` beside the data file. */
  backupDir?: string;
  /** Snapshots to keep (oldest pruned). */
  keepBackups?: number;
  /** At most one snapshot per this interval while data changes. */
  backupEveryMs?: number;
  /** Debounce for `schedule`. */
  debounceMs?: number;
  now?: () => number;
  log?: (text: string) => void;
  /** Shape check on the parsed file: null = fine, else why it's corrupt.
   * Throw to refuse to start. */
  validate?: (parsed: unknown) => string | null;
}

const RETRY_MS = 5000;

/** Filesystem-safe ISO timestamp: 2026-10-12T14-03-22-123Z (sorts by time). */
export function stamp(ms: number): string {
  return new Date(ms).toISOString().replace(/:/g, "-").replace(".", "-");
}

const resolve = (p: string | (() => string)): string => (typeof p === "function" ? p() : p);

export class DataFile {
  readonly file: string;
  readonly backupDir: string;
  private keep: number;
  private every: number;
  private debounceMs: number;
  private now: () => number;
  private log: (text: string) => void;
  private validate: (parsed: unknown) => string | null;

  private pending: string | (() => string) | null = null;
  /** What the async write in progress is writing. */
  private inflight: string | null = null;
  /** After flushSync: no more async writes may land. */
  private closed = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The write chain: one write at a time, in order. */
  private writing: Promise<void> = Promise.resolve();
  private lastBackupAt = -Infinity;
  private tmpSeq = 0;

  constructor(opts: StorageOptions) {
    this.file = opts.file;
    this.backupDir = opts.backupDir ?? join(dirname(opts.file), "backups");
    this.keep = Math.max(1, opts.keepBackups ?? 48);
    this.every = opts.backupEveryMs ?? 60 * 60 * 1000;
    this.debounceMs = opts.debounceMs ?? 300;
    this.now = opts.now ?? (() => Date.now());
    this.log = opts.log ?? (() => {});
    this.validate = opts.validate ?? (() => null);
  }

  /** Read the data file for startup. Returns its text, or null for a fresh
   * start (no file — or a corrupt one with no usable backup, which is moved
   * aside first). A good file is snapshotted as the startup backup. */
  load(): string | null {
    if (!existsSync(this.file)) {
      this.log(`no data file at ${this.file} — starting fresh`);
      return null;
    }
    const text = readFileSync(this.file, "utf8");
    const problem = this.problemWith(text);
    if (problem === null) {
      this.backup(text, "startup");
      return text;
    }
    const aside = `${this.file}.corrupt-${stamp(this.now())}`;
    renameSync(this.file, aside);
    this.log(`!!! DATA FILE UNREADABLE (${problem}) — moved aside to ${aside}`);
    for (const name of this.backups().reverse()) {
      const path = join(this.backupDir, name);
      const backup = readFileSync(path, "utf8");
      if (this.problemWith(backup) !== null) continue;
      this.writeSync(backup);
      this.log(`!!! RESTORED the newest readable backup ${path} — changes since it are lost`);
      return backup;
    }
    this.log("!!! NO READABLE BACKUP — starting EMPTY (the unreadable file is kept beside it)");
    return null;
  }

  /** Debounced write (the persist seam). Takes the text, or a function that
   * makes it — called only when the write actually happens. */
  schedule(json: string | (() => string)): void {
    if (this.closed) return;
    this.pending = json;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.debounceMs);
  }

  /** Write whatever is pending now (async, atomic, in order). A failed
   * write (disk full…) is retried unless a newer one has queued. */
  flush(): Promise<void> {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const json = this.pending === null ? null : resolve(this.pending);
    if (json === null || this.closed) return this.writing;
    this.pending = null;
    this.writing = this.writing.then(async () => {
      this.inflight = json;
      try {
        await this.writeAsync(json);
        this.maybeBackup(json);
      } catch (err) {
        if (this.closed) return;
        this.log(`save write failed: ${err} — retrying`);
        if (this.pending === null) {
          this.pending = json;
          this.timer = setTimeout(() => {
            this.timer = null;
            void this.flush();
          }, RETRY_MS);
        }
      } finally {
        this.inflight = null;
      }
    });
    return this.writing;
  }

  /** Shutdown: write the newest state synchronously (signals can't await) —
   * what's pending, or else what an unfinished async write was writing —
   * and stop. Call it right before exiting. */
  flushSync(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.closed = true;
    const json = this.pending !== null ? resolve(this.pending) : this.inflight;
    this.pending = null;
    if (json !== null) this.writeSync(json);
  }

  /** True while a write is waiting for its debounce. */
  get dirty(): boolean {
    return this.pending !== null;
  }

  /** Snapshot names, oldest first. */
  backups(): string[] {
    if (!existsSync(this.backupDir)) return [];
    const prefix = `${basename(this.file)}.`;
    return readdirSync(this.backupDir)
      .filter((n) => n.startsWith(prefix) && n.endsWith(".json") && !n.includes(".tmp-"))
      .sort();
  }

  /** Take a snapshot of `json` now (atomically) and prune old ones. */
  backup(json: string, reason: string): string {
    mkdirSync(this.backupDir, { recursive: true });
    const path = join(this.backupDir, `${basename(this.file)}.${stamp(this.now())}-${reason}.json`);
    atomicWriteSync(path, json, this.nextTmp(path));
    this.lastBackupAt = this.now();
    const all = this.backups();
    for (const old of all.slice(0, Math.max(0, all.length - this.keep))) {
      try {
        unlinkSync(join(this.backupDir, old));
      } catch {
        // Already gone — fine.
      }
    }
    return path;
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  private problemWith(text: string): string | null {
    if (text.trim().length === 0) return "empty";
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      return `not JSON: ${(err as Error).message}`;
    }
    return this.validate(parsed);
  }

  private maybeBackup(json: string): void {
    if (this.now() - this.lastBackupAt < this.every) return;
    try {
      this.backup(json, "hourly");
    } catch (err) {
      this.log(`backup failed: ${err}`);
    }
  }

  private nextTmp(target: string): string {
    return `${target}.tmp-${process.pid}-${++this.tmpSeq}`;
  }

  private writeSync(json: string): void {
    mkdirSync(dirname(this.file), { recursive: true });
    atomicWriteSync(this.file, json, this.nextTmp(this.file));
  }

  private async writeAsync(json: string): Promise<void> {
    mkdirSync(dirname(this.file), { recursive: true });
    const tmp = this.nextTmp(this.file);
    try {
      const fh = await open(tmp, "w");
      try {
        await fh.writeFile(json, "utf8");
        await fh.sync();
      } finally {
        await fh.close();
      }
      // Shut down meanwhile: the final sync write has the newest state.
      if (this.closed) throw new Error("closed");
      await rename(tmp, this.file);
    } catch (err) {
      await unlink(tmp).catch(() => {});
      throw err;
    }
  }
}

/** Write to `tmp`, fsync, rename over `path`. */
function atomicWriteSync(path: string, text: string, tmp: string): void {
  try {
    const fd = openSync(tmp, "w");
    try {
      const buf = Buffer.from(text, "utf8");
      let off = 0;
      while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(tmp, path);
  } catch (err) {
    try {
      unlinkSync(tmp);
    } catch {
      // Nothing to clean.
    }
    throw err;
  }
}
