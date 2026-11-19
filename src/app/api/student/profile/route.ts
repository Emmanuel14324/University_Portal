import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { authorizeApiRequest } from "@/lib/auth/api-authorization";
import { apiUnavailable, getActiveStudentIdentity, StudentApiError } from "@/lib/api/students";
import { isSameOriginRequest, jsonError, readJson } from "@/lib/auth/http";
import { connectToDatabase } from "@/lib/mongodb/connection";
import { StudentProfileModel } from "@/lib/models";
import { studentProfileUpdateSchema } from "@/lib/validation/student";

export async function PATCH(request: NextRequest) {
  if (!isSameOriginRequest(request)) {
    return jsonError("Cross-origin requests are not allowed.", 403);
  }
  const access = await authorizeApiRequest(request, ["STUDENT"]);
  if (access.response) return access.response;

  const parsed = studentProfileUpdateSchema.safeParse(await readJson(request));
  if (!parsed.success) return jsonError("Provide valid editable profile fields.", 400);

  try {
    const student = await getActiveStudentIdentity(access.session.id);
    if (!student) return jsonError("An active student account is required.", 403);

    await connectToDatabase();

    // Map snake_case field names from the Zod schema to Mongoose camelCase field names
    const update: Record<string, unknown> = {};
    const data = parsed.data as Record<string, unknown>;
    const fieldMap: Record<string, string> = {
      phone_number: "phoneNumber",
      date_of_birth: "dateOfBirth",
      address: "address",
      emergency_contact_name: "emergencyContactName",
      emergency_contact_phone: "emergencyContactPhone",
    };
    for (const [snakeKey, camelKey] of Object.entries(fieldMap)) {
      if (snakeKey in data) update[camelKey] = data[snakeKey];
    }

    const updated = await StudentProfileModel.findOneAndUpdate(
      { studentId: new mongoose.Types.ObjectId(student.id) },
      { $set: update },
      { new: true },
    );
    if (!updated) return jsonError("The student profile has not been provisioned.", 404);

    return NextResponse.json({ updated: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof StudentApiError) return apiUnavailable("Student profile update failed.");
    throw error;
  }
}
