import { selectSiteAction, addSiteAction } from "@/app/sites/actions";
import { listSites, resolveActiveSite } from "@/lib/sites/store";

/**
 * Shows which website the AI is talking about, so the user never has to retype
 * a URL mid-conversation — and can see at a glance that the assistant has the
 * right site. Renders nothing for signed-out visitors (no sites to resolve).
 *
 * With one site it's a plain statement; with several it becomes a switcher.
 */
export default async function SiteContextBar({ userId }: { userId: string | null }) {
  if (!userId) return null;

  const active = await resolveActiveSite(userId);
  const all = await listSites(userId);

  // No known site yet: offer to name one rather than silently having no context.
  if (!active) {
    return (
      <div className="rounded-2xl border border-line bg-surface p-4">
        <p className="text-sm text-ink">
          Which website are we working on?{" "}
          <span className="text-muted">
            Run a report and we&apos;ll remember it, or add it here.
          </span>
        </p>
        <form action={addSiteAction} className="mt-3 flex flex-col gap-2 sm:flex-row">
          <label htmlFor="site-url" className="sr-only">
            Website domain
          </label>
          <input
            id="site-url"
            name="url"
            type="text"
            inputMode="url"
            placeholder="yourdomain.com"
            className="flex-1 rounded-lg border border-line-strong bg-paper px-3 py-2 font-sans text-sm text-ink placeholder:text-muted/60 focus-visible:border-accent focus-visible:outline-none"
          />
          <button
            type="submit"
            className="inline-flex h-9 shrink-0 items-center justify-center rounded-full bg-accent px-4 font-sans text-sm font-semibold text-accent-ink transition-colors hover:bg-accent-hover"
          >
            Use this site
          </button>
        </form>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-full border border-line bg-surface px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
      <p className="flex items-center gap-2.5 text-sm text-ink">
        <span
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-full bg-good"
          style={{ animation: "pulse-soft 2.4s ease-in-out infinite" }}
        />
        <span>
          Working on{" "}
          <strong className="font-semibold">{active.label ?? active.host}</strong>
          <span className="hidden text-muted sm:inline">
            {" "}
            — just say &ldquo;my site&rdquo;
          </span>
        </span>
      </p>

      {all.length > 1 && (
        <form action={selectSiteAction} className="flex items-center gap-2">
          <label htmlFor="siteId" className="sr-only">
            Switch website
          </label>
          <select
            id="siteId"
            name="siteId"
            defaultValue={active.id}
            className="rounded-full border border-line bg-paper px-3 py-1.5 font-sans text-sm text-ink focus-visible:border-accent focus-visible:outline-none"
          >
            {all.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label ?? s.host}
              </option>
            ))}
          </select>
          <button
            type="submit"
            className="rounded-full px-3 py-1.5 font-sans text-sm font-medium text-accent transition-colors hover:underline"
          >
            Switch
          </button>
        </form>
      )}
    </div>
  );
}
