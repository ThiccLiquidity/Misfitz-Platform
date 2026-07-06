import { promises as fs } from "fs";
import path from "path";

// Build a SEED file for a collection from its CHIP-0007 metadata so the site can show the WHOLE
// collection + OUR OpenRarity ranks instantly, independent of MintGarden's index.
//   node --experimental-strip-types scripts/build-seed.ts <file-or-dir> <col1id> [--cid=CID] [--gateway=URL] [--name=Misfitz]
// Computes ranks by OpenRarity information content (IC = -log2(count/N)) summed across all trait
// categories, sorted rarest-first -> unique 1..N. Writes src/lib/data-sources/seed/<col1id>.json.

interface Attr { trait_type?: string; value?: string | number }
interface Chip7 { name?: string; series_number?: number; attributes?: Attr[] }
type SeedEntry = { n: number; name: string; image: string; rank: number; traits: [string, string][] };
interface Seed { colId: string; name: string; supply: number; builtAt: number; byNumber: Record<string, SeedEntry> }

const args = process.argv.slice(2);
const input = args[0];
const colId = args[1];
const flag = (k: string) => { const a = args.find((x) => x.startsWith(`--${k}=`)); return a ? a.split("=").slice(1).join("=") : ""; };
const cid = flag("cid");
const gateway = (flag("gateway") || "https://ipfs.io").replace(/\/$/, "");
const imgdir = flag("imgdir") || "images";
const pad = Number(flag("pad") || "4");
const ext = flag("ext") || ".png";
const collName = flag("name") || "Collection";
if (!input || !colId || !colId.startsWith("col1")) { console.error("usage: node --experimental-strip-types scripts/build-seed.ts <file-or-dir> <col1id> [--cid=CID] [--gateway=URL] [--name=]"); process.exit(1); }
const imageFor = (n: number) => (cid ? `${gateway}/ipfs/${cid}/${imgdir}/${String(n).padStart(pad, "0")}${ext}` : "");
const numFromName = (s: string): number | null => { const m = s.match(/#?\s*0*(\d+)\s*$/); return m ? Number(m[1]) : null; };

async function main() {
  const stat = await fs.stat(input);
  const entries: Chip7[] = [];
  if (stat.isFile()) {
    const j = JSON.parse(await fs.readFile(input, "utf8")) as unknown;
    for (const e of (Array.isArray(j) ? j : Object.values(j as Record<string, unknown>))) entries.push(e as Chip7);
  } else {
    const files = (await fs.readdir(input)).filter((f) => f.toLowerCase().endsWith(".json"));
    for (const f of files) { try { entries.push(JSON.parse(await fs.readFile(path.join(input, f), "utf8")) as Chip7); } catch { /* skip */ } }
  }
  console.error(`loaded ${entries.length} entries`);

  const parsed: { n: number; name: string; traits: Map<string, string> }[] = [];
  for (const d of entries) {
    const name = String(d.name ?? "").trim();
    const n = typeof d.series_number === "number" ? d.series_number : numFromName(name);
    if (n == null || !Number.isFinite(n)) continue;
    const traits = new Map<string, string>();
    for (const a of d.attributes ?? []) {
      const t = String(a.trait_type ?? "").trim();
      const v = String(a.value ?? "").trim();
      if (t && v && t.toLowerCase() !== "description") traits.set(t, v);
    }
    parsed.push({ n, name: name || `#${n}`, traits });
  }
  const N = parsed.length;
  if (N === 0) { console.error("no parseable NFTs"); process.exit(1); }

  // OpenRarity information content. Count each category's values; NFTs missing a category count as "(none)".
  const categories = new Set<string>();
  for (const p of parsed) for (const c of p.traits.keys()) categories.add(c);
  const counts = new Map<string, Map<string, number>>();
  for (const c of categories) counts.set(c, new Map());
  for (const p of parsed) for (const c of categories) {
    const v = p.traits.get(c) ?? "(none)";
    const m = counts.get(c)!;
    m.set(v, (m.get(v) ?? 0) + 1);
  }
  const icOf = (c: string, v: string) => -Math.log2((counts.get(c)!.get(v) ?? 1) / N);
  const scoreOf = (p: { traits: Map<string, string> }) => {
    let s = 0;
    for (const c of categories) s += icOf(c, p.traits.get(c) ?? "(none)");
    return s;
  };

  const scored = parsed.map((p) => ({ p, score: scoreOf(p) })).sort((a, b) => b.score - a.score);
  const rankByNum = new Map<number, number>();
  scored.forEach((s, i) => rankByNum.set(s.p.n, i + 1));

  const byNumber: Record<string, SeedEntry> = {};
  for (const p of parsed) {
    byNumber[String(p.n)] = { n: p.n, name: p.name, image: imageFor(p.n), rank: rankByNum.get(p.n) ?? 0, traits: [...p.traits.entries()] };
  }
  const seed: Seed = { colId, name: collName, supply: N, builtAt: Date.now(), byNumber };
  const outDir = path.join("src", "lib", "data-sources", "seed");
  await fs.mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${colId}.json`);
  await fs.writeFile(outPath, JSON.stringify(seed));
  console.error(`wrote ${outPath}: ${N} NFTs, ranks 1..${N}`);
  console.error(`  categories: ${[...categories].join(", ")}`);
  console.error(`  rarest (rank 1): ${scored[0].p.name} (score ${scored[0].score.toFixed(2)})`);
  console.error(`  image sample: ${byNumber[String(scored[0].p.n)].image || "(no --cid)"}`);
}
main().catch((e) => { console.error(e); process.exit(1); });
