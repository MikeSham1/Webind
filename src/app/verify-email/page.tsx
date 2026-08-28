import type { Metadata } from "next";
import VerifyEmailForm from "@/components/VerifyEmailForm";

export const metadata: Metadata = {
  title: "Verify email — WeBind Design",
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = "force-dynamic";

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  return (
    <main className="flex min-h-full flex-1 items-center justify-center px-6 py-16">
      <VerifyEmailForm token={token ?? ""} />
    </main>
  );
}
