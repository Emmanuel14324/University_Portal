import mongoose, { Schema, model, models, type Document } from "mongoose";

export type SemesterStatus =
  | "UPCOMING"
  | "REGISTRATION_OPEN"
  | "ACTIVE"
  | "GRADING"
  | "CLOSED";

export interface ISemester extends Document {
  _id: mongoose.Types.ObjectId;
  academicYear: string;
  name: string;
  startsOn: Date;
  endsOn: Date;
  registrationOpensAt: Date | null;
  registrationClosesAt: Date | null;
  status: SemesterStatus;
  createdAt: Date;
  updatedAt: Date;
}

const SemesterSchema = new Schema<ISemester>(
  {
    academicYear: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    startsOn: { type: Date, required: true },
    endsOn: { type: Date, required: true },
    registrationOpensAt: { type: Date, default: null },
    registrationClosesAt: { type: Date, default: null },
    status: {
      type: String,
      enum: ["UPCOMING", "REGISTRATION_OPEN", "ACTIVE", "GRADING", "CLOSED"],
      default: "UPCOMING",
    },
  },
  { timestamps: true },
);

SemesterSchema.index({ status: 1 });
SemesterSchema.index({ startsOn: -1 });

export const SemesterModel = models.Semester ?? model<ISemester>("Semester", SemesterSchema);
