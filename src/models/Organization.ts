import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";

export const ORG_SLUG_REGEX = /^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/;

const organizationSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      immutable: true,
      match: ORG_SLUG_REGEX,
    },
    status: { type: String, enum: ["active", "suspended"], default: "active", required: true },
    plan: { type: String, enum: ["free", "pro", "enterprise"], default: "free", required: true },
  },
  { timestamps: true, strict: "throw", strictQuery: "throw" },
);

organizationSchema.index({ slug: 1 }, { unique: true });

export type OrganizationDoc = InferSchemaType<typeof organizationSchema>;

export const Organization =
  (models.Organization as Model<OrganizationDoc>) || model<OrganizationDoc>("Organization", organizationSchema);
