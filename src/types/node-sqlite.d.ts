// Minimal ambient types for Node's built-in experimental SQLite (node:sqlite), which isn't yet in
// @types/node. Only the surface we use.
declare module "node:sqlite" {
  export class StatementSync {
    get(...params: unknown[]): unknown;
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    all(...params: unknown[]): unknown[];
  }
  export class DatabaseSync {
    constructor(location: string, options?: unknown);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
