interface BinderPageControlsProps {
  pageIndex: number;
  pageCount: number;
  onPrev: () => void;
  onNext: () => void;
  disabled: boolean;
}

export function BinderPageControls({ pageIndex, pageCount, onPrev, onNext, disabled }: BinderPageControlsProps) {
  return (
    <div className="flex items-center justify-center gap-4 py-3">
      <button
        type="button"
        onClick={onPrev}
        disabled={disabled || pageCount < 2}
        className="rounded-full border border-page-border px-3 py-1 text-sm text-title disabled:opacity-30"
        aria-label="Previous page"
      >
        ‹
      </button>
      <span className="text-subtle text-xs">
        Page {pageIndex + 1} of {pageCount}
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={disabled || pageCount < 2}
        className="rounded-full border border-page-border px-3 py-1 text-sm text-title disabled:opacity-30"
        aria-label="Next page"
      >
        ›
      </button>
    </div>
  );
}
