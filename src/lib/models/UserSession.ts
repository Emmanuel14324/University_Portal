import mongoose, { Schema, model, models, type Document } from "mongoose";

export interface IUserSession extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  sessionTokenHash: string;
  expiresAt: Date;
  revokedAt: Date | null;
  lastSeenAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const UserSessionSchema = new Schema<IUserSession>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    sessionTokenHash: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    revokedAt: { type: Date, default: null },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

UserSessionSchema.index({ sessionTokenHash: 1 });
UserSessionSchema.index({ userId: 1 });
UserSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const UserSessionModel =
  models.UserSession ?? model<IUserSession>("UserSession", UserSessionSchema);
