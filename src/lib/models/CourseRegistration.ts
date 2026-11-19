import mongoose, { Schema, model, models, type Document } from "mongoose";

export type RegistrationStatus = "REGISTERED" | "DROPPED" | "CANCELLED";

export interface ICourseRegistration extends Document {
  _id: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  courseId: mongoose.Types.ObjectId;
  semesterId: mongoose.Types.ObjectId;
  status: RegistrationStatus;
  registeredAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const CourseRegistrationSchema = new Schema<ICourseRegistration>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    courseId: { type: Schema.Types.ObjectId, ref: "Course", required: true },
    semesterId: { type: Schema.Types.ObjectId, ref: "Semester", required: true },
    status: {
      type: String,
      enum: ["REGISTERED", "DROPPED", "CANCELLED"],
      default: "REGISTERED",
    },
    registeredAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

CourseRegistrationSchema.index({ studentId: 1, courseId: 1, semesterId: 1 }, { unique: true });
CourseRegistrationSchema.index({ studentId: 1, status: 1 });
CourseRegistrationSchema.index({ status: 1 });

export const CourseRegistrationModel =
  models.CourseRegistration ??
  model<ICourseRegistration>("CourseRegistration", CourseRegistrationSchema);
