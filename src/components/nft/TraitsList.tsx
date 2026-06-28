import type { Trait } from "@/types";

// Renders Nft.traits generically — works for any collection's trait schema, no fixed columns.
export function TraitsList({ traits }: { traits: Trait[] }) {
  if (traits.length === 0) return null;
  return (
    <dl className="grid grid-cols-2 gap-2">
      {traits.map((trait) => (
        <div key={trait.trait_type} className="rounded-md border border-page-border px-2 py-1.5">
          <dt className="text-subtle text-[10px] uppercase tracking-wide">{trait.trait_type}</dt>
          <dd className="text-title text-sm">{trait.value}</dd>
        </div>
      ))}
    </dl>
  );
}
