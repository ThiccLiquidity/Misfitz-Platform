interface OwnershipPanelProps {
  ownerAddress: string | null;
}

// v1 (ARCHITECTURE.md §6): no wallet verification yet, so this only ever displays the
// mock/synced owner address. The "is this you?" linking flow is a Phase 2 addition.
export function OwnershipPanel({ ownerAddress }: OwnershipPanelProps) {
  if (!ownerAddress) {
    return <p className="text-subtle text-xs">Owner unknown.</p>;
  }
  return (
    <div className="text-xs">
      <span className="text-subtle">Currently held by </span>
      <span className="text-title font-mono">
        {ownerAddress.slice(0, 10)}…{ownerAddress.slice(-6)}
      </span>
    </div>
  );
}
