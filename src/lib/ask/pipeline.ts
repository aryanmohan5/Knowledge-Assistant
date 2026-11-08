import "server-only";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { createChatModel } from "@/lib/ai/chat";
import { EmbeddingError } from "@/lib/ai/embeddings";
import { AiError } from "@/lib/ai/errors";
import { HttpError } from "@/lib/http/errors";
import { searchByText, type ChunkHit } from "@/lib/rag/vectorSearch";
import { resolveAssistantToken, type ResolveFailure } from "@/lib/tenant/assistantToken";
import type { AssistantTokenPrincipal, TenantContext } from "@/lib/tenant/types";
import { NOT_FOUND_MESSAGE, verifyCitations, type Citation, type SourceChunk } from "./citations";
import { decompose, type DecomposerOutcome } from "./decomposer";
import type { AskInput } from "./request";
import { synthesize } from "./synthesizer";
import { hasDecision, runSystem1, type System1Result } from "./system1";

/*
 * The /api/ask pipeline. Each stage is a separate module:
 *
 *   1. Token        resolveAssistantToken → TenantContext (organizationId, allowed KBs)
 *   2. Retrieval    searchByText, tenant pre-filtered           ┐ run in parallel
 *   3. Decomposer   LLM → { intent, parameters } (zod-checked)  ┘
 *   4. System 1     deterministic TypeScript models, fed ONLY the Decomposer's JSON
 *   5. Synthesizer  LLM → answer from System 1 output + retrieved text
 *   6. Grounding    deterministic citation check on the answer
 */

export const RETRIEVAL_K = 6;

/** Chunks scoring below this (Atlas vectorSearchScore, 0–1) are treated as irrelevant. */
export function minRelevance(): number {
  const v = Number(process.env.ASK_MIN_RELEVANCE);
  return Number.isFinite(v) && v >= 0 && v <= 1 ? v : 0.6;
}

export type StageTrace = {
  stage: "token" | "retrieval" | "decomposer" | "system1" | "synthesizer" | "grounding";
  status: "ok" | "skipped" | "fallback";
  ms: number;
  detail?: string;
};

export type AskResult = {
  answer: string;
  grounded: boolean;
  citations: Citation[];
  invalidCitations: string[];
  decomposition: DecomposerOutcome;
  system1: System1Result[];
  sources: Array<Omit<SourceChunk, "text"> & { excerpt: string }>;
  trace: StageTrace[];
};

export type AskDeps = {
  resolveToken: typeof resolveAssistantToken;
  retrieve: (ctx: TenantContext<AssistantTokenPrincipal>, question: string, knowledgeBaseIds?: string[]) => Promise<ChunkHit[]>;
  decomposerModel: () => BaseChatModel;
  synthesizerModel: () => BaseChatModel;
};

export const defaultDeps: AskDeps = {
  resolveToken: resolveAssistantToken,
  retrieve: (ctx, question, knowledgeBaseIds) => searchByText(ctx, question, { k: RETRIEVAL_K, knowledgeBaseIds }),
  decomposerModel: () => createChatModel({ temperature: 0, json: true, maxTokens: 300 }),
  synthesizerModel: () => createChatModel({ temperature: 0, maxTokens: 800 }),
};

const TOKEN_ERRORS: Record<ResolveFailure, HttpError> = {
  malformed: new HttpError(401, "invalid_token", "The assistant token is invalid."),
  not_found: new HttpError(401, "invalid_token", "The assistant token is invalid."),
  revoked: new HttpError(401, "invalid_token", "This assistant token has been revoked."),
  expired: new HttpError(401, "invalid_token", "This assistant token has expired."),
  origin_not_allowed: new HttpError(403, "origin_not_allowed", "This website is not allowed to use this assistant token."),
  org_inactive: new HttpError(403, "org_inactive", "This assistant is currently unavailable."),
};

async function timed<T>(trace: StageTrace[], stage: StageTrace["stage"], fn: () => Promise<T> | T): Promise<T> {
  const start = performance.now();
  const value = await fn();
  trace.push({ stage, status: "ok", ms: Math.round(performance.now() - start) });
  return value;
}

/** Resolves the token alone, so the route can set CORS headers even when later stages fail. */
export async function authorizeAsk(input: AskInput, deps: Pick<AskDeps, "resolveToken"> = defaultDeps) {
  const resolved = await deps.resolveToken(input.token, input.origin);
  if (!resolved.ok) throw TOKEN_ERRORS[resolved.reason];
  return resolved.ctx;
}

/** Deterministic reply when there is nothing to synthesize from; no LLM, so nothing to hallucinate. */
function noContextAnswer(system1: System1Result[]): string {
  const hints = system1.flatMap((r) => {
    if (r.model === "checkEligibility" && r.status === "insufficient_input") {
      const parts = [
        r.missing.length ? `please provide your ${r.missing.join(" and ")}` : "",
        ...r.invalid,
      ].filter(Boolean);
      return [`To check eligibility, ${parts.join("; ")}.`];
    }
    return [];
  });
  return [NOT_FOUND_MESSAGE, ...hints].join(" ");
}

export async function answerQuestion(
  input: AskInput,
  deps: AskDeps = defaultDeps,
  hooks: { onAuthorized?: (ctx: TenantContext<AssistantTokenPrincipal>) => void } = {},
): Promise<AskResult> {
  const trace: StageTrace[] = [];

  // 1. Token → tenant. Everything below is scoped to tenant.organizationId.
  const tenant = await timed(trace, "token", () => authorizeAsk(input, deps));
  hooks.onAuthorized?.(tenant);

  // 2 + 3. Retrieval and Decomposer are independent, so they run concurrently.
  const [hits, decomposition] = await Promise.all([
    timed(trace, "retrieval", async () => {
      try {
        return await deps.retrieve(tenant, input.question, input.knowledgeBaseIds);
      } catch (err) {
        if (err instanceof HttpError) throw err;
        if (err instanceof EmbeddingError) {
          throw new AiError("retrieval", "The AI provider failed while searching the knowledge base. Please try again.", 502, err);
        }
        throw new AiError("retrieval", "Knowledge base search is temporarily unavailable.", 503, err);
      }
    }),
    timed(trace, "decomposer", () => decompose(input.question, deps.decomposerModel())),
  ]);
  if (decomposition.source !== "llm") {
    const t = trace.find((s) => s.stage === "decomposer")!;
    t.status = decomposition.source === "fallback" ? "fallback" : "ok";
    t.detail = decomposition.source === "fallback" ? `invalid output, used general_knowledge (${decomposition.error})` : "repaired on retry";
  }

  const threshold = minRelevance();
  const chunks: SourceChunk[] = hits
    .filter((h) => h.score >= threshold)
    .map((h) => ({
      knowledgeBaseId: h.knowledgeBaseId.toString(),
      documentName: h.documentName,
      pageNumber: h.pageNumber,
      text: h.text,
      score: h.score,
    }));
  trace.find((s) => s.stage === "retrieval")!.detail = `${chunks.length} of ${hits.length} chunks above ${threshold}`;

  // 4. System 1: deterministic, from the Decomposer's JSON only.
  const system1 = await timed(trace, "system1", () => runSystem1(decomposition.decomposition));

  // 5. Synthesizer, skipped when there is neither context nor a decision to report.
  let raw: string;
  if (chunks.length === 0 && !hasDecision(system1)) {
    raw = noContextAnswer(system1);
    trace.push({ stage: "synthesizer", status: "skipped", ms: 0, detail: "no relevant context or decision" });
  } else {
    raw = await timed(trace, "synthesizer", () =>
      synthesize({ question: input.question, chunks, system1, model: deps.synthesizerModel() }),
    );
  }

  // 6. Grounding check on the answer.
  const report = await timed(trace, "grounding", () => verifyCitations(raw, chunks, system1));
  if (report.invalidCitations.length) {
    trace.at(-1)!.detail = `removed ${report.invalidCitations.length} fabricated citation(s)`;
  }

  return {
    answer: report.answer,
    grounded: report.grounded,
    citations: report.citations,
    invalidCitations: report.invalidCitations,
    decomposition,
    system1,
    sources: chunks.map(({ text, ...c }) => ({ ...c, excerpt: text.slice(0, 300) })),
    trace,
  };
}
