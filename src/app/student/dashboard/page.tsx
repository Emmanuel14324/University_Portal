import type { Metadata } from "next";
import { LivePortalPage as PortalPage } from "@/components/portal/live-portal-page";

export const metadata: Metadata = { title: "Student dashboard" };

export default function StudentDashboardPage() {
  return <PortalPage area="student" page="dashboard" />;
}
