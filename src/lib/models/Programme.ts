import mongoose, { Schema, model, models, type Document } from "mongoose";

export interface IProgramme extends Document {
  _id: mongoose.Types.ObjectId;
  code: string;
  name: string;
  award: string;
  department: string;
  durationYears: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const ProgrammeSchema = new Schema<IProgramme>(
  {
    code: { type: String, required: true, unique: true, uppercase: true, trim: true },
    name: { type: String, required: true, trim: true },
    award: { type: String, required: true, trim: true },
    department: { type: String, required: true, trim: true },
    durationYears: { type: Number, required: true, min: 1 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

export const ProgrammeModel = models.Programme ?? model<IProgramme>("Programme", ProgrammeSchema);
