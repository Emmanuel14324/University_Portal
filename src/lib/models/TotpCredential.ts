import mongoose, { Schema, model, models, type Document } from "mongoose";

export interface ITotpCredential extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  secretCiphertext: string;
  encryptionKeyVersion: number;
  recoveryCodeHashes: string[];
  lastVerifiedStep: number | null;
  isEnabled: boolean;
  enabledAt: Date | null;
  enrollmentExpiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const TotpCredentialSchema = new Schema<ITotpCredential>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
    secretCiphertext: { type: String, required: true },
    encryptionKeyVersion: { type: Number, default: 1 },
    recoveryCodeHashes: { type: [String], default: [] },
    lastVerifiedStep: { type: Number, default: null },
    isEnabled: { type: Boolean, default: false },
    enabledAt: { type: Date, default: null },
    enrollmentExpiresAt: { type: Date, default: null },
  },
  { timestamps: true },
);

TotpCredentialSchema.index({ userId: 1 });

export const TotpCredentialModel =
  models.TotpCredential ?? model<ITotpCredential>("TotpCredential", TotpCredentialSchema);
