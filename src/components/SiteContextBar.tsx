import { listSites, resolveActiveSite } from "@/lib/sites/store";
import { AddSiteForm, SwitchSiteForm } from "./SiteSwitcher";

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

  if (!active) return <AddSiteForm />;

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

      {all.length > 1 && <SwitchSiteForm active={active} all={all} />}
    </div>
  );
}
