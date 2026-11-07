import type { Metadata } from "next";
import { LivePortalPage as PortalPage } from "@/components/portal/live-portal-page";

export const metadata: Metadata = { title: "Finance administration" };

export default function AdminFinancePage() {
  return <PortalPage area="admin" page="finance" />;
}
