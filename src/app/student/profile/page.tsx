import type { Metadata } from "next";
import { LivePortalPage as PortalPage } from "@/components/portal/live-portal-page";

export const metadata: Metadata = { title: "Student profile" };

export default function StudentProfilePage() {
  return <PortalPage area="student" page="profile" />;
}
