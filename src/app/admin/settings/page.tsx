import type { Metadata } from "next";
import { LivePortalPage as PortalPage } from "@/components/portal/live-portal-page";

export const metadata: Metadata = { title: "System settings" };

export default function AdminSettingsPage() {
  return <PortalPage area="admin" page="settings" />;
}
