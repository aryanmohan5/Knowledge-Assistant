import { Schema, model, models, type InferSchemaType, type Model } from "mongoose";
import { tenantOwned, tenantScope } from "@/lib/db/plugins/tenantScope";

export const ASSISTANT_TOKEN_SCOPES = ["chat"] as const;

/**
 * Credential behind an external embed URL. Only the SHA-256 of the token is
 * stored; the raw value is shown once at creation.
 */
const assistantTokenSchema = new Schema(
  {
    ...tenantOwned,
    name: { type: String, required: true, trim: true, maxlength: 100 },
    tokenHash: { type: String, required: true, immutable: true, select: false, match: /^[a-f0-9]{64}$/ },
    tokenPrefix: { type: String, required: true, immutable: true },
    allowedOrigins: {
      type: [String],
      required: true,
      validate: { validator: (v: string[]) => v.length > 0 && v.length <= 20, message: "1-20 allowed origins required" },
    },
    // Empty means every knowledge base in the organization.
    knowledgeBaseIds: { type: [{ type: Schema.Types.ObjectId, ref: "KnowledgeBase" }], default: [] },
    scopes: { type: [{ type: String, enum: ASSISTANT_TOKEN_SCOPES }], default: ["chat"] },
    expiresAt: { type: Date },
    revokedAt: { type: Date, default: null },
    lastUsedAt: { type: Date },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  },
  {
    timestamps: true,
    strict: "throw",
    strictQuery: "throw",
    toJSON: {
      transform(_doc, ret: Record<string, unknown>) {
        delete ret.tokenHash;
        return ret;
      },
    },
  },
);

assistantTokenSchema.index({ tokenHash: 1 }, { unique: true });
assistantTokenSchema.index({ organizationId: 1, revokedAt: 1, createdAt: -1 });
assistantTokenSchema.plugin(tenantScope);

export type AssistantTokenDoc = InferSchemaType<typeof assistantTokenSchema>;

export const AssistantToken =
  (models.AssistantToken as Model<AssistantTokenDoc>) ||
  model<AssistantTokenDoc>("AssistantToken", assistantTokenSchema);
