import mongoose, { Schema, model, models, type Document } from "mongoose";

export interface ISecurityAuditLog extends Document {
  _id: mongoose.Types.ObjectId;
  actorUserId: mongoose.Types.ObjectId | null;
  subjectUserId: mongoose.Types.ObjectId | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: Record<string, unknown> | null;
  createdAt: Date;
}

const SecurityAuditLogSchema = new Schema<ISecurityAuditLog>(
  {
    actorUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    subjectUserId: { type: Schema.Types.ObjectId, ref: "User", default: null },
    action: { type: String, required: true },
    entityType: { type: String, default: null },
    entityId: { type: String, default: null },
    details: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: "createdAt", updatedAt: false } },
);

SecurityAuditLogSchema.index({ createdAt: -1 });
SecurityAuditLogSchema.index({ actorUserId: 1 });

export const SecurityAuditLogModel =
  models.SecurityAuditLog ??
  model<ISecurityAuditLog>("SecurityAuditLog", SecurityAuditLogSchema);
