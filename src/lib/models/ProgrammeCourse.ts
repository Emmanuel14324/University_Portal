import mongoose, { Schema, model, models, type Document } from "mongoose";

export interface IProgrammeCourse extends Document {
  _id: mongoose.Types.ObjectId;
  programmeId: mongoose.Types.ObjectId;
  courseId: mongoose.Types.ObjectId;
  yearOfStudy: number;
}

const ProgrammeCourseSchema = new Schema<IProgrammeCourse>({
  programmeId: { type: Schema.Types.ObjectId, ref: "Programme", required: true },
  courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
  yearOfStudy: { type: Number, required: true, min: 1, max: 10 },
});

ProgrammeCourseSchema.index({ programmeId: 1, courseId: 1 }, { unique: true });
ProgrammeCourseSchema.index({ programmeId: 1, yearOfStudy: 1 });

export const ProgrammeCourseModel =
  models.ProgrammeCourse ?? model<IProgrammeCourse>("ProgrammeCourse", ProgrammeCourseSchema);
