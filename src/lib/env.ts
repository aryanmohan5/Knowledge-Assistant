import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB: z.string().min(1).optional(),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters").optional(),
  EMBEDDING_DIMENSIONS: z.coerce.number().int().min(1).max(8192).default(1024),
  EMBEDDING_MODEL: z.string().min(1).default("voyage-3.5"),
  VECTOR_INDEX_NAME: z.string().min(1).default("chunk_vector_index"),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | undefined;

/**
 * Validated environment. Resolved lazily so `next build` can import server
 * modules without a database configured; the first real use fails fast.
 */
export function getEnv(): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  cached = parsed.data;
  return cached;
}

/** Embedding settings only; does not require MONGODB_URI. */
export function getEmbeddingConfig() {
  const dimensions = z.coerce.number().int().min(1).max(8192).default(1024).parse(process.env.EMBEDDING_DIMENSIONS);
  const model = process.env.EMBEDDING_MODEL || "voyage-3.5";
  const indexName = process.env.VECTOR_INDEX_NAME || "chunk_vector_index";
  return { dimensions, model, indexName };
}
