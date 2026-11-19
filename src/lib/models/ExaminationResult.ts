import mongoose, { Schema, model, models, type Document } from "mongoose";

export type ResultStatus = "DRAFT" | "PUBLISHED";

export interface IExaminationResult extends Document {
  _id: mongoose.Types.ObjectId;
  courseRegistrationId: mongoose.Types.ObjectId;
  marks: number;
  grade: string;
  gradePoints: number;
  status: ResultStatus;
  publishedAt: Date | null;
  recordedBy: mongoose.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const ExaminationResultSchema = new Schema<IExaminationResult>(
  {
    courseRegistrationId: {
      type: Schema.Types.ObjectId,
      ref: "CourseRegistration",
      required: true,
      unique: true,
    },
    marks: { type: Number, required: true, min: 0, max: 100 },
    grade: { type: String, required: true },
    gradePoints: { type: Number, required: true, min: 0, max: 5 },
    status: { type: String, enum: ["DRAFT", "PUBLISHED"], default: "DRAFT" },
    publishedAt: { type: Date, default: null },
    recordedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: true },
);

ExaminationResultSchema.index({ courseRegistrationId: 1 });
ExaminationResultSchema.index({ status: 1 });

export const ExaminationResultModel =
  models.ExaminationResult ??
  model<IExaminationResult>("ExaminationResult", ExaminationResultSchema);
