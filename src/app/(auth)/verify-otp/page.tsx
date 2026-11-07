import type { Metadata } from "next";
import { AuthScreen } from "@/components/auth/auth-screen";

export const metadata: Metadata = { title: "Authenticator preview" };

export default function VerifyOtpPage() {
  return <AuthScreen screen="otp" />;
}
