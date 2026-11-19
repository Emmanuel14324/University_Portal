import mongoose, { Schema, model, models, type Document } from "mongoose";

export type FeeStatus = "PENDING" | "PARTIAL" | "PAID" | "OVERDUE" | "WAIVED";

export interface IFeeStatement extends Document {
  _id: mongoose.Types.ObjectId;
  studentId: mongoose.Types.ObjectId;
  semesterId: mongoose.Types.ObjectId;
  statementNumber: string;
  currency: string;
  billedAmount: number;
  dueAt: Date;
  status: FeeStatus;
  createdAt: Date;
  updatedAt: Date;
}

const FeeStatementSchema = new Schema<IFeeStatement>(
  {
    studentId: { type: Schema.Types.ObjectId, ref: "Student", required: true },
    semesterId: { type: Schema.Types.ObjectId, ref: "Semester", required: true },
    statementNumber: { type: String, required: true, unique: true, trim: true },
    currency: { type: String, required: true, default: "UGX" },
    billedAmount: { type: Number, required: true, min: 0 },
    dueAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["PENDING", "PARTIAL", "PAID", "OVERDUE", "WAIVED"],
      default: "PENDING",
    },
  },
  { timestamps: true },
);

FeeStatementSchema.index({ studentId: 1, createdAt: -1 });
FeeStatementSchema.index({ semesterId: 1 });

export const FeeStatementModel =
  models.FeeStatement ?? model<IFeeStatement>("FeeStatement", FeeStatementSchema);
