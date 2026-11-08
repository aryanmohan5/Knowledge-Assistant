import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantOwned, tenantScope } from "@/lib/db/plugins/tenantScope";

export const USER_ROLES = ["owner", "admin", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

const userSchema = new Schema(
  {
    ...tenantOwned,
    email: { type: String, required: true, lowercase: true, trim: true, maxlength: 254 },
    name: { type: String, trim: true, maxlength: 120 },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: USER_ROLES, default: "member", required: true },
    status: { type: String, enum: ["active", "disabled"], default: "active", required: true },
    lastLoginAt: { type: Date },
  },
  {
    timestamps: true,
    strict: "throw",
    strictQuery: "throw",
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret.passwordHash;
        return ret;
      },
    },
  },
);

// Emails are unique per organization, not globally.
userSchema.index({ organizationId: 1, email: 1 }, { unique: true });
userSchema.plugin(tenantScope);

export type UserDoc = InferSchemaType<typeof userSchema>;

export const User = (models.User as Model<UserDoc>) || model<UserDoc>("User", userSchema);
