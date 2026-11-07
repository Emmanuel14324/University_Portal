import type { Metadata } from "next";
import { LivePortalPage as PortalPage } from "@/components/portal/live-portal-page";

export const metadata: Metadata = { title: "Fees and payments" };

export default function StudentFeesPage() {
  return <PortalPage area="student" page="fees" />;
}
