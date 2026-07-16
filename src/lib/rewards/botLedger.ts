// $CHIPS payout bot — file-backed idempotency LEDGER (operator machine only). Implements LedgerStore for the
// keyless orchestrator (bot.ts). Every mutation is written atomically (temp file + rename) so a crash can never
// leave a half-written ledger, and `markIntended` is flushed to disk BEFORE the wallet send (write-ahead) so a
// crash between "intended" and "done" is detectable on the next run (the bot reconciles or halts — never
// auto-resends). One JSON file; paymentKeys are globally unique (collection+epoch+kind+asset+wallet).
import { existsSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
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
  constructor(private readonly path: string) {
    const dir = dirname(path);
    if (dir && !existsSync(dir)) mkdirSync(dir, { recursive: true });
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

  // Atomic write: serialize to a temp file, fsync-ish via writeFileSync, then rename over the real file.
  private write(f: LedgerFile): void {
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify(f, null, 2), "utf8");
    renameSync(tmp, this.path);
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
