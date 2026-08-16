// Minimal transition state while the collection page server-renders. Deliberately NOT a grid of empty
// card frames — that flashed as "ghost frames" for a second on every browse→collection navigation.
// Just the header shell + a small spinner, so the jump feels instant without phantom placeholders.
import { LoadingBar } from "@/components/status/WorkingIndicator";

export default function CollectionLoading() {
  return (
    <div className="py-2">
      <div
        className="mb-4 flex items-center gap-4 rounded-2xl px-5 py-4"
        style={{ background: "var(--card-bg)", border: "1px solid var(--card-border)" }}
      >
        <LoadingBar label="Opening collection…" />
      </div>
    </div>
  );
}
