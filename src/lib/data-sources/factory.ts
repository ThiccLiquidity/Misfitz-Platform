import type { DataSource } from "./types";
import { MockDataSource } from "./mock";
import { MintGardenDataSource } from "./mintgarden";

// Resolves a collection's dataSourceKey to a concrete adapter (ARCHITECTURE.md §7). This is the
// only place that knows the full set of adapters; everything else codes to the DataSource
// interface, so adding a future source is one case here.
export type DataSourceKey = "mock" | "mintgarden";

const singletons: Partial<Record<DataSourceKey, DataSource>> = {};

export function getDataSource(key: DataSourceKey): DataSource {
  return (singletons[key] ??= key === "mintgarden" ? new MintGardenDataSource() : new MockDataSource());
}
