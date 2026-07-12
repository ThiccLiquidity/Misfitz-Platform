import { test } from "node:test";
import assert from "node:assert/strict";
import { computeEpoch } from "@/lib/rewards/engine";
import { formatEpochReport } from "@/lib/rewards/report";
import { sampleMonth } from "@/lib/rewards/mock";

test("sample month is solvent and Erin's cheap-dump bonus voids", () => {
  const { sales, signals, epochStart, epochEnd } = sampleMonth();
  const r = computeEpoch(sales, signals, epochStart, epochEnd);
  assert.equal(r.solvent, true);
  const erin = r.bonuses.find((b) => b.winner === "erin");
  assert.equal(erin?.status, "voided");
  assert.ok(formatEpochReport(r).includes("Solvent:         YES"));
});
