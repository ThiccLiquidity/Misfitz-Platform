// Diagnostic page for the comparable-sales model. Visit /comps-status (defaults to ChiaPhunks) or
// /comps-status?id=col1... — shows whether the flag is on, how many sales were found, whether the
// model built, and sample values so we can see exactly where comps is (or isn't) working.
// First load may take a minute while the model builds; it's cached afterwards.

import { notFound } from "next/navigation";
import { isCompsEnabled } from "@/lib/config";
import { fetchCollectionCompletedSales } from "@/lib/market/dexie";
import { getCompsModel } from "@/lib/valuation/compsService";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const CHIAPHUNKS = "col13y2d52ewkfp7hfa4eq22fme7enh95c9t37fnumfx9lcjye5cpy4q9t4jep";

export default async function CompsStatusPage({ searchParams }: { searchParams: { id?: string } }) {
  if (process.env.NODE_ENV === "production") notFound(); // dev-only diagnostic
  const id = searchParams.id || CHIAPHUNKS;
  const enabled = isCompsEnabled();

  let salesFound = -1;
  let salesErr = "";
  try { salesFound = (await fetchCollectionCompletedSales(id)).length; }
  catch (e) { salesErr = String(e); }

  let modelInfo = "not built";
  const samples: { rank: number; value: number | null; confidence: number; basis: string }[] = [];
  let modelErr = "";
  try {
    const model = await getCompsModel(id, { wait: true });
    if (model) {
      modelInfo = `built — ${model.sampleSize} sales used, bandwidth ${Math.round(model.bandwidth)} ranks`;
      for (const rank of [50, 300, 843, 2000, 5000, 9000]) {
        const v = model.valueOf(rank, []);
        samples.push({ rank, value: v.curve, confidence: v.confidence, basis: v.basis });
      }
    } else {
      modelInfo = "model is null (no usable sales joined to ranks)";
    }
  } catch (e) { modelErr = String(e); }

  const row = { padding: "6px 10px", borderBottom: "1px solid #333" } as const;
  return (
    <div style={{ fontFamily: "monospace", padding: 24, color: "#ddd", background: "#111", minHeight: "100vh" }}>
      <h1 style={{ color: "#5fce7a" }}>Comps model status</h1>
      <p>Collection: {id}</p>
      <table style={{ borderCollapse: "collapse", margin: "16px 0", minWidth: 480 }}>
        <tbody>
          <tr style={row}><td>Flag enabled (isCompsEnabled)</td><td style={{ color: enabled ? "#5fce7a" : "#ff6060" }}>{String(enabled)}</td></tr>
          <tr style={row}><td>Completed clean-XCH sales found</td><td>{salesFound}{salesErr && ` — ERROR: ${salesErr}`}</td></tr>
          <tr style={row}><td>Model</td><td>{modelInfo}{modelErr && ` — ERROR: ${modelErr}`}</td></tr>
        </tbody>
      </table>
      <h2 style={{ color: "#a8d0ff" }}>Sample values by rank (trait-free)</h2>
      <table style={{ borderCollapse: "collapse", minWidth: 640 }}>
        <thead><tr><th style={row}>rank</th><th style={row}>comps value</th><th style={row}>confidence</th><th style={row}>basis</th></tr></thead>
        <tbody>
          {samples.map((s) => (
            <tr key={s.rank} style={row}>
              <td>{s.rank}</td>
              <td>{s.value != null ? `${s.value.toFixed(2)} XCH` : "null"}</td>
              <td>{(s.confidence * 100).toFixed(0)}%</td>
              <td>{s.basis}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 20, color: "#888" }}>If flag=true and sales&gt;0 but model is null or all confidence=0, the join to ranks failed.
        If flag=false, the running server is on old code (restart) or VALUATION_COMPS_ENABLED=&quot;false&quot;.</p>
    </div>
  );
}
