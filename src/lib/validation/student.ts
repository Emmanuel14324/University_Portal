import { z } from "zod";

const optionalContact = z.string().trim().min(7).max(24).regex(/^\+?[0-9 ()-]+$/);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
});

export const studentProfileUpdateSchema = z.object({
  phone_number: optionalContact.nullable().optional(),
  date_of_birth: dateOnly.nullable().optional(),
  address: z.string().trim().min(1).max(500).nullable().optional(),
  emergency_contact_name: z.string().trim().min(1).max(120).nullable().optional(),
  emergency_contact_phone: optionalContact.nullable().optional(),
}).strict().refine(
  (value) => Object.values(value).some((entry) => entry !== undefined),
  { message: "At least one editable profile field is required." },
);

export const studentCourseRegistrationSchema = z.object({
  courseId: z.string().uuid(),
  semesterId: z.string().uuid(),
}).strict();

export const adminStudentSearchSchema = z.object({
  search: z.string().trim().min(1).max(64).regex(/^[A-Za-z0-9/ -]+$/).optional(),
  status: z.enum([
    "APPLICANT",
    "ACTIVE",
    "ON_LEAVE",
    "SUSPENDED",
    "GRADUATED",
    "WITHDRAWN",
  ]).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
}).strict();
