import mongoose, { Schema, model, models, type Document } from "mongoose";

export interface IWebAuthnCredential extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  credentialId: string;
  publicKey: Buffer;
  signatureCounter: number;
  transports: string[];
  deviceName: string | null;
  backedUp: boolean;
  lastUsedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const WebAuthnCredentialSchema = new Schema<IWebAuthnCredential>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    credentialId: { type: String, required: true, unique: true },
    publicKey: { type: Buffer, required: true },
    signatureCounter: { type: Number, required: true, default: 0 },
    transports: { type: [String], default: [] },
    deviceName: { type: String, default: null },
    backedUp: { type: Boolean, default: false },
    lastUsedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

WebAuthnCredentialSchema.index({ userId: 1 });
WebAuthnCredentialSchema.index({ credentialId: 1 });

export const WebAuthnCredentialModel =
  models.WebAuthnCredential ??
  model<IWebAuthnCredential>("WebAuthnCredential", WebAuthnCredentialSchema);
