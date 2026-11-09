import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EmbeddingError, embedTexts } from "@/lib/ai/embeddings";
import { getEmbeddingConfig } from "@/lib/env";
import { mockEmbeddingsApi } from "./pdfHelpers";

const KEYS = ["AI_PROVIDER", "EMBEDDING_DIMENSIONS", "EMBEDDING_MODEL", "AI_BASE_URL", "GROQ_API_KEY", "OPENAI_API_KEY"];
let saved: Record<string, string | undefined>;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  vi.unstubAllGlobals();
});

describe("AI_PROVIDER=Groq", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "Groq";
    process.env.GROQ_API_KEY = "gsk_test";
  });

  it("uses Groq's OpenAI-compatible endpoint with nomic-embed-text-v1_5 (768 dims)", async () => {
    const fetch = mockEmbeddingsApi(768);
    const [v] = await embedTexts(["hello"], "document");
    expect(v).toHaveLength(768);

    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.groq.com/openai/v1/embeddings");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("nomic-embed-text-v1_5");
    expect(body).not.toHaveProperty("dimensions");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer gsk_test");
  });

  it("adds nomic task prefixes for documents and queries", async () => {
    const fetch = mockEmbeddingsApi(768);
    await embedTexts(["doc text"], "document");
    await embedTexts(["a question"], "query");
    const inputs = fetch.mock.calls.map(([, init]) => JSON.parse(String(init?.body)).input[0]);
    expect(inputs).toEqual(["search_document: doc text", "search_query: a question"]);
  });

  it("refuses a dimension setting the model can't produce", () => {
    process.env.EMBEDDING_DIMENSIONS = "1024";
    expect(() => getEmbeddingConfig()).toThrow(/768/);
  });

  it("requires GROQ_API_KEY", async () => {
    delete process.env.GROQ_API_KEY;
    await expect(embedTexts(["x"], "document")).rejects.toThrow(/GROQ_API_KEY/);
  });
});

describe("AI_PROVIDER=OpenAI", () => {
  beforeEach(() => {
    process.env.AI_PROVIDER = "OpenAI";
    process.env.OPENAI_API_KEY = "sk-test";
  });

  it("uses OpenAI's default endpoint and model", async () => {
    const fetch = mockEmbeddingsApi(1536);
    await embedTexts(["hello"], "document");
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/embeddings");
    const body = JSON.parse(String(init?.body));
    expect(body.model).toBe("text-embedding-3-small");
    expect(body.input).toEqual(["hello"]);
  });

  it("requests shortened vectors when EMBEDDING_DIMENSIONS is set", async () => {
    process.env.EMBEDDING_DIMENSIONS = "256";
    const fetch = mockEmbeddingsApi(256);
    await embedTexts(["hello"], "query");
    expect(JSON.parse(String(fetch.mock.calls[0][1]?.body)).dimensions).toBe(256);
  });

  it("batches large inputs and preserves order", async () => {
    process.env.EMBEDDING_DIMENSIONS = "8";
    const fetch = mockEmbeddingsApi(8);
    const texts = Array.from({ length: 150 }, (_, i) => `t${i}`);
    const vectors = await embedTexts(texts, "document");
    expect(vectors).toHaveLength(150);
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it("rejects vectors of the wrong size", async () => {
    mockEmbeddingsApi(10);
    await expect(embedTexts(["x"], "document")).rejects.toBeInstanceOf(EmbeddingError);
  });

  it("surfaces an auth failure without retrying", async () => {
    const fetch = mockEmbeddingsApi(1536, 401);
    await expect(embedTexts(["x"], "document")).rejects.toThrow(/rejected the API key/);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("retries on 429", async () => {
    let calls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        calls++;
        if (calls === 1) return new Response("slow down", { status: 429, headers: { "retry-after": "1" } });
        return Response.json({ data: [{ index: 0, embedding: new Array(1536).fill(0.1) }] });
      }),
    );
    await expect(embedTexts(["x"], "document")).resolves.toHaveLength(1);
    expect(calls).toBe(2);
  });
});

it("rejects an unknown AI_PROVIDER", () => {
  process.env.AI_PROVIDER = "Anthropic";
  expect(() => getEmbeddingConfig()).toThrow(/Groq.*OpenAI/);
});
