import { promises as fs } from "fs";
import path from "path";
import { buildRankEstimator, type FrequencyCounts } from "../src/lib/rarity/estimateRank";

// Build a SEED file for a collection from its CHIP-0007 metadata (the files you minted from), so the site
// can show the WHOLE collection + OUR OpenRarity ranks instantly, without depending on MintGarden's index.
//
//   npx tsx scripts/build-seed.ts <dir-of-json> <col1id> [--cid=<realIpfsCID>] [--name=Misfitz]
//
// Reads every *.json in <dir> (CHIP-0007: series_number, name, attributes, data.image.uri). Computes our
// own OpenRarity ranks from the traits (sorted -> unique 1..N). Writes src/lib/data-sources/seed/<col1id>.json.
// The image uri's placeholder CID is replaced with --cid when given (else left as-is for later).

interface Chip7 {
  name?: string;
  series_number?: number;
  series_total?: number;
  attributes?: { trait_type?: string; value?: string | number }[];
  data?: { image?: { uri?: string } };
}
type SeedEntry = { n: number; name: string; image: string; rank: number; traits: [string, string][] };
interface Seed { colId: string; name: string; supply: number; builtAt: number; byNumber: Record<string, SeedEntry> }

const args = process.argv.slice(2);
const dir = args[0];
const colId = args[1];
const flag = (k: string) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : ""; };
const cid = flag("cid");                              // real IPFS CID for the images
const gateway = (flag("gateway") || "https://tanggang.mypinata.cloud").replace(/\/$/, "");
const imgdir = flag("imgdir") || "images";            // subfolder under the CID
const pad = Number(flag("pad") || "4");               // filename zero-padding (0001.png)
const ext = flag("ext") || ".png";
const collName = flag("name") || "Collection";
const imageFor = (n: number) => (cid ? `${gateway}/ipfs/${cid}/${imgdir}/${String(n).padStart(pad, "0")}${ext}` : "");
if (!dir || !colId || !colId.startsWith("col1")) {
  console.error("usage: tsx scripts/build-seed.ts <dir-of-json> <col1id> [--cid=CID] [--name=Misfitz]");
  process.exit(1);
}

function numFromName(name: string): number | null {
  const m = name.match(/#?\s*0*(\d+)\s*$/);
  return m ? Number(m[1]) : null;
}

async function main() {
  const files = (await fs.readdir(dir)).filter((f) => f.toLowerCase().endsWith(".json"));
  console.error(`reading ${files.length} json files from ${dir} ...`);

  const parsed: { n: number; name: string; image: string; traits: { trait_type: string; value: string }[] }[] = [];
  for (const f of files) {
    let d: Chip7;
    try { d = JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as Chip7; } catch { continue; }
    const name = String(d.name ?? "").trim();
    const n = typeof d.series_number === "number" ? d.series_number : numFromName(name) ?? numFromName(f);
    if (n == null || !Number.isFinite(n)) continue;
    const traits = (d.attributes ?? [])
      .map((a) => ({ trait_type: String(a.trait_type ?? "").trim(), value: String(a.value ?? "").trim() }))
      .filter((t) => t.trait_type && t.value && t.trait_type.toLowerCase() !== "description");
    parsed.push({ n, name: name || `#${n}`, image: imageFor(n), traits });
  }
  if (parsed.length === 0) { console.error("no parseable NFTs found"); process.exit(1); }

  // Frequency table over all NFTs, then OUR OpenRarity ranks: score each, sort rarest-first, 1..N.
  const freq: FrequencyCounts = {};
  for (const p of parsed) for (const t of p.traits) {
    const cat = (freq[t.trait_type.toLowerCase()] ??= {});
    const v = String(t.value).toLowerCase();
    cat[v] = (cat[v] ?? 0) + 1;
  }
  const est = buildRankEstimator(freq, parsed.length);
  if (!est) { console.error("could not build rank estimator"); process.exit(1); }
  const scored = parsed.map((p) => ({ p, score: est.scoreOf(p.traits) }));
  scored.sort((a, b) => b.score - a.score); // rarest first
  const rankByNum = new Map<number, number>();
  scored.forEach((s, i) => rankByNum.set(s.p.n, i + 1));

  const byNumber: Record<string, SeedEntry> = {};
  for (const p of parsed) {
    byNumber[String(p.n)] = {
      n: p.n,
      name: p.name,
      image: p.image,
      rank: rankByNum.get(p.n) ?? 0,
      traits: p.traits.map((t) => [t.trait_type, String(t.value)] as [string, string]),
    };
  }

  const seed: Seed = { colId, name: collName, supply: parsed.length, builtAt: Date.now(), byNumber };
  const outDir = path.join("src", "lib", "data-sources", "seed");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${colId}.json`);
  await fs.writeFile(outPath, JSON.stringify(seed));
  console.error(`\\nwrote ${outPath}`);
  console.error(`  ${parsed.length} NFTs, ranks 1..${parsed.length}`);
  console.error(`  image sample: ${byNumber[String(parsed[0].n)].image || "(no --cid given — pass --cid=<CID> to build image URLs)"}`);
  console.error(`  rarest (#rank 1): ${scored[0].p.name}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
