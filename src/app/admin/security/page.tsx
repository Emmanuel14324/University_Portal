import type { Metadata } from "next";
import { LivePortalPage as PortalPage } from "@/components/portal/live-portal-page";

export const metadata: Metadata = { title: "Security activity" };

export default function AdminSecurityPage() {
  return <PortalPage area="admin" page="security" />;
}
