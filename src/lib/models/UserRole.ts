import mongoose, { Schema, model, models, type Document } from "mongoose";

export type AppRole = "STUDENT" | "ADMIN" | "SUPER_ADMIN";

export interface IUserRole extends Document {
  _id: mongoose.Types.ObjectId;
  userId: mongoose.Types.ObjectId;
  role: AppRole;
  assignedBy: mongoose.Types.ObjectId | null;
  assignedAt: Date;
}

const UserRoleSchema = new Schema<IUserRole>({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true },
  role: { type: String, enum: ["STUDENT", "ADMIN", "SUPER_ADMIN"], required: true },
  assignedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  assignedAt: { type: Date, default: Date.now },
});

UserRoleSchema.index({ userId: 1 });

export const UserRoleModel = models.UserRole ?? model<IUserRole>("UserRole", UserRoleSchema);
