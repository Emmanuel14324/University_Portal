import type { Metadata } from "next";
import { LivePortalPage as PortalPage } from "@/components/portal/live-portal-page";

export const metadata: Metadata = { title: "My courses" };

export default function StudentCoursesPage() {
  return <PortalPage area="student" page="courses" />;
}
