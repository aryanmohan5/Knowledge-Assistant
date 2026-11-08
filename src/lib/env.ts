import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB: z.string().min(1).optional(),
  AUTH_SECRET: z.string().min(32, "AUTH_SECRET must be at least 32 characters").optional(),
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

// ---------------------------------------------------------------------------
// Embeddings
// ---------------------------------------------------------------------------

export const AI_PROVIDERS = {
  groq: {
    baseUrl: "https://api.groq.com/openai/v1",
    model: "nomic-embed-text-v1_5",
    dimensions: 768,
    chatModel: "llama-3.3-70b-versatile",
    apiKeyEnv: "GROQ_API_KEY",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "text-embedding-3-small",
    dimensions: 1536,
    chatModel: "gpt-4o-mini",
    apiKeyEnv: "OPENAI_API_KEY",
  },
} as const;

export type AiProvider = keyof typeof AI_PROVIDERS;

export type EmbeddingConfig = {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  dimensions: number;
  /** Send `dimensions` in the request (OpenAI text-embedding-3 models can shorten vectors). */
  requestDimensions: boolean;
  indexName: string;
};

/**
 * Embedding settings derived from AI_PROVIDER ("Groq" or "OpenAI",
 * case-insensitive; defaults to OpenAI). Does not require MONGODB_URI or an
 * API key, so models and the index script can use it.
 */
export function getAiProvider(): AiProvider {
  const raw = (process.env.AI_PROVIDER || "openai").trim().toLowerCase();
  if (!(raw in AI_PROVIDERS)) {
    throw new Error(`AI_PROVIDER must be "Groq" or "OpenAI" (got "${process.env.AI_PROVIDER}")`);
  }
  return raw as AiProvider;
}

function aiBaseUrl(provider: AiProvider): string {
  return (process.env.AI_BASE_URL?.trim() || AI_PROVIDERS[provider].baseUrl).replace(/\/+$/, "");
}

export function getEmbeddingConfig(): EmbeddingConfig {
  const provider = getAiProvider();
  const preset = AI_PROVIDERS[provider];

  const model = process.env.EMBEDDING_MODEL?.trim() || preset.model;
  const explicitDims = process.env.EMBEDDING_DIMENSIONS?.trim();
  const dimensions = explicitDims
    ? z.coerce.number().int().min(1).max(8192).parse(explicitDims)
    : preset.dimensions;

  if (provider === "groq" && /nomic-embed-text/i.test(model) && dimensions !== 768) {
    throw new Error(`${model} produces 768-dimensional vectors; set EMBEDDING_DIMENSIONS=768 or leave it unset`);
  }

  return {
    provider,
    baseUrl: aiBaseUrl(provider),
    model,
    dimensions,
    requestDimensions: provider === "openai" && !!explicitDims && /^text-embedding-3/.test(model),
    indexName: process.env.VECTOR_INDEX_NAME || "chunk_vector_index",
  };
}

export type ChatConfig = { provider: AiProvider; baseUrl: string; model: string };

/** Chat (LLM) settings from the same AI_PROVIDER toggle; CHAT_MODEL overrides the default. */
export function getChatConfig(): ChatConfig {
  const provider = getAiProvider();
  return {
    provider,
    baseUrl: aiBaseUrl(provider),
    model: process.env.CHAT_MODEL?.trim() || AI_PROVIDERS[provider].chatModel,
  };
}

export function getAiApiKey(provider: AiProvider): string {
  const name = AI_PROVIDERS[provider].apiKeyEnv;
  const key = process.env[name]?.trim();
  if (!key) throw new Error(`${name} is required when AI_PROVIDER=${provider}`);
  return key;
}
