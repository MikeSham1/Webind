import type { Metadata } from "next";
import ResetPasswordForm from "@/components/ResetPasswordForm";

export const metadata: Metadata = {
  title: "Reset password — WeBind",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

// No "already logged in? redirect" guard here, unlike /login and /signup —
// resetting is a valid action regardless of current session state, and a
// successful reset revokes every session (including the current one) anyway.
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <ResetPasswordForm token={token ?? ""} />
    </main>
  );
}
