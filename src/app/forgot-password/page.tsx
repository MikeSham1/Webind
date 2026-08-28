import type { Metadata } from "next";
import { redirect } from "next/navigation";
import ForgotPasswordForm from "@/components/ForgotPasswordForm";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = {
  title: "Forgot password — WeBind Design",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function ForgotPasswordPage() {
  if (await getCurrentUser()) redirect("/dashboard");
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <ForgotPasswordForm />
    </main>
  );
}
