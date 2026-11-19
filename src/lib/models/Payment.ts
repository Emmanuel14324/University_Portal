import mongoose, { Schema, model, models, type Document } from "mongoose";

export type PaymentStatus = "PENDING" | "PAID" | "FAILED" | "REVERSED";

export interface IPayment extends Document {
  _id: mongoose.Types.ObjectId;
  feeStatementId: mongoose.Types.ObjectId;
  reference: string;
  amount: number;
  method: string;
  status: PaymentStatus;
  paidAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const PaymentSchema = new Schema<IPayment>(
  {
    feeStatementId: { type: Schema.Types.ObjectId, ref: "FeeStatement", required: true },
    reference: { type: String, required: true, unique: true, trim: true },
    amount: { type: Number, required: true, min: 0 },
    method: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["PENDING", "PAID", "FAILED", "REVERSED"],
      default: "PENDING",
    },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true },
);

PaymentSchema.index({ feeStatementId: 1 });

export const PaymentModel = models.Payment ?? model<IPayment>("Payment", PaymentSchema);
