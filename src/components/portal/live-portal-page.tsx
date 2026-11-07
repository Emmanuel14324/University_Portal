"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

type Area = "student" | "admin";
type IconName = "home" | "book" | "chart" | "wallet" | "user" | "shield" | "users" | "layers" | "settings" | "bell" | "search" | "plus" | "download" | "arrow" | "clock" | "check" | "calendar" | "key" | "file";
type Stat = { label: string; value: string; foot: string; icon: IconName };
type TableModel = { columns: string[]; rows: string[][] };
type Student = {
  registrationNumber: string;
  admissionYear: number;
  yearOfStudy: number;
  status: string;
  email: string | null;
  profile: {
    full_name: string;
    phone_number: string | null;
    date_of_birth: string | null;
    address: string | null;
    emergency_contact_name: string | null;
    emergency_contact_phone: string | null;
  } | null;
  programme: { code: string; name: string; award: string; department: string; duration_years: number } | null;
};
type CourseRegistration = {
  id: string;
  status: string;
  course: { code: string; name: string; department: string; credit_units: number } | null;
  semester: { academic_year: string; name: string; starts_on: string; ends_on: string } | null;
};
type ResultRecord = {
  marks: number | null;
  grade: string | null;
  grade_points: number | null;
  published_at: string;
  course: { code: string; name: string; credit_units: number } | null;
  semester: { academic_year: string; name: string } | null;
};
type FeeStatement = {
  statement_number: string;
  currency: string;
  billed_amount: number;
  due_at: string | null;
  status: string;
  semester: { academic_year: string; name: string } | null;
  payments: { reference: string; amount: number; status: string; paid_at: string | null }[];
};
type CatalogCourse = { id: string; code: string; name: string; credit_units: number; registered: boolean };
type Semester = { id: string; academic_year: string; name: string };
const studentNav = [
  { label: "Overview", href: "/student/dashboard", icon: "home" as const },
  { label: "My courses", href: "/student/courses", icon: "book" as const },
  { label: "Results", href: "/student/results", icon: "chart" as const },
  { label: "Fees", href: "/student/fees", icon: "wallet" as const },
  { label: "My profile", href: "/student/profile", icon: "user" as const },
  { label: "Security", href: "/student/security", icon: "shield" as const },
];
const adminNav = [
  { label: "Overview", href: "/admin/dashboard", icon: "home" as const },
  { label: "Students", href: "/admin/students", icon: "users" as const },
  { label: "Academics", href: "/admin/academics", icon: "layers" as const },
  { label: "Results", href: "/admin/results", icon: "chart" as const },
  { label: "Finance", href: "/admin/finance", icon: "wallet" as const },
  { label: "Security logs", href: "/admin/security", icon: "shield" as const },
  { label: "User management", href: "/admin/users", icon: "key" as const },
  { label: "System settings", href: "/admin/settings", icon: "settings" as const },
];

const titles: Record<Area, Record<string, { title: string; description: string; action?: string }>> = {
  student: {
    dashboard: { title: "Student overview", description: "Your St Jude University academic information." },
    courses: { title: "My courses", description: "Your course registrations and eligible course offerings.", action: "Browse courses" },
    results: { title: "Examination results", description: "Published results associated with your account.", action: "Print statement" },
    fees: { title: "Fees & payments", description: "Your fee statements and recorded payments in UGX.", action: "Download statement" },
    profile: { title: "My profile", description: "Your student identity and contact information.", action: "Edit profile" },
    security: { title: "Security settings", description: "Authenticator, passkeys, and active sessions for your account." },
  },
  admin: {
    dashboard: { title: "Administration overview", description: "Live academic and security activity at St Jude University." },
    students: { title: "Student management", description: "Search and review provisioned student records.", action: "Add student" },
    academics: { title: "Academic management", description: "Programmes, courses, and semesters configured in the portal.", action: "Add course" },
    results: { title: "Results management", description: "Review recorded examination results.", action: "Record result" },
    finance: { title: "Finance administration", description: "Fee statements and payments recorded in Ugandan shillings.", action: "Export report" },
    security: { title: "Security activity", description: "Review account sign-ins, sign-outs, and recent security events." },
    users: { title: "User management", description: "Administrator accounts and assigned access roles.", action: "Invite administrator" },
    settings: { title: "System settings", description: "University-wide preferences saved in Supabase." },
  },
};

const iconPaths: Record<IconName, React.ReactNode> = {
  home: <><path d="m3 10 9-7 9 7" /><path d="M5 9v11h14V9M9 20v-6h6v6" /></>,
  book: <><path d="M4 4.5A2.5 2.5 0 0 1 6.5 2H20v17H6.5A2.5 2.5 0 0 0 4 21.5z" /><path d="M4 4.5v17M8 6h8M8 10h8" /></>,
  chart: <><path d="M4 19V5M4 19h17" /><path d="m7 15 4-4 3 2 6-7" /></>,
  wallet: <><rect x="3" y="5" width="18" height="15" rx="2" /><path d="M3 9h18M16 14h2M6 5V3h12v2" /></>,
  user: <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>,
  shield: <><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11" /><path d="m9 12 2 2 4-4" /></>,
  users: <><path d="M16 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="10" cy="7" r="4" /><path d="M20 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" /></>,
  layers: <><path d="m12 3 9 5-9 5-9-5z" /><path d="m3 12 9 5 9-5M3 16l9 5 9-5" /></>,
  settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.7-1.4-2.4L7.3 15a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1a8 8 0 0 1-.1 2Z" /></>,
  bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
  search: <><circle cx="10.8" cy="10.8" r="6.8" /><path d="m16 16 5 5" /></>,
  plus: <><path d="M12 5v14M5 12h14" /></>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5" /><path d="M5 17v4h14v-4" /></>,
  arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
  clock: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
  check: <><path d="m5 12 4 4L19 6" /></>,
  calendar: <><rect x="3" y="5" width="18" height="16" rx="2" /><path d="M16 3v4M8 3v4M3 10h18" /></>,
  key: <><circle cx="8" cy="15" r="5" /><path d="m11.5 11.5 8-8 2 2-2 2 2 2-3 3-2-2-2 2" /></>,
  file: <><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6M8 13h8M8 17h8" /></>,
};

function Icon({ name, size = 16 }: { name: IconName; size?: number }) {
  return <svg className="icon" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{iconPaths[name]}</svg>;
}

function money(value: number, currency = "UGX") {
  return new Intl.NumberFormat("en-UG", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
}

function dateLabel(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-UG", { dateStyle: "medium", timeZone: "Africa/Kampala" }).format(date);
}

function dateTimeLabel(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : new Intl.DateTimeFormat("en-UG", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Africa/Kampala",
      }).format(date);
}

async function requestJson<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
  });
  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new Error("The portal returned an invalid response.");
  }
  if (!response.ok) {
    const message = typeof payload === "object" && payload !== null &&
      "error" in payload && typeof payload.error === "object" && payload.error !== null &&
      "message" in payload.error && typeof payload.error.message === "string"
      ? payload.error.message : "The request could not be completed.";
    throw new Error(message);
  }
  return payload as T;
}

function downloadCsv(filename: string, columns: string[], rows: string[][]) {
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  const csv = [columns, ...rows].map((row) => row.map(quote).join(",")).join("\r\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

function statusLabel(value: string) {
  return value.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function Status({ label }: { label: string }) {
  const danger = /overdue|suspended|elevated|failed|withdrawn/i.test(label);
  const warning = /pending|due|review|applicant|draft/i.test(label);
  return <span className={`status ${danger ? "danger" : warning ? "warning" : ""}`}>{label}</span>;
}

function Table({ model, search, emptyText }: { model: TableModel; search: string; emptyText: string }) {
  const rows = useMemo(() => model.rows.filter((row) => row.join(" ").toLowerCase().includes(search.toLowerCase())), [model.rows, search]);
  return <div className="table-wrap">
    <table className="data-table">
      <thead><tr>{model.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
      <tbody>{rows.map((row, rowIndex) => <tr key={`${rowIndex}-${row.join("-")}`}>{row.map((cell, index) =>
        <td key={`${index}-${cell}`}>{index === row.length - 1 && /status|risk/i.test(model.columns[index] ?? "")
          ? <Status label={cell} />
          : index === 0 ? <span className="table-primary">{cell || "—"}</span> : cell || "—"}</td>)}</tr>)}
      {rows.length === 0 && <tr><td colSpan={Math.max(1, model.columns.length)}><div className="empty-state">{emptyText}</div></td></tr>}</tbody>
    </table>
    <div className="table-pagination"><span>Showing {rows.length} of {model.rows.length} records loaded</span></div>
  </div>;
}

function StatCards({ stats }: { stats: Stat[] }) {
  if (!stats.length) return null;
  return <div className="stats-grid">{stats.map((stat) => <section className="stat-card" key={stat.label}>
    <div className="stat-top"><span className="stat-label">{stat.label}</span><span className="stat-icon"><Icon name={stat.icon} size={15} /></span></div>
    <div className="stat-value">{stat.value}</div><div className="stat-foot">{stat.foot}</div>
  </section>)}</div>;
}

function InfoLine({ label, value }: { label: string; value: React.ReactNode }) {
  return <div className="info-line"><span>{label}</span><strong>{value || "—"}</strong></div>;
}

function FormField({ label, name, type = "text", required = false, defaultValue = "", min, max }: {
  label: string; name: string; type?: string; required?: boolean; defaultValue?: string; min?: string; max?: string;
}) {
  return <label className="portal-field"><span>{label}</span><input className="auth-input" name={name} type={type} required={required} defaultValue={defaultValue} min={min} max={max} /></label>;
}

function toRows<T>(items: T[], mapper: (item: T) => string[]) {
  return items.map(mapper);
}

export function LivePortalPage({ area, page }: { area: Area; page: string }) {
  const router = useRouter();
  const pageInfo = titles[area][page] ?? titles[area].dashboard;
  const navigation = area === "student" ? studentNav : adminNav;
  const [identity, setIdentity] = useState<{ name: string; email: string; role: string }>({ name: "", email: "", role: "" });
  const [student, setStudent] = useState<Student | null>(null);
  const [stats, setStats] = useState<Stat[]>([]);
  const [table, setTable] = useState<TableModel>({ columns: [], rows: [] });
  const [securitySessions, setSecuritySessions] = useState<TableModel>({ columns: [], rows: [] });
  const [detailCards, setDetailCards] = useState<{ title: string; lines: { label: string; value: string }[] }[]>([]);
  const [statements, setStatements] = useState<FeeStatement[]>([]);
  const [catalog, setCatalog] = useState<CatalogCourse[]>([]);
  const [semesters, setSemesters] = useState<Semester[]>([]);
  const [programmes, setProgrammes] = useState<{ id: string; code: string; name: string }[]>([]);
  const [registrations, setRegistrations] = useState<{ id: string; studentName: string; registrationNumber: string; course: string; semester: string }[]>([]);
  const [settings, setSettings] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileDraft, setProfileDraft] = useState({ phone_number: "", address: "", emergency_contact_name: "", emergency_contact_phone: "" });
  const [adminFinanceRecords, setAdminFinanceRecords] = useState<{ studentName: string; registrationNumber: string; statementNumber: string; currency: string; billedAmount: number; paidAmount: number; dueAt: string | null; status: string }[]>([]);

  const buildStudentView = useCallback(async (currentPage: string) => {
    if (currentPage === "dashboard") {
      const [studentResponse, courseResponse, resultResponse, feeResponse] = await Promise.all([
        requestJson<{ student: Student }>("/api/student/me"),
        requestJson<{ courses: CourseRegistration[] }>("/api/student/courses"),
        requestJson<{ results: ResultRecord[] }>("/api/student/results"),
        requestJson<{ statements: FeeStatement[] }>("/api/student/fees"),
      ]);
      setStudent(studentResponse.student);
      setStatements(feeResponse.statements);
      const billed = feeResponse.statements.reduce((sum, item) => sum + item.billed_amount, 0);
      const paid = feeResponse.statements.flatMap((item) => item.payments)
        .filter((item) => item.status === "PAID")
        .reduce((sum, item) => sum + item.amount, 0);
      const credits = resultResponse.results.reduce((sum, item) => sum + (item.course?.credit_units ?? 0), 0);
      setStats([
        { label: "Registered courses", value: String(courseResponse.courses.filter((item) => item.status === "REGISTERED").length), foot: "Current course registrations", icon: "book" },
        { label: "Published results", value: String(resultResponse.results.length), foot: "Results on your account", icon: "chart" },
        { label: "Outstanding fees", value: money(Math.max(0, billed - paid)), foot: "Across loaded statements", icon: "wallet" },
        { label: "Credits completed", value: String(credits), foot: "From published results", icon: "check" },
      ]);
      setTable({ columns: ["Course", "Department", "Semester", "Credits", "Status"], rows: toRows(courseResponse.courses, (item) => [item.course ? `${item.course.code} · ${item.course.name}` : "Course unavailable", item.course?.department ?? "—", item.semester ? `${item.semester.academic_year} · ${item.semester.name}` : "—", String(item.course?.credit_units ?? "—"), statusLabel(item.status)]) });
    } else if (currentPage === "courses") {
      const response = await requestJson<{ courses: CourseRegistration[] }>("/api/student/courses");
      setStats([{ label: "Registered courses", value: String(response.courses.length), foot: "Course registrations on your record", icon: "book" }]);
      setTable({ columns: ["Course", "Department", "Academic period", "Credits", "Status"], rows: toRows(response.courses, (item) => [item.course ? `${item.course.code} · ${item.course.name}` : "Course unavailable", item.course?.department ?? "—", item.semester ? `${item.semester.academic_year} · ${item.semester.name}` : "—", String(item.course?.credit_units ?? "—"), statusLabel(item.status)]) });
    } else if (currentPage === "results") {
      const response = await requestJson<{ results: ResultRecord[] }>("/api/student/results");
      setStats([{ label: "Published results", value: String(response.results.length), foot: "Unpublished results are not shown", icon: "chart" }]);
      setTable({ columns: ["Course", "Academic period", "Marks", "Grade", "Points"], rows: toRows(response.results, (item) => [item.course ? `${item.course.code} · ${item.course.name}` : "Course unavailable", item.semester ? `${item.semester.academic_year} · ${item.semester.name}` : "—", item.marks === null ? "—" : String(item.marks), item.grade ?? "—", item.grade_points === null ? "—" : String(item.grade_points)]) });
    } else if (currentPage === "fees") {
      const response = await requestJson<{ statements: FeeStatement[] }>("/api/student/fees");
      setStatements(response.statements);
      const billed = response.statements.reduce((sum, item) => sum + item.billed_amount, 0);
      const paid = response.statements.flatMap((item) => item.payments).filter((item) => item.status === "PAID").reduce((sum, item) => sum + item.amount, 0);
      setStats([
        { label: "Billed", value: money(billed), foot: "Total across recorded statements", icon: "file" },
        { label: "Paid", value: money(paid), foot: "Recorded paid transactions", icon: "check" },
        { label: "Outstanding", value: money(Math.max(0, billed - paid)), foot: "Billed less recorded payments", icon: "wallet" },
      ]);
      setTable({ columns: ["Reference", "Academic period", "Billed", "Paid", "Due date", "Status"], rows: toRows(response.statements, (item) => [item.statement_number, item.semester ? `${item.semester.academic_year} · ${item.semester.name}` : "—", money(item.billed_amount, item.currency), money(item.payments.filter((payment) => payment.status === "PAID").reduce((sum, payment) => sum + payment.amount, 0), item.currency), dateLabel(item.due_at), statusLabel(item.status)]) });
    } else if (currentPage === "profile") {
      const response = await requestJson<{ student: Student }>("/api/student/me");
      setStudent(response.student);
      const profile = response.student.profile;
      setProfileDraft({
        phone_number: profile?.phone_number ?? "",
        address: profile?.address ?? "",
        emergency_contact_name: profile?.emergency_contact_name ?? "",
        emergency_contact_phone: profile?.emergency_contact_phone ?? "",
      });
      setDetailCards([
        { title: "Student identity", lines: [
          { label: "Full name", value: profile?.full_name ?? "Name not provisioned" },
          { label: "Registration number", value: response.student.registrationNumber },
          { label: "University email", value: response.student.email ?? "Not set" },
          { label: "Account status", value: statusLabel(response.student.status) },
        ] },
        { title: "Academic information", lines: [
          { label: "Programme", value: response.student.programme?.name ?? "Not assigned" },
          { label: "Department", value: response.student.programme?.department ?? "Not assigned" },
          { label: "Year of study", value: `Year ${response.student.yearOfStudy}` },
          { label: "Admission year", value: String(response.student.admissionYear) },
        ] },
        { title: "Contact information", lines: [
          { label: "Telephone", value: profile?.phone_number ?? "Not provided" },
          { label: "Mailing address", value: profile?.address ?? "Not provided" },
          { label: "Emergency contact", value: profile?.emergency_contact_name ?? "Not provided" },
          { label: "Emergency telephone", value: profile?.emergency_contact_phone ?? "Not provided" },
        ] },
      ]);
    }
  }, []);

  const loadData = useCallback(async () => {
    try {
      const session = await requestJson<{ user: { name: string | null; email: string | null; role: string } }>("/api/auth/session");
      setError("");
      setIdentity({
        name: session.user.name || session.user.email || (area === "student" ? "Student" : "Administrator"),
        email: session.user.email ?? "",
        role: session.user.role,
      });

      if (area === "student") {
        if (page === "security") {
          const response = await requestJson<{
            email: string | null;
            authenticator: { enabled: boolean; enabledAt: string | null };
            passkeys: { id: string; device_name: string | null; created_at: string; last_used_at: string | null }[];
            activeSessionCount: number;
          }>("/api/student/security");
          setDetailCards([
            { title: "Sign-in & account", lines: [
              { label: "University email", value: response.email ?? "Not set" },
              { label: "Account status", value: "Authenticated" },
              { label: "Active sessions", value: String(response.activeSessionCount) },
            ] },
            { title: "Security factors", lines: [
              { label: "Authenticator", value: response.authenticator.enabled ? `Enabled ${dateLabel(response.authenticator.enabledAt)}` : "Not enrolled" },
              { label: "Registered passkeys", value: String(response.passkeys.length) },
              ...response.passkeys.map((item, index) => ({ label: `Passkey ${index + 1}`, value: `${item.device_name || "This device"} · last used ${dateLabel(item.last_used_at)}` })),
            ] },
          ]);
        }
        if (page === "courses") {
          const response = await requestJson<{ courses: CatalogCourse[]; semesters: Semester[] }>("/api/student/course-catalog");
          setCatalog(response.courses);
          setSemesters(response.semesters);
        }
        await buildStudentView(page);
      } else {
        if (page === "dashboard") {
          const response = await requestJson<{
            user: { email: string | null; name: string; role: string };
            stats: { activeStudents: number; activeCourses: number; pendingResults: number; activeSessions: number; eventsLast24Hours: number };
            events: { action: string; actor_user_id: string | null; entity_type: string; created_at: string }[];
          }>("/api/admin/overview");
          setIdentity({ name: response.user.name, email: response.user.email ?? "", role: response.user.role });
          setStats([
            { label: "Active students", value: response.stats.activeStudents.toLocaleString("en-UG"), foot: "Current active student accounts", icon: "users" },
            { label: "Active courses", value: response.stats.activeCourses.toLocaleString("en-UG"), foot: "Courses enabled in the catalogue", icon: "book" },
            { label: "Draft results", value: response.stats.pendingResults.toLocaleString("en-UG"), foot: "Awaiting publication", icon: "chart" },
            { label: "Active sessions", value: response.stats.activeSessions.toLocaleString("en-UG"), foot: `${response.stats.eventsLast24Hours} security events in 24 hours`, icon: "shield" },
          ]);
          setTable({
            columns: ["Activity", "Account ID", "Area", "Date"],
            rows: toRows(response.events, (item) => [statusLabel(item.action), item.actor_user_id ?? "System", item.entity_type, dateLabel(item.created_at)]),
          });
        }
        if (page === "students") {
          const params = new URLSearchParams({ page: "1", pageSize: "50" });
          if (search.trim()) params.set("search", search.trim());
          if (statusFilter) params.set("status", statusFilter);
          const [response, academic] = await Promise.all([
            requestJson<{ students: { registrationNumber: string; admissionYear: number; yearOfStudy: number; status: string; profile: { full_name: string } | null; programme: { name: string } | null }[]; pagination: { total: number } }>(`/api/admin/students?${params}`),
            requestJson<{ programmes: { id: string; code: string; name: string }[] }>("/api/admin/academics"),
          ]);
          setProgrammes(academic.programmes);
          setStats([{ label: "Students found", value: response.pagination.total.toLocaleString("en-UG"), foot: "Matching student records", icon: "users" }]);
          setTable({
            columns: ["Student", "Registration no.", "Programme", "Year", "Status"],
            rows: toRows(response.students, (item) => [item.profile?.full_name ?? "Name unavailable", item.registrationNumber, item.programme?.name ?? "Programme not assigned", `Year ${item.yearOfStudy}`, statusLabel(item.status)]),
          });
        }
        if (page === "academics") {
          const response = await requestJson<{ programmes: { id: string; code: string; name: string; department: string }[]; courses: { id: string; code: string; name: string; department: string; credit_units: number; is_active: boolean }[]; semesters: { id: string; academic_year: string; name: string; status: string; starts_on: string; ends_on: string }[] }>("/api/admin/academics");
          setProgrammes(response.programmes);
          setSemesters(response.semesters);
          setStats([
            { label: "Programmes", value: String(response.programmes.length), foot: "Configured programmes", icon: "layers" },
            { label: "Active courses", value: String(response.courses.filter((item) => item.is_active).length), foot: "In the course catalogue", icon: "book" },
            { label: "Semesters", value: String(response.semesters.length), foot: "Configured academic periods", icon: "calendar" },
          ]);
          setTable({ columns: ["Course", "Department", "Credits", "Status"], rows: toRows(response.courses, (item) => [`${item.code} · ${item.name}`, item.department, String(item.credit_units), item.is_active ? "Active" : "Inactive"]) });
        }
        if (page === "results") {
          const response = await requestJson<{
            results: { course_registration_id: string; marks: number | null; grade: string | null; grade_points: number | null; status: string; course: { code: string; name: string } | null; semester: { academic_year: string; name: string } | null; student: { fullName: string; registrationNumber: string } }[];
            registrations: { id: string; studentName: string; registrationNumber: string; course: string; semester: string }[];
            activeStudents: number; pendingCount: number; publishedCount: number;
          }>("/api/admin/results");
          setRegistrations(response.registrations);
          setStats([
            { label: "Results loaded", value: String(response.results.length), foot: "Latest saved result records", icon: "chart" },
            { label: "Draft results", value: String(response.pendingCount), foot: "Not yet published", icon: "clock" },
            { label: "Published results", value: String(response.publishedCount), foot: "Visible to students", icon: "check" },
            { label: "Active students", value: String(response.activeStudents), foot: "Current account count", icon: "users" },
          ]);
          setTable({ columns: ["Student", "Registration no.", "Course", "Semester", "Grade", "Status"], rows: toRows(response.results, (item) => [item.student.fullName, item.student.registrationNumber, `${item.course?.code ?? "—"} ${item.course?.name ?? ""}`.trim(), `${item.semester?.academic_year ?? ""} ${item.semester?.name ?? ""}`.trim(), item.grade ?? "—", statusLabel(item.status)]) });
        }
        if (page === "finance") {
          const response = await requestJson<{ statements: { studentName: string; registrationNumber: string; statementNumber: string; currency: string; billedAmount: number; paidAmount: number; dueAt: string | null; status: string; semester: { academic_year: string; name: string } | null }[] }>("/api/admin/finance");
          const billed = response.statements.reduce((sum, item) => sum + item.billedAmount, 0);
          const paid = response.statements.reduce((sum, item) => sum + item.paidAmount, 0);
          setStatements([]);
          setAdminFinanceRecords(response.statements);
          setStats([
            { label: "Statements loaded", value: String(response.statements.length), foot: "Latest statements from the database", icon: "file" },
            { label: "Billed total", value: money(billed), foot: "Loaded statements only", icon: "wallet" },
            { label: "Payments recorded", value: money(paid), foot: "Paid transactions only", icon: "check" },
            { label: "Outstanding", value: money(Math.max(0, billed - paid)), foot: "For loaded statements", icon: "clock" },
          ]);
          setTable({ columns: ["Student", "Registration no.", "Statement", "Balance", "Due", "Status"], rows: toRows(response.statements, (item) => [item.studentName, item.registrationNumber, item.statementNumber, money(Math.max(0, item.billedAmount - item.paidAmount), item.currency), dateLabel(item.dueAt), statusLabel(item.status)]) });
        }
        if (page === "security") {
          const response = await requestJson<{
            events: { action: string; actor_user_id: string | null; subject_user_id: string | null; entity_type: string; created_at: string }[];
            sessions: { id: string; userId: string; userName: string; loggedInAt: string; loggedOutAt: string | null; status: string }[];
            pagination: { total: number };
            sessionPagination: { total: number };
          }>("/api/admin/security?page=1&pageSize=50");
          setStats([
            { label: "Login sessions", value: String(response.sessionPagination.total), foot: "Recorded sign-ins", icon: "users" },
            { label: "Security events", value: String(response.pagination.total), foot: "Recorded audit events", icon: "shield" },
          ]);
          setTable({ columns: ["Event", "Actor ID", "Subject ID", "Area", "Date & time"], rows: toRows(response.events, (item) => [statusLabel(item.action), item.actor_user_id ?? "System", item.subject_user_id ?? "—", item.entity_type, dateLabel(item.created_at)]) });
          setSecuritySessions({
            columns: ["User name", "User ID", "Logged in", "Logged out / expired", "Status"],
            rows: toRows(response.sessions, (item) => [
              item.userName,
              item.userId,
              dateTimeLabel(item.loggedInAt),
              item.loggedOutAt ? dateTimeLabel(item.loggedOutAt) : "—",
              item.status,
            ]),
          });
        }
        if (page === "users") {
          const response = await requestJson<{ users: { fullName: string; email: string; role: string; invitedAt: string }[] }>("/api/admin/users");
          setStats([{ label: "Administrator accounts", value: String(response.users.length), foot: "Assigned admin roles", icon: "users" }]);
          setTable({ columns: ["Administrator", "Email", "Role", "Role assigned"], rows: toRows(response.users, (item) => [item.fullName, item.email, statusLabel(item.role), dateLabel(item.invitedAt)]) });
        }
        if (page === "settings") {
          const response = await requestJson<{ settings: Record<string, { enabled?: boolean }> }>("/api/admin/settings");
          setSettings(Object.fromEntries(Object.entries(response.settings).map(([key, value]) => [key, value?.enabled === true])));
        }
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not load portal information.");
    } finally {
      setLoading(false);
    }
  }, [area, page, search, statusFilter, buildStudentView]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const visibleRows = useMemo(() => table.rows.filter((row) => row.join(" ").toLowerCase().includes(search.toLowerCase())), [table.rows, search]);

  async function handleForm(event: FormEvent<HTMLFormElement>, endpoint: string, transform: (form: FormData) => unknown) {
    event.preventDefault();
    setWorking(true);
    setError("");
    setNotice("");
    try {
      await requestJson(endpoint, "POST", transform(new FormData(event.currentTarget)));
      setNotice("Saved successfully.");
      setShowForm(false);
      await loadData();
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "The action could not be completed.");
    } finally {
      setWorking(false);
    }
  }

  async function saveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      const body = Object.fromEntries(["phone_number", "address", "emergency_contact_name", "emergency_contact_phone"].map((key) => {
        const value = String(form.get(key) ?? "").trim();
        return [key, value || null];
      }));
      await requestJson("/api/student/profile", "PATCH", body);
      setNotice("Your profile changes have been saved.");
      setEditingProfile(false);
      await loadData();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Could not save your profile.");
    } finally {
      setWorking(false);
    }
  }

  async function registerCourse(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError("");
    try {
      const form = new FormData(event.currentTarget);
      await requestJson("/api/student/course-registrations", "POST", {
        courseId: form.get("courseId"),
        semesterId: form.get("semesterId"),
      });
      setNotice("Course registration completed.");
      setShowCatalog(false);
      await loadData();
    } catch (registrationError) {
      setError(registrationError instanceof Error ? registrationError.message : "Course registration could not be completed.");
    } finally {
      setWorking(false);
    }
  }

  async function toggleSetting(key: string) {
    const enabled = !settings[key];
    setSettings((current) => ({ ...current, [key]: enabled }));
    try {
      await requestJson("/api/admin/settings", "PUT", { key, enabled });
      setNotice("Preference saved.");
    } catch (settingError) {
      setSettings((current) => ({ ...current, [key]: !enabled }));
      setError(settingError instanceof Error ? settingError.message : "Could not save this preference.");
    }
  }

  async function signOut() {
    setWorking(true);
    setError("");
    try {
      await requestJson("/api/auth/logout", "POST");
      router.replace("/login");
      router.refresh();
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : "Could not safely sign out.");
    } finally {
      setWorking(false);
    }
  }

  function performAction() {
    setError("");
    if (area === "student") {
      if (page === "courses") setShowCatalog((current) => !current);
      else if (page === "profile") setEditingProfile((current) => !current);
      else if (page === "results") window.print();
      else if (page === "fees") {
        const rows = statements.flatMap((item) => item.payments.map((payment) => [
          item.statement_number, item.semester ? `${item.semester.academic_year} ${item.semester.name}` : "",
          payment.reference, money(payment.amount, item.currency), statusLabel(payment.status), dateLabel(payment.paid_at),
        ]));
        downloadCsv("st-jude-fee-statement.csv", ["Statement", "Academic period", "Payment reference", "Amount", "Status", "Date"], rows);
        setNotice("Fee statement downloaded.");
      }
    } else if (page === "finance") {
      downloadCsv("st-jude-finance-report.csv",
        ["Student", "Registration number", "Statement", "Billed", "Paid", "Outstanding", "Due", "Status"],
        adminFinanceRecords.map((item) => [item.studentName, item.registrationNumber, item.statementNumber, money(item.billedAmount, item.currency), money(item.paidAmount, item.currency), money(Math.max(0, item.billedAmount - item.paidAmount), item.currency), dateLabel(item.dueAt), statusLabel(item.status)]));
      setNotice("Finance report downloaded.");
    } else {
      setShowForm((current) => !current);
    }
  }

  const profileName = student?.profile?.full_name || identity.name;
  const avatar = profileName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "SJ";
  const title = area === "student" && page === "dashboard" && student?.profile?.full_name
    ? `Welcome, ${student.profile.full_name.split(" ")[0]}`
    : pageInfo.title;
  const notificationRows = area === "student"
    ? statements.filter((item) => item.status !== "PAID").map((item) => `${item.statement_number}: ${money(item.billed_amount, item.currency)} · ${statusLabel(item.status)}`)
    : table.rows.slice(0, 5).map((row) => row.join(" · "));

  return <div className="portal-shell">
    <aside className="sidebar">
      <div className="sidebar-brand"><Link className="brand" href="/"><span className="brand-mark">SJ</span><span>St Jude <strong>University</strong></span></Link></div>
      <div className="workspace-tag">{area === "student" ? "Student LMS" : "Administration"}</div>
      <nav className="nav-list" aria-label={`${area} navigation`}>{navigation.map((item) => <Link className={`nav-link ${`/${area}/${page}` === item.href ? "active" : ""}`} href={item.href} key={item.href}><Icon name={item.icon} />{item.label}</Link>)}</nav>
      <div className="nav-divider" />
      <button className="nav-link signout-link" onClick={() => void signOut()} disabled={working} type="button"><Icon name="arrow" />Sign out</button>
      <div className="sidebar-bottom">
        <div className="demo-card"><b>St Jude University</b><p>Live records are scoped to your signed-in account and assigned access role.</p></div>
        <div className="user-mini"><span className="avatar">{avatar}</span><span className="user-mini-copy"><b>{profileName}</b><small>{area === "student" ? `Student · ${student?.registrationNumber ?? ""}` : `${identity.role || "Administrator"} · ${identity.email}`}</small></span></div>
      </div>
    </aside>
    <main className="portal-main">
      <header className="topbar">
        <div className="breadcrumbs"><Link href="/">Home</Link><span>/</span><span>{pageInfo.title}</span></div>
        <div className="topbar-actions">
          <label className="search-box"><Icon name="search" size={14} /><input aria-label="Search current records" onChange={(event) => setSearch(event.target.value)} placeholder="Search records..." value={search} /></label>
          <button aria-label="Notifications" aria-expanded={showNotifications} className="icon-button" onClick={() => setShowNotifications((current) => !current)} type="button"><Icon name="bell" /></button>
          <div className="top-user"><span className="avatar">{avatar}</span><b>{profileName}</b></div>
        </div>
      </header>
      <div className="portal-content">
        {showNotifications && <section className="panel notification-panel"><div className="panel-header"><h2>Recent account information</h2><button type="button" onClick={() => setShowNotifications(false)}>Close</button></div><div className="panel-body">{notificationRows.length ? <ul>{notificationRows.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul> : <p className="muted-copy">There are no current notices for this section.</p>}</div></section>}
        {notice && <div className="flow-complete" role="status">{notice}</div>}
        {error && <div className="flow-error" role="alert">{error}</div>}
        <div className="page-heading"><div><h1>{title}</h1><p>{pageInfo.description}</p></div><div className="heading-actions">{pageInfo.action && <button className="small-button primary" onClick={performAction} type="button"><Icon name={pageInfo.action.includes("Download") || pageInfo.action.includes("Export") || pageInfo.action.includes("Print") ? "download" : "plus"} size={14} />{pageInfo.action}</button>}</div></div>
        {loading ? <div className="panel panel-body" role="status">Loading your authorized university records…</div> : null}
        <StatCards stats={stats} />
        {!loading && page === "profile" && area === "student" && <div className="info-grid">
          {detailCards.map((card) => <section className="info-card" key={card.title}><h3>{card.title}</h3>{card.lines.map((line) => <InfoLine key={line.label} {...line} />)}</section>)}
          {editingProfile && <section className="info-card profile-editor"><h3>Edit contact information</h3><form onSubmit={saveProfile}>
            <FormField label="Telephone" name="phone_number" defaultValue={profileDraft.phone_number} />
            <FormField label="Mailing address" name="address" defaultValue={profileDraft.address} />
            <FormField label="Emergency contact name" name="emergency_contact_name" defaultValue={profileDraft.emergency_contact_name} />
            <FormField label="Emergency contact telephone" name="emergency_contact_phone" defaultValue={profileDraft.emergency_contact_phone} />
            <button className="button button-primary auth-button" disabled={working} type="submit">{working ? "Saving…" : "Save profile"}</button>
          </form></section>}
        </div>}
        {!loading && page === "security" && area === "student" && <div className="info-grid">{detailCards.map((card) => <section className="info-card" key={card.title}><h3>{card.title}</h3>{card.lines.map((line) => <InfoLine key={line.label} {...line} />)}</section>)}</div>}
        {!loading && page === "settings" && area === "admin" && <section className="panel"><div className="panel-header"><h2>Institution preferences</h2></div><div className="settings-list">
          {[
            ["academic_year", "Academic year", "Enable the configured active academic-year preference."],
            ["registration_window", "Registration window", "Enable the configured registration-window preference."],
            ["portal_notifications", "Portal notifications", "Enable institution-wide portal notifications."],
            ["access_policies", "Access policies", "Enable the configured account access policy."],
          ].map(([key, label, description]) => <div className="setting-row" key={key}><span className="setting-icon"><Icon name="settings" /></span><span className="setting-copy"><b>{label}</b><small>{description}</small></span><button aria-label={`Toggle ${label}`} aria-pressed={settings[key] === true} className={`switch ${settings[key] ? "on" : ""}`} onClick={() => void toggleSetting(key)} type="button"><span /></button></div>)}
        </div></section>}
        {!loading && page === "security" && area === "admin" && <div className="security-log-list">
          <section className="panel">
            <div className="panel-header"><h2>Login sessions</h2></div>
            <Table model={securitySessions} search={search} emptyText="No login sessions have been recorded." />
          </section>
          <section className="panel">
            <div className="panel-header"><h2>Security events</h2></div>
            <Table model={table} search={search} emptyText="No security activity has been recorded." />
          </section>
        </div>}
        {!loading && page === "dashboard" && <div className="content-grid">
          <section className="panel"><div className="panel-header"><h2>{area === "student" ? "My registered courses" : "Recent security activity"}</h2><Link href={area === "student" ? "/student/courses" : "/admin/security"}>View details →</Link></div>
            <Table model={table} search={search} emptyText={area === "student" ? "No course registrations are recorded for your account." : "No security activity has been recorded."} />
          </section>
          <section className="panel"><div className="panel-header"><h2>Account information</h2></div><div className="panel-body">
            {area === "student" ? <>
              <InfoLine label="Student" value={student?.profile?.full_name ?? "Name not provisioned"} />
              <InfoLine label="Registration number" value={student?.registrationNumber ?? "—"} />
              <InfoLine label="Programme" value={student?.programme?.name ?? "Not assigned"} />
              <InfoLine label="Academic year" value={student?.programme ? `${student.programme.duration_years} year programme` : "Not available"} />
              <div className="course-list"><Link className="course-row" href="/student/fees"><span className="setting-icon"><Icon name="wallet" /></span><span className="course-info"><b>Fees &amp; payments</b><small>Review your current statement</small></span><span aria-hidden="true">→</span></Link><Link className="course-row" href="/student/results"><span className="setting-icon"><Icon name="chart" /></span><span className="course-info"><b>Results</b><small>View published academic results</small></span><span aria-hidden="true">→</span></Link></div>
            </> : <>
              <InfoLine label="Signed-in administrator" value={identity.name} />
              <InfoLine label="Email" value={identity.email} />
              <InfoLine label="Access role" value={statusLabel(identity.role)} />
              <div className="course-list">{adminNav.slice(1, 5).map((item) => <Link className="course-row" href={item.href} key={item.href}><span className="setting-icon"><Icon name={item.icon} /></span><span className="course-info"><b>{item.label}</b><small>Open current records</small></span><span aria-hidden="true">→</span></Link>)}</div>
            </>}
          </div></section>
        </div>}
        {!loading && page !== "dashboard" && page !== "profile" && page !== "security" && page !== "settings" && <section className="panel">
          <div className="panel-header"><h2>{pageInfo.title} records</h2>{page === "students" && <select className="filter-select" aria-label="Filter student status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{["APPLICANT", "ACTIVE", "ON_LEAVE", "SUSPENDED", "GRADUATED", "WITHDRAWN"].map((item) => <option key={item} value={item}>{statusLabel(item)}</option>)}</select>}</div>
          <Table model={{ ...table, rows: visibleRows }} search="" emptyText={`No ${page} records are available for this account.`} />
        </section>}
        {showCatalog && page === "courses" && area === "student" && <section className="panel"><div className="panel-header"><h2>Eligible courses</h2><button type="button" onClick={() => setShowCatalog(false)}>Close</button></div>
          {catalog.length && semesters.length ? <form className="portal-action-form" onSubmit={registerCourse}>
            <label className="portal-field"><span>Course</span><select className="auth-input" name="courseId" required>{catalog.filter((item) => !item.registered).map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name} ({item.credit_units} credits)</option>)}</select></label>
            <label className="portal-field"><span>Semester</span><select className="auth-input" name="semesterId" required>{semesters.map((item) => <option key={item.id} value={item.id}>{item.academic_year} · {item.name}</option>)}</select></label>
            <button className="button button-primary" disabled={working || catalog.every((item) => item.registered)} type="submit">{working ? "Registering…" : "Register course"}</button>
          </form> : <div className="panel-body"><p className="muted-copy">No eligible courses or open registration periods are configured for your programme and year. Contact the registrar if you think this is incorrect.</p></div>}
        </section>}
        {showForm && area === "admin" && page === "students" && <section className="panel"><div className="panel-header"><h2>Invite and provision student</h2><button onClick={() => setShowForm(false)} type="button">Cancel</button></div><form className="portal-action-form" onSubmit={(event) => void handleForm(event, "/api/admin/students", (form) => ({
          email: form.get("email"), fullName: form.get("fullName"), registrationNumber: form.get("registrationNumber"),
          admissionYear: Number(form.get("admissionYear")), yearOfStudy: Number(form.get("yearOfStudy")),
          programmeId: form.get("programmeId") || null, status: form.get("status"),
        }))}>
          <FormField label="University email" name="email" type="email" required />
          <FormField label="Full name" name="fullName" required />
          <FormField label="Registration number (STJ/YYYY/NNNNN)" name="registrationNumber" required />
          <FormField label="Admission year" name="admissionYear" type="number" required min="1900" max="2200" defaultValue={String(new Date().getFullYear())} />
          <FormField label="Year of study" name="yearOfStudy" type="number" required min="1" max="10" defaultValue="1" />
          <label className="portal-field"><span>Programme</span><select className="auth-input" name="programmeId"><option value="">Not assigned</option>{programmes.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
          <label className="portal-field"><span>Initial status</span><select className="auth-input" name="status"><option value="APPLICANT">Applicant</option><option value="ACTIVE">Active</option></select></label>
          <button className="button button-primary" disabled={working} type="submit">{working ? "Sending invitation…" : "Send invitation"}</button>
        </form></section>}
        {showForm && area === "admin" && page === "academics" && <section className="panel"><div className="panel-header"><h2>Create course</h2><button onClick={() => setShowForm(false)} type="button">Cancel</button></div><form className="portal-action-form" onSubmit={(event) => void handleForm(event, "/api/admin/academics", (form) => ({ code: form.get("code"), name: form.get("name"), department: form.get("department"), creditUnits: Number(form.get("creditUnits")), programmeId: form.get("programmeId"), yearOfStudy: Number(form.get("yearOfStudy")) }))}>
          <FormField label="Course code" name="code" required /><FormField label="Course name" name="name" required /><FormField label="Department" name="department" required /><FormField label="Credit units" name="creditUnits" type="number" required min="0.5" max="60" />
          <label className="portal-field"><span>Programme</span><select className="auth-input" name="programmeId" required><option value="">Select a programme</option>{programmes.map((item) => <option key={item.id} value={item.id}>{item.code} · {item.name}</option>)}</select></label>
          <FormField label="Year of study" name="yearOfStudy" type="number" required min="1" max="10" defaultValue="1" />
          <button className="button button-primary" disabled={working} type="submit">{working ? "Saving…" : "Create course"}</button>
        </form></section>}
        {showForm && area === "admin" && page === "results" && <section className="panel"><div className="panel-header"><h2>Record an examination result</h2><button onClick={() => setShowForm(false)} type="button">Cancel</button></div><form className="portal-action-form" onSubmit={(event) => void handleForm(event, "/api/admin/results", (form) => ({ courseRegistrationId: form.get("courseRegistrationId"), marks: Number(form.get("marks")), grade: form.get("grade"), gradePoints: Number(form.get("gradePoints")), publish: form.get("publish") === "on" }))}>
          <label className="portal-field"><span>Student course registration</span><select className="auth-input" name="courseRegistrationId" required>{registrations.map((item) => <option key={item.id} value={item.id}>{item.registrationNumber} · {item.studentName} · {item.course} · {item.semester}</option>)}</select></label>
          <FormField label="Marks (0–100)" name="marks" type="number" required min="0" max="100" />
          <label className="portal-field"><span>Grade</span><select className="auth-input" name="grade">{["A", "A-", "B+", "B", "B-", "C+", "C", "C-", "D+", "D", "F"].map((grade) => <option key={grade}>{grade}</option>)}</select></label>
          <FormField label="Grade points (0–5)" name="gradePoints" type="number" required min="0" max="5" />
          <label className="portal-field"><span><input type="checkbox" name="publish" /> Publish immediately to the student</span></label>
          <button className="button button-primary" disabled={working || registrations.length === 0} type="submit">{working ? "Saving…" : "Save result"}</button>
        </form></section>}
        {showForm && area === "admin" && page === "users" && <section className="panel"><div className="panel-header"><h2>Invite administrator</h2><button onClick={() => setShowForm(false)} type="button">Cancel</button></div><form className="portal-action-form" onSubmit={(event) => void handleForm(event, "/api/admin/users", (form) => ({ email: form.get("email"), fullName: form.get("fullName"), role: form.get("role") }))}>
          <FormField label="University email" name="email" type="email" required /><FormField label="Full name" name="fullName" required />
          <label className="portal-field"><span>Role</span><select className="auth-input" name="role"><option value="ADMIN">Administrator</option><option value="SUPER_ADMIN">Super administrator</option></select></label>
          <button className="button button-primary" disabled={working || identity.role !== "SUPER_ADMIN"} type="submit">{working ? "Sending invitation…" : "Send invitation"}</button>
          {identity.role !== "SUPER_ADMIN" && <p className="muted-copy">Only a super administrator can invite administrator accounts.</p>}
        </form></section>}
        {page === "results" && area === "admin" && <div className="flow-disclaimer">Only publish verified, approved marks. Published results become visible in the affected student account.</div>}
      </div>
    </main>
  </div>;
}
