import mongoose, { Schema, model, models, type Document } from "mongoose";

export interface IPortalSetting extends Document {
  _id: mongoose.Types.ObjectId;
  key: string;
  value: Record<string, unknown>;
  updatedBy: mongoose.Types.ObjectId | null;
  updatedAt: Date;
}

const PortalSettingSchema = new Schema<IPortalSetting>(
  {
    key: { type: String, required: true, unique: true },
    value: { type: Schema.Types.Mixed, required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null },
  },
  { timestamps: { createdAt: false, updatedAt: "updatedAt" } },
);

export const PortalSettingModel =
  models.PortalSetting ?? model<IPortalSetting>("PortalSetting", PortalSettingSchema);
