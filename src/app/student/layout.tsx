import type { ReactNode } from "react";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { getCurrentAppSession } from "@/lib/auth/session";

async function StudentAccessGuard({ children }: { children: ReactNode }) {
  await connection();
  const session = await getCurrentAppSession();
  if (!session) redirect("/login");
  if (session.role !== "STUDENT") {
    redirect(session.role === "ADMIN" || session.role === "SUPER_ADMIN"
      ? "/admin/dashboard"
      : "/login");
  }
  return children;
}

export default function StudentLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<div className="auth-wrap" role="status">Checking your university sign-in…</div>}>
      <StudentAccessGuard>{children}</StudentAccessGuard>
    </Suspense>
  );
}
