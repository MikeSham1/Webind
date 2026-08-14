export interface FixListProps {
  fixes: string[];
}

export default function FixList({ fixes }: FixListProps) {
  if (fixes.length === 0) {
    return (
      <div className="border border-good/40 bg-surface p-6 text-center sm:p-8">
        <p className="font-display text-lg font-semibold text-ink">
          No critical fixes — this page is already pulling its weight.
        </p>
        <p className="mt-2 text-sm text-muted">
          Every measured signal is scoring well. Keep publishing and keep it fresh.
        </p>
      </div>
    );
  }

  return (
    // A numbered list because impact rank is real information here, not
    // decoration — this is the order to actually work through the fixes in.
    <ol className="space-y-2.5">
      {fixes.map((fix, i) => (
        <li
          key={i}
          className="group flex items-start gap-4 border border-line bg-surface p-4 transition-colors hover:border-accent/50 sm:p-5"
        >
          <span
            className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center border border-accent/40 bg-accent-soft font-mono text-sm font-semibold text-accent"
            aria-hidden="true"
          >
            {i + 1}
          </span>
          <p className="text-sm leading-relaxed text-ink sm:text-[15px]">{fix}</p>
        </li>
      ))}
    </ol>
  );
}
