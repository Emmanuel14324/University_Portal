import type { Metadata } from "next";
import { LivePortalPage as PortalPage } from "@/components/portal/live-portal-page";

export const metadata: Metadata = { title: "Security settings" };

export default function StudentSecurityPage() {
  return <PortalPage area="student" page="security" />;
}
