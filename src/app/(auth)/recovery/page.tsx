import type { Metadata } from "next";
import { AuthScreen } from "@/components/auth/auth-screen";

export const metadata: Metadata = { title: "Account recovery" };

export default function RecoveryPage() {
  return <AuthScreen screen="recovery" />;
}
