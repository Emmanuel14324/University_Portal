import mongoose, { Schema, model, models, type Document } from "mongoose";

export interface IAuthRateLimit extends Document {
  _id: mongoose.Types.ObjectId;
  identifierHash: string;
  failureCount: number;
  lockedUntil: Date | null;
  windowStartsAt: Date;
  updatedAt: Date;
}

const AuthRateLimitSchema = new Schema<IAuthRateLimit>(
  {
    identifierHash: { type: String, required: true, unique: true },
    failureCount: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    windowStartsAt: { type: Date, default: Date.now },
  },
  { timestamps: { createdAt: false, updatedAt: "updatedAt" } },
);

AuthRateLimitSchema.index({ identifierHash: 1 });
AuthRateLimitSchema.index({ lockedUntil: 1 });

export const AuthRateLimitModel =
  models.AuthRateLimit ?? model<IAuthRateLimit>("AuthRateLimit", AuthRateLimitSchema);
