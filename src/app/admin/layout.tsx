import type { ReactNode } from "react";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getCurrentAppSession } from "@/lib/auth/session";

async function AdminAccessGuard({ children }: { children: ReactNode }) {
  await connection();
  const session = await getCurrentAppSession();
  if (!session) redirect("/login");
  if (session.role === "STUDENT") redirect("/student/dashboard");
  return children;
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="auth-wrap" role="status">Checking your university sign-in…</div>}>
      <AdminAccessGuard>{children}</AdminAccessGuard>
    </Suspense>
  );
}
