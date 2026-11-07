import type { Metadata } from "next";
import { AuthScreen } from "@/components/auth/auth-screen";

export const metadata: Metadata = { title: "Passkey preview" };

export default function VerifyBiometricPage() {
  return <AuthScreen screen="biometric" />;
}
