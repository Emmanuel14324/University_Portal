import "server-only";
import { connectToDatabase } from "@/lib/mongodb/connection";
import { StudentModel } from "@/lib/models";

export class StudentApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StudentApiError";
  }
}

export async function getActiveStudentIdentity(authUserId: string) {
  await connectToDatabase();
  const student = await StudentModel.findOne({ authUserId })
    .select("_id registrationNumber programmeId admissionYear yearOfStudy status")
    .lean();

  if (!student || student.status !== "ACTIVE") return null;

  return {
    id: student._id.toString(),
    registration_number: student.registrationNumber,
    programme_id: student.programmeId?.toString() ?? null,
    admission_year: student.admissionYear,
    year_of_study: student.yearOfStudy,
    status: student.status,
  };
}

export function apiUnavailable(message: string) {
  console.error(message);
  return Response.json(
    { error: { message: "The university data service is temporarily unavailable." } },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}
