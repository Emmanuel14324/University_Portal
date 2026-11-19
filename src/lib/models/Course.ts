import mongoose, { Schema, model, models, type Document } from "mongoose";

export interface ICourse extends Document {
  _id: mongoose.Types.ObjectId;
  code: string;
  name: string;
  department: string;
  creditUnits: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const CourseSchema = new Schema<ICourse>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    department: { type: String, required: true, trim: true },
    creditUnits: { type: Number, required: true, min: 0.5 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const CourseModel = models.Course ?? model<ICourse>("Course", CourseSchema);
