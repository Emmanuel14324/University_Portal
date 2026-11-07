import type { Metadata } from "next";
import { LivePortalPage as PortalPage } from "@/components/portal/live-portal-page";

export const metadata: Metadata = { title: "Admin dashboard" };

export default function AdminDashboardPage() {
  return <PortalPage area="admin" page="dashboard" />;
}
