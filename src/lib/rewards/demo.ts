// Shadow-mode demo: run the pure engine over a sample month and print the epoch report. Run locally with:
//   npx tsx src/lib/rewards/demo.ts
// Proves the whole reward/vest/solvency path end-to-end with zero external dependencies.
import { sampleMonth } from "./mock";
import { computeEpoch } from "./engine";
import { formatEpochReport } from "./report";

const { sales, signals, epochStart, epochEnd } = sampleMonth();
const result = computeEpoch(sales, signals, epochStart, epochEnd);
console.log(formatEpochReport(result));
