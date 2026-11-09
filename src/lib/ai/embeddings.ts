import { getAiApiKey, getEmbeddingConfig } from "@/lib/env";

const BATCH_SIZE = 64;
const MAX_ATTEMPTS = 4;
const REQUEST_TIMEOUT_MS = 30_000;

/** Failure talking to the embedding provider; `message` is safe to show users. */
export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
  ) {
    super(message);
    this.name = "EmbeddingError";
  }
}

type EmbeddingResponse = { data?: Array<{ index: number; embedding: number[] }> };

/**
 * Nomic models are trained with task prefixes; omitting them noticeably
 * degrades retrieval quality.
 */
function taskPrefix(model: string, kind: "document" | "query"): string {
  if (!/nomic-embed-text/i.test(model)) return "";
  return kind === "document" ? "search_document: " : "search_query: ";
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function postEmbeddings(url: string, apiKey: string, body: unknown): Promise<EmbeddingResponse> {
  let lastError: EmbeddingError | undefined;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      lastError = new EmbeddingError("Could not reach the embedding provider");
      await sleep(500 * 2 ** attempt);
      continue;
    }

    if (res.ok) return (await res.json()) as EmbeddingResponse;

    const detail = (await res.text().catch(() => "")).slice(0, 300);
    if (res.status === 401 || res.status === 403) {
      throw new EmbeddingError("The embedding provider rejected the API key", res.status);
    }
    lastError = new EmbeddingError(`Embedding provider error (${res.status})${detail ? `: ${detail}` : ""}`, res.status);
    if (res.status !== 429 && res.status < 500) throw lastError;

    const retryAfter = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 30) * 1000 : 500 * 2 ** attempt);
  }

  throw lastError ?? new EmbeddingError("Embedding request failed");
}

/**
 * Embeds texts through the provider selected by AI_PROVIDER, using its
 * OpenAI-compatible `/embeddings` endpoint. Every returned vector is checked
 * against the configured dimensions so a mismatched model can never write
 * vectors the Atlas index can't use.
 */
export async function embedTexts(texts: string[], kind: "document" | "query"): Promise<number[][]> {
  if (texts.length === 0) return [];
  const cfg = getEmbeddingConfig();
  const apiKey = getAiApiKey(cfg.provider);
  const prefix = taskPrefix(cfg.model, kind);
  const vectors: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const batch = texts.slice(i, i + BATCH_SIZE);
    const json = await postEmbeddings(`${cfg.baseUrl}/embeddings`, apiKey, {
      model: cfg.model,
      input: batch.map((t) => prefix + t),
      encoding_format: "float",
      ...(cfg.requestDimensions ? { dimensions: cfg.dimensions } : {}),
    });

    const data = [...(json.data ?? [])].sort((a, b) => a.index - b.index);
    if (data.length !== batch.length) {
      throw new EmbeddingError(`Embedding provider returned ${data.length} vectors for ${batch.length} inputs`);
    }
    for (const { embedding } of data) {
      if (!Array.isArray(embedding) || embedding.length !== cfg.dimensions || !embedding.every(Number.isFinite)) {
        throw new EmbeddingError(
          `Embedding model returned ${embedding?.length ?? 0}-dimensional vectors; expected ${cfg.dimensions}. Check EMBEDDING_DIMENSIONS.`,
        );
      }
      vectors.push(embedding);
    }
  }

  return vectors;
}
