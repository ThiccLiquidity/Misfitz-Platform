// $CHIPS payout bot — file-backed idempotency LEDGER (operator machine only). Implements LedgerStore for the
// keyless orchestrator (bot.ts). Safety properties:
//  - EXCLUSIVE LOCK: one bot at a time (O_EXCL lock file). Concurrent runs would double-pay + clobber each other's
//    in-flight "intended" entries, blinding crash-recovery — so we refuse to start if a lock exists.
//  - WRITE-AHEAD + FSYNC: markIntended is flushed to stable storage BEFORE the wallet send, so even a power loss
//    can't resurrect an old ledger that omits the in-flight payment (which would look cleanly pending -> resend).
//  - ATOMIC: temp file + fsync + rename, so a crash mid-write never leaves a half-written ledger.
//  - EXPLICIT FIRST RUN: an ABSENT ledger is treated as an error (you're probably in the wrong directory, where an
//    empty ledger would double-pay the whole epoch) unless you deliberately pass allowCreate.
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync, openSync, writeSync, fsyncSync, closeSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import type { Ledger } from "./manifestGuard";
import type { LedgerStore } from "./botDeps";

interface LedgerFile {
  version: 1;
  done: Record<string, { amountUnits: string; txId: string; at: number }>;      // confirmed-sent payments
  intended: Record<string, { amountUnits: string; at: number }>;                // written BEFORE send (crash residue)
}
function empty(): LedgerFile { return { version: 1, done: {}, intended: {} }; }

export class FileLedgerStore implements LedgerStore {
  private readonly lockPath: string;
  private locked = false;

  constructor(private readonly path: string, opts: { allowCreate?: boolean } = {}) {
    const dir = dirname(path);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
    if (!existsSync(path) && !opts.allowCreate) {
      throw new Error(`ledger ${path} does not exist. If this is a genuine first run pass --new-ledger; otherwise you are in the WRONG DIRECTORY and a fresh ledger would DOUBLE-PAY the epoch.`);
    }
    // Exclusive lock — O_EXCL fails if the file already exists (atomic on NTFS + POSIX).
    this.lockPath = `${path}.lock`;
    let fd: number;
    try { fd = openSync(this.lockPath, "wx"); } catch {
      throw new Error(`ledger lock ${this.lockPath} exists — another bot may be running. If it crashed, verify no send is in flight (inspect the ledger's "intended"), then delete the lock and re-run.`);
    }
    try { writeSync(fd, String(process.pid)); } finally { closeSync(fd); }
    this.locked = true;
    process.on("exit", () => this.release());
    process.on("SIGINT", () => { this.release(); process.exit(130); });
  }

  private release(): void {
    if (!this.locked) return;
    this.locked = false;
    try { unlinkSync(this.lockPath); } catch { /* leave a stale lock — fail closed; a human checks before next run */ }
  }

  private read(): LedgerFile {
    if (!existsSync(this.path)) return empty();
    try {
      const f = JSON.parse(readFileSync(this.path, "utf8")) as Partial<LedgerFile>;
      return { version: 1, done: f.done ?? {}, intended: f.intended ?? {} };
    } catch {
      throw new Error(`ledger at ${this.path} is unreadable/corrupt — refusing to run (reconcile or move it aside)`);
    }
  }

  // Atomic + durable: write temp, fsync it, rename over the real file. renameSync is atomic on NTFS/POSIX.
  private write(f: LedgerFile): void {
    const tmp = `${this.path}.tmp`;
    const fd = openSync(tmp, "w");
    try { writeSync(fd, JSON.stringify(f, null, 2)); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(tmp, this.path);
    try { const d = openSync(this.path, "r"); try { fsyncSync(d); } finally { closeSync(d); } } catch { /* best effort */ }
  }

  async load(): Promise<Ledger> {
    const f = this.read();
    const m: Ledger = new Map();
    for (const [k, v] of Object.entries(f.done)) m.set(k, v.amountUnits);
    return m;
  }

  async markIntended(key: string, amountUnits: string): Promise<void> {
    const f = this.read();
    f.intended[key] = { amountUnits, at: Date.now() };
    this.write(f); // durable BEFORE the caller broadcasts
  }

  async markDone(key: string, amountUnits: string, txId: string): Promise<void> {
    const f = this.read();
    f.done[key] = { amountUnits, txId, at: Date.now() };
    delete f.intended[key];
    this.write(f);
  }

  async intended(): Promise<{ key: string; amountUnits: string }[]> {
    const f = this.read();
    return Object.entries(f.intended)
      .filter(([k]) => !(k in f.done))
      .map(([key, v]) => ({ key, amountUnits: v.amountUnits }));
  }
}
