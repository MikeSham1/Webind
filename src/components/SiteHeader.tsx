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

export default async function SiteHeader() {
  const user = await getCurrentUser();
  const navLinks = user
    ? user.isAdmin
      ? [...SIGNED_IN_LINKS, { href: "/dashboard/audit", label: "Audit log" }]
      : SIGNED_IN_LINKS
    : SIGNED_OUT_LINKS;

  return (
    <header className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 px-6 py-6 sm:flex-row sm:justify-between">
      <Link href="/" className="flex items-baseline gap-2 whitespace-nowrap">
        <span className="font-display text-xl font-semibold tracking-tight text-ink">
          WeBind Design
        </span>
      </Link>
      {/* No sm:flex-nowrap here: the signed-in set can run to 9 items, and
          forcing a single line at any width above mobile clipped/overflowed
          on ordinary desktop widths. Wrapping is the correct behavior now. */}
      <nav className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2 sm:justify-end sm:gap-5">
        {navLinks.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="whitespace-nowrap font-sans text-sm font-medium text-muted transition-colors hover:text-accent"
          >
            {link.label}
          </Link>
        ))}
        {user ? (
          <form action={logoutAction}>
            <button
              type="submit"
              className="whitespace-nowrap rounded-full border border-line px-4 py-1.5 font-sans text-sm font-medium text-ink transition-colors hover:border-bad hover:text-bad"
            >
              Log out
            </button>
          </form>
        ) : (
          <Link
            href="/login"
            className="whitespace-nowrap rounded-full border border-line px-4 py-1.5 font-sans text-sm font-medium text-ink transition-colors hover:border-accent hover:text-accent"
          >
            Log in
          </Link>
        )}
      </nav>
    </header>
  );
}
