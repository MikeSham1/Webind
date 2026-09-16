import Link from "next/link";
import { logoutAction } from "@/app/account/actions";
import { getCurrentUser } from "@/lib/auth";

/**
 * The site-wide nav: same wordmark, links, and login/logout state on every
 * public/marketing page, so "Dashboard" is always one click away and the bar
 * doesn't shift depending on which page you're signed in on.
 */
const NAV_LINKS = [
  { href: "/compare", label: "Compare" },
  { href: "/studio", label: "Content Studio" },
  { href: "/pricing", label: "Pricing" },
  { href: "/dashboard", label: "Dashboard" },
];

export default async function SiteHeader() {
  const user = await getCurrentUser();

  return (
    <header className="mx-auto flex w-full max-w-6xl flex-col items-center gap-4 px-6 py-6 sm:flex-row sm:justify-between">
      <Link href="/" className="flex items-baseline gap-2 whitespace-nowrap">
        <span className="font-display text-xl font-semibold tracking-tight text-ink">
          WeBind Design
        </span>
      </Link>
      <nav className="flex items-center gap-5">
        {NAV_LINKS.map((link) => (
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
