import mongoose, { Schema, model, models, type Document } from "mongoose";

export interface IStudentProfile extends Document {
  _id: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  fullName: string;
  phoneNumber: string | null;
  dateOfBirth: string | null;
  address: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const StudentProfileSchema = new Schema<IStudentProfile>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true, unique: true },
    fullName: { type: String, required: true, trim: true },
    phoneNumber: { type: String, default: null },
    dateOfBirth: { type: String, default: null },
    address: { type: String, default: null },
    emergencyContactName: { type: String, default: null },
    emergencyContactPhone: { type: String, default: null },
  },
  { timestamps: true },
);

StudentProfileSchema.index({ studentId: 1 });

export const StudentProfileModel =
  models.StudentProfile ?? model<IStudentProfile>("StudentProfile", StudentProfileSchema);
