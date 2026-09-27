import Link from "next/link";
import { logoutAction } from "@/app/account/actions";
import { getCurrentUser } from "@/lib/auth";

/**
 * The site-wide nav: same wordmark, links, and login/logout state on every
 * public/marketing page, so "Dashboard" is always one click away and the bar
 * doesn't shift depending on which page you're signed in on.
 *
 * Signed-out visitors get the marketing set. Signed-in users get the full set
 * of authenticated destinations — this used to only exist as a one-off nav row
 * hand-rolled on the dashboard page, so every other authenticated page (Settings,
 * Keyword Visibility, Benchmark, the Audit log, and every report/draft detail
 * page) had no way to reach Compare, Pricing, or each other except by first
 * clicking back to the dashboard. One shared list now means every authenticated
 * page offers the same one-click destinations.
 */
const SIGNED_OUT_LINKS = [
  { href: "/compare", label: "Compare" },
  { href: "/studio", label: "Content Studio" },
  { href: "/pricing", label: "Pricing" },
];

const SIGNED_IN_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/", label: "New report" },
  { href: "/visibility", label: "Keyword Visibility" },
  { href: "/benchmark", label: "Benchmark" },
  { href: "/studio", label: "Content Studio" },
  { href: "/compare", label: "Compare" },
  { href: "/pricing", label: "Pricing" },
  { href: "/dashboard/settings", label: "Settings" },
];

const linkClass =
  "whitespace-nowrap font-sans text-sm font-medium text-muted transition-colors hover:text-accent";
const authPillClass =
  "whitespace-nowrap rounded-full border border-line px-4 py-1.5 font-sans text-sm font-medium text-ink transition-colors";

export default async function SiteHeader() {
  const user = await getCurrentUser();
  const navLinks = user
    ? user.isAdmin
      ? [...SIGNED_IN_LINKS, { href: "/dashboard/audit", label: "Audit log" }]
      : SIGNED_IN_LINKS
    : SIGNED_OUT_LINKS;

  const authControl = user ? (
    <form action={logoutAction}>
      <button type="submit" className={`${authPillClass} hover:border-bad hover:text-bad`}>
        Log out
      </button>
    </form>
  ) : (
    <Link href="/login" className={`${authPillClass} hover:border-accent hover:text-accent`}>
      Log in
    </Link>
  );

  return (
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-6 py-6">
      <Link href="/" className="flex items-baseline gap-2 whitespace-nowrap">
        <span className="font-display text-xl font-semibold tracking-tight text-ink">
          WeBind Design
        </span>
      </Link>

      {/* Desktop: the full link set inline. The signed-in set can run to 9
          items, so this only shows at sm+ — at mobile widths, wrapping that
          many items onto their own lines above the fold pushed real content
          out of view, which is what the disclosure menu below replaces. */}
      <nav aria-label="Primary" className="hidden items-center gap-5 sm:flex">
        {navLinks.map((link) => (
          <Link key={link.href} href={link.href} className={linkClass}>
            {link.label}
          </Link>
        ))}
        {authControl}
      </nav>

      {/* Mobile: a native disclosure — no client JS needed for a menu that
          only opens/closes and hands off to a real page navigation. Every
          link is a full page load in this app, so there's no "leaves the
          menu open after navigating" state to manage. */}
      <details className="group relative sm:hidden">
        <summary
          className="flex h-10 w-10 cursor-pointer list-none items-center justify-center rounded-full border border-line text-ink [&::-webkit-details-marker]:hidden"
          aria-label="Menu"
        >
          <svg
            viewBox="0 0 24 24"
            width={18}
            height={18}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            aria-hidden="true"
            className="group-open:hidden"
          >
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
          <svg
            viewBox="0 0 24 24"
            width={18}
            height={18}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            aria-hidden="true"
            className="hidden group-open:block"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </summary>
        <nav
          aria-label="Mobile"
          className="absolute right-0 top-full z-20 mt-2 flex w-56 flex-col gap-0.5 rounded-2xl border border-line bg-surface p-3 shadow-lg"
        >
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-lg px-3 py-2.5 font-sans text-sm font-medium text-ink transition-colors hover:bg-paper"
            >
              {link.label}
            </Link>
          ))}
          <div className="mt-1 border-t border-line pt-2">
            {user ? (
              <form action={logoutAction}>
                <button
                  type="submit"
                  className="w-full rounded-lg px-3 py-2.5 text-left font-sans text-sm font-medium text-bad transition-colors hover:bg-paper"
                >
                  Log out
                </button>
              </form>
            ) : (
              <Link
                href="/login"
                className="block rounded-lg px-3 py-2.5 font-sans text-sm font-medium text-accent transition-colors hover:bg-paper"
              >
                Log in
              </Link>
            )}
          </div>
        </nav>
      </details>
    </header>
  );
}
