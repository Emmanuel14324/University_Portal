import mongoose, { Schema, model, models, type Document } from "mongoose";

export type AuthFactor =
  | "PASSWORD_TRANSACTION"
  | "TOTP"
  | "WEBAUTHN_REGISTRATION"
  | "WEBAUTHN_AUTHENTICATION"
  | "COMPLETION";

export interface IAuthChallenge extends Document {
  _id: mongoose.Types.ObjectId;
  authTransactionId: string;
  userId: mongoose.Types.ObjectId;
  factor: AuthFactor;
  challengeHash: string;
  webauthnChallenge: string | null;
  failedAttempts: number;
  expiresAt: Date;
  verifiedAt: Date | null;
  consumedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const AuthChallengeSchema = new Schema<IAuthChallenge>(
  {
    authTransactionId: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    factor: {
      type: String,
      enum: [
        "PASSWORD_TRANSACTION",
        "TOTP",
        "WEBAUTHN_REGISTRATION",
        "WEBAUTHN_AUTHENTICATION",
        "COMPLETION",
      ],
      required: true,
    },
    challengeHash: { type: String, required: true, unique: true },
    webauthnChallenge: { type: String, default: null },
    failedAttempts: { type: Number, default: 0 },
    expiresAt: { type: Date, required: true },
    verifiedAt: { type: Date, default: null },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

AuthChallengeSchema.index({ challengeHash: 1 });
AuthChallengeSchema.index({ authTransactionId: 1 });
AuthChallengeSchema.index({ userId: 1 });
AuthChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const AuthChallengeModel =
  models.AuthChallenge ?? model<IAuthChallenge>("AuthChallenge", AuthChallengeSchema);
