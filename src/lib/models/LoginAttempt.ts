import mongoose, { Schema, model, models, type Document } from "mongoose";

export interface ILoginAttempt extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId | null;
  identifierHash: string;
  factor: string;
  succeeded: boolean;
  createdAt: Date;
}

const LoginAttemptSchema = new Schema<ILoginAttempt>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    identifierHash: { type: String, required: true },
    factor: { type: String, required: true },
    succeeded: { type: Boolean, required: true },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } },
);

LoginAttemptSchema.index({ identifierHash: 1, createdAt: -1 });

export const LoginAttemptModel =
  models.LoginAttempt ?? model<ILoginAttempt>("LoginAttempt", LoginAttemptSchema);
