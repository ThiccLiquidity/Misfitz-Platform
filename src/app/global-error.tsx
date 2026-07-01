"use client";

// Last-resort boundary if the ROOT layout itself throws. It replaces the whole document, so it must
// render its own <html>/<body> and cannot rely on the app shell, theme, or fonts.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, background: "#0a0602", color: "#f5efe0", fontFamily: "system-ui, sans-serif", minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ textAlign: "center", padding: 24, maxWidth: 460 }}>
          <div style={{ fontSize: 44 }}>⚠️</div>
          <h1 style={{ fontSize: 22, fontWeight: 800, margin: "12px 0 6px" }}>Traitfolio hit an error</h1>
          <p style={{ fontSize: 14, opacity: 0.75, margin: "0 0 20px" }}>Something broke while loading the app. Reloading usually fixes it.</p>
          <button onClick={reset} style={{ background: "#38bdf8", color: "#000", border: 0, borderRadius: 8, padding: "10px 20px", fontWeight: 700, cursor: "pointer" }}>
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
