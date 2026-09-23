import Link from "next/link";
import { listReportsForUserHost } from "@/lib/leads";
import { resolveActiveSite } from "@/lib/sites/store";

/**
 * What the dashboard should answer first: how is my site actually doing, and
 * what should I do about it?
 *
 * Everything here comes from the user's own most recent report for their
 * active site — scores and the scorer's prioritized fixes. Nothing is
 * generated or inferred, so an empty state is shown rather than a guess.
 */
export default async function SiteInsights({ userId }: { userId: string }) {
  const active = await resolveActiveSite(userId);
  if (!active) {
    return (
      <Panel>
        <p className="text-sm text-ink">
          <strong className="font-semibold">No site yet.</strong>{" "}
          <span className="text-muted">
            Run an authority report and its scores and fixes land here.
          </span>
        </p>
        <Link
          href="/"
          className="mt-3 inline-flex h-9 items-center justify-center rounded-full bg-accent px-4 font-sans text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
        >
          Run a report
        </Link>
      </Panel>
    );
  }

  const reports = await listReportsForUserHost(userId, active.host);
  const latest = reports[0] ?? null;

  if (!latest) {
    return (
      <Panel>
        <p className="text-sm text-ink">
          <strong className="font-semibold">{active.host}</strong>{" "}
          <span className="text-muted">hasn&apos;t been scored yet.</span>
        </p>
        <Link
          href="/"
          className="mt-3 inline-flex h-9 items-center justify-center rounded-full bg-accent px-4 font-sans text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
        >
          Run its first report
        </Link>
      </Panel>
    );
  }

  const fixes = latest.report?.prioritizedFixes?.slice(0, 3) ?? [];

  return (
    <Panel>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-xl font-semibold text-ink">{active.host}</h2>
          <p className="mt-0.5 text-xs text-muted">
            Last checked{" "}
            {new Date(latest.createdAt).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
              year: "numeric",
            })}
          </p>
        </div>
        <Link
          href={`/dashboard/reports/${latest.id}`}
          className="whitespace-nowrap font-sans text-sm font-medium text-accent hover:underline"
        >
          Full report →
        </Link>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <Score label="AI Readiness" value={latest.aiTotal} />
        <Score label="Traditional Authority" value={latest.traditionalTotal} />
      </div>

      {fixes.length > 0 && (
        <div className="mt-6">
          <p className="font-sans text-sm font-semibold text-ink">Do these next</p>
          <ol className="mt-2 space-y-2">
            {fixes.map((fix, i) => (
              <li key={i} className="flex gap-3 text-sm leading-relaxed text-muted">
                <span
                  aria-hidden="true"
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-accent-soft font-sans text-[11px] font-semibold text-accent"
                >
                  {i + 1}
                </span>
                <span>{fix}</span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </Panel>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return <section className="rounded-2xl border border-line bg-surface p-6 sm:p-8">{children}</section>;
}

/** Colour tracks the score so the number reads at a glance, not just as a digit. */
function Score({ label, value }: { label: string; value: number | null }) {
  const tone =
    value === null ? "text-muted" : value >= 75 ? "text-good" : value >= 50 ? "text-warn" : "text-bad";
  return (
    <div className="rounded-xl border border-line bg-paper px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`mt-1 font-display text-3xl font-semibold ${tone}`}>
        {value ?? "—"}
        <span className="ml-1 font-sans text-sm font-normal text-muted">/100</span>
      </p>
    </div>
  );
}
