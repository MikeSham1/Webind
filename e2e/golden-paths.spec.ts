import { test, expect, type Page } from "@playwright/test";
import { SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD } from "./global-setup";

function uniqueEmail(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
}

/**
 * Field-name locators rather than getByLabel: AuthForm's <label> wraps both
 * the field's caption AND extra text (the "Forgot password?" link on login,
 * the "At least 8 characters." hint on signup), so the input's accessible
 * name is never just "Password" — getByLabel(..., { exact: true }) can never
 * match it. Real assistive tech still announces the extra text fine; it's
 * only an exact-string test locator that trips on it.
 */
async function signup(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/signup");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.locator('input[name="confirmPassword"]').fill(password);
  await page.locator("#termsAccepted").check();
  await page.getByRole("button", { name: "Sign up" }).click();
}

async function login(page: Page, email: string, password: string): Promise<void> {
  await page.goto("/login");
  await page.locator('input[name="email"]').fill(email);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}

/**
 * SiteHeader renders two <nav> landmarks (desktop + a mobile disclosure menu,
 * distinguished by aria-label) so every link/button inside them — including
 * "Log out" — exists twice in the DOM. These tests run at Playwright's
 * default desktop viewport, so scope to the visible ("Primary") one rather
 * than matching page-wide and hitting a strict-mode violation.
 */
function primaryNav(page: Page) {
  return page.getByRole("navigation", { name: "Primary" });
}

test.describe("anonymous visitor", () => {
  test("can run a free report and see AI/Traditional scores", async ({ page }) => {
    await page.goto("/");
    await page.locator("#url").fill("example.com");
    await page.getByRole("button", { name: "Analyze" }).click();

    // A real crawl + scoring pipeline — the homepage's own estimate is 10-25s.
    await expect(page.getByText("Parse complete")).toBeVisible({ timeout: 45_000 });
    // Headings, exact: "AI Readiness" also appears as a substring of
    // "AI Readiness signals" and inside body copy on this same page.
    await expect(page.getByRole("heading", { name: "AI Readiness", exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Traditional Authority", exact: true }),
    ).toBeVisible();
  });
});

test.describe("signup", () => {
  test("creates an account and lands signed-in on Content Studio", async ({ page }) => {
    await signup(page, uniqueEmail("e2e-signup"), "correcthorsebattery");

    await expect(page).toHaveURL(/\/studio$/);
    await expect(page.getByRole("heading", { name: "What should we write today?" })).toBeVisible();
    // The shared nav should reflect the new signed-in session immediately.
    await expect(primaryNav(page).getByRole("button", { name: "Log out" })).toBeVisible();
  });

  test("rejects a duplicate email with the account intact", async ({ page }) => {
    const email = uniqueEmail("e2e-dup");

    await signup(page, email, "correcthorsebattery");
    await expect(page).toHaveURL(/\/studio$/);

    // Log out, then attempt the same email again with a different password.
    await primaryNav(page).getByRole("button", { name: "Log out" }).click();
    // Let the logout's redirect land before navigating on. Otherwise, on a slow
    // runner, /login arrives after signup()'s goto("/signup") and the test types
    // into the login form, which has no confirm-password field to wait for.
    await expect(page).toHaveURL(/\/login$/);
    await signup(page, email, "differentpassword1");

    await expect(page).toHaveURL(/\/signup/);
    await expect(page.getByRole("alert").filter({ hasText: /.+/ })).toBeVisible();
  });
});

test.describe("login", () => {
  test("the seeded admin can log in and reach the dashboard", async ({ page }) => {
    await login(page, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD);

    await expect(page).toHaveURL(/\/studio$/);
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { name: "Admin workspace" })).toBeVisible();
    await expect(page.getByText(SEED_ADMIN_EMAIL)).toBeVisible();
  });

  test("rejects the wrong password without revealing whether the account exists", async ({ page }) => {
    await login(page, SEED_ADMIN_EMAIL, "definitely-wrong-password");

    // Not getByRole("alert") alone: Next's route announcer also carries
    // role="alert" and matches too.
    await expect(page.getByText(/invalid email or password/i)).toBeVisible();
    await expect(page).toHaveURL(/\/login/);
  });
});

test.describe("consistent navigation", () => {
  test("every authenticated page offers the same one-click destinations", async ({ page }) => {
    await login(page, SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD);
    await expect(page).toHaveURL(/\/studio$/);

    // Settings used to be a dead end (only a "← Dashboard" link back out) —
    // the shared nav should now be here too, with a one-click path anywhere.
    await page.goto("/dashboard/settings");
    const nav = primaryNav(page);
    await expect(nav.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Keyword Visibility" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Benchmark" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Audit log" })).toBeVisible();

    await nav.getByRole("link", { name: "Benchmark" }).click();
    await expect(page).toHaveURL(/\/benchmark$/);
  });
});
