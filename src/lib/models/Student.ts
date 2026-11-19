import mongoose, { Schema, model, models, type Document } from "mongoose";

export type StudentStatus =
  | "APPLICANT"
  | "ACTIVE"
  | "ON_LEAVE"
  | "SUSPENDED"
  | "GRADUATED"
  | "WITHDRAWN";

export interface IStudent extends Document {
  _id: mongoose.Types.ObjectId;
  authUserId: mongoose.Types.ObjectId;
  registrationNumber: string;
  programmeId: mongoose.Types.ObjectId | null;
  admissionYear: number;
  yearOfStudy: number;
  status: StudentStatus;
  createdAt: Date;
  updatedAt: Date;
}

const StudentSchema = new Schema<IStudent>(
  {
    authUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    registrationNumber: { type: String, required: true, unique: true, uppercase: true, trim: true },
    programmeId: { type: Schema.Types.ObjectId, ref: "Programme", default: null },
    admissionYear: { type: Number, required: true },
    yearOfStudy: { type: Number, required: true, min: 1, max: 10 },
    status: {
      type: String,
      enum: ["APPLICANT", "ACTIVE", "ON_LEAVE", "SUSPENDED", "GRADUATED", "WITHDRAWN"],
      default: "APPLICANT",
    },
  },
  { timestamps: true },
);

StudentSchema.index({ authUserId: 1 });
StudentSchema.index({ registrationNumber: 1 });
StudentSchema.index({ status: 1 });

export const StudentModel = models.Student ?? model<IStudent>("Student", StudentSchema);
