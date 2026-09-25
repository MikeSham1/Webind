import type { Metadata } from "next";
import { redirect } from "next/navigation";
import AuthForm from "@/components/AuthForm";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Sign up — WeBind Design",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; plan?: string }>;
}) {
  if (await getCurrentUser()) redirect("/dashboard");
  const { next, plan } = await searchParams;
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <AuthForm mode="signup" next={next} plan={plan} />
    </main>
  );
}
