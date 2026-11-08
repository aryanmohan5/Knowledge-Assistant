import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { BaseMessage } from "@langchain/core/messages";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { Types } from "mongoose";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getChatConfig } from "@/lib/env";
import { NOT_FOUND_MESSAGE, verifyCitations } from "@/lib/ask/citations";
import { decompose, extractJson } from "@/lib/ask/decomposer";
import { answerQuestion, defaultDeps, type AskDeps } from "@/lib/ask/pipeline";
import { parseAskRequest } from "@/lib/ask/request";
import { AiError } from "@/lib/ai/errors";
import { EmbeddingError } from "@/lib/ai/embeddings";
import type { ChunkHit } from "@/lib/rag/vectorSearch";
import { createAssistantToken } from "@/lib/tenant/assistantToken";
import { kbInput, makeTenant } from "./helpers";

const ORIGIN = "https://widget.example.com";

const fake = (...responses: string[]) => new FakeListChatModel({ responses });
const failing = (): BaseChatModel =>
  ({ invoke: async () => { throw new Error("upstream 500"); } }) as unknown as BaseChatModel;

const hit = (documentName: string, pageNumber: number, text: string, score = 0.9): ChunkHit => ({
  _id: new Types.ObjectId(),
  knowledgeBaseId: new Types.ObjectId(),
  documentName,
  pageNumber,
  chunkIndex: 0,
  text,
  score,
});

const ELIGIBILITY_JSON = JSON.stringify({
  intent: "eligibility",
  parameters: { gpa: 3.4, year: 2, category: "scholarship" },
  confidence: 0.95,
});

async function setup() {
  const a = await makeTenant("org-a");
  const { rawToken } = await createAssistantToken(a.ctx, { name: "Widget", allowedOrigins: [ORIGIN] });
  return { a, rawToken };
}

function deps(overrides: Partial<AskDeps>): AskDeps {
  return { ...defaultDeps, retrieve: async () => [], decomposerModel: () => fake(ELIGIBILITY_JSON), synthesizerModel: () => fake("unused"), ...overrides };
}

describe("Decomposer (LLM #1)", () => {
  it("parses valid JSON", async () => {
    const out = await decompose("I'm a sophomore with a 3.4 GPA. Do I qualify for the scholarship?", fake(ELIGIBILITY_JSON));
    expect(out).toMatchObject({ source: "llm", decomposition: { intent: "eligibility", parameters: { gpa: 3.4, year: 2, category: "scholarship" } } });
  });

  it("accepts fenced JSON and numeric strings", async () => {
    const out = await decompose("q", fake('```json\n{"intent":"eligibility","parameters":{"gpa":"3.8","year":"3"},"confidence":0.9}\n```'));
    expect(out.decomposition.parameters).toEqual({ gpa: 3.8, year: 3, category: null });
  });

  it("repairs invalid output with one retry", async () => {
    const out = await decompose("q", fake("Sure! The intent is eligibility.", '{"intent":"policy_choice","parameters":{"category":"housing"},"confidence":0.8}'));
    expect(out).toMatchObject({ source: "llm_retry", decomposition: { intent: "policy_choice", parameters: { category: "housing" } } });
  });

  it("falls back deterministically after two invalid outputs", async () => {
    const out = await decompose("q", fake('{"intent":"banana"}', "not json"));
    expect(out).toMatchObject({ source: "fallback", decomposition: { intent: "general_knowledge", parameters: { gpa: null, year: null, category: null } } });
  });

  it("wraps provider failures as a decomposer AiError", async () => {
    await expect(decompose("q", failing())).rejects.toMatchObject({ name: "AiError", stage: "decomposer", status: 502 });
  });

  it("extractJson rejects text without an object", () => {
    expect(() => extractJson("nothing here")).toThrow();
  });
});

describe("grounding check", () => {
  const chunks = [
    { knowledgeBaseId: "kb1", documentName: "Handbook.pdf", pageNumber: 4, text: "x", score: 0.9 },
  ];

  it("keeps real citations and strips fabricated ones", () => {
    const r = verifyCitations(
      "Leave is 20 days [Handbook.pdf - Page 4]. Parking is free [Parking.pdf - Page 1]. You are eligible [System 1: checkEligibility].",
      chunks,
      [{ model: "checkEligibility", status: "decided", eligible: true, inputs: { gpa: 3.4, year: 2 }, reasons: [], rule: "" }],
    );
    expect(r.citations).toEqual([{ documentName: "Handbook.pdf", pageNumber: 4, knowledgeBaseId: "kb1" }]);
    expect(r.invalidCitations).toEqual(["[Parking.pdf - Page 1]"]);
    expect(r.answer).not.toContain("Parking.pdf");
    expect(r.usedSystem1).toEqual(["checkEligibility"]);
    expect(r.grounded).toBe(false);
  });

  it("rejects a citation to the right document but wrong page", () => {
    expect(verifyCitations("Fact [Handbook.pdf - Page 9].", chunks, []).invalidCitations).toHaveLength(1);
  });

  it("rejects System 1 tags for models that didn't run", () => {
    expect(verifyCitations("Routed [System 1: routePolicy].", chunks, []).grounded).toBe(false);
  });

  it("treats the explicit not-found reply as grounded", () => {
    expect(verifyCitations(NOT_FOUND_MESSAGE, [], [])).toMatchObject({ grounded: true, notFound: true });
  });

  it("flags an uncited answer as ungrounded", () => {
    expect(verifyCitations("The sky is blue.", chunks, []).grounded).toBe(false);
  });
});

describe("request parsing", () => {
  it("takes the token from the Authorization header, then the body", () => {
    const h = new Headers({ authorization: "Bearer ka_live_header", origin: ORIGIN });
    expect(parseAskRequest(h, { question: "What is the leave policy?", token: "ka_live_body" }).token).toBe("ka_live_header");
    expect(parseAskRequest(new Headers(), { question: "What is the leave policy?", token: "ka_live_body" }).token).toBe("ka_live_body");
  });

  it("rejects missing token and missing/short question", () => {
    expect(() => parseAskRequest(new Headers(), { question: "What is the leave policy?" })).toThrow(/token is required/);
    expect(() => parseAskRequest(new Headers({ authorization: "Bearer x" }), {})).toThrow();
    expect(() => parseAskRequest(new Headers({ authorization: "Bearer x" }), { question: " a " })).toThrow();
  });
});

describe("answerQuestion pipeline", () => {
  afterEach(() => vi.restoreAllMocks());

  it("runs Token → Retrieval ∥ Decomposer → System 1 → Synthesizer → Grounding", async () => {
    const { a, rawToken } = await setup();
    const retrieve = vi.fn<AskDeps["retrieve"]>(async () => [
      hit("Scholarship Guide.pdf", 3, "The merit scholarship pays $2,000 per semester."),
      hit("Unrelated.pdf", 1, "Noise", 0.2),
    ]);
    const synth = fake(
      "Based on the rules engine, you are eligible [System 1: checkEligibility]. The merit scholarship pays $2,000 per semester [Scholarship Guide.pdf - Page 3].",
    );
    const synthSpy = vi.spyOn(synth, "invoke");

    const res = await answerQuestion(
      { token: rawToken, origin: ORIGIN, question: "I'm a sophomore with a 3.4 GPA, am I eligible for the scholarship?" },
      deps({ retrieve, synthesizerModel: () => synth }),
    );

    // Token resolved to org A, which is what retrieval was scoped to.
    expect(retrieve.mock.calls[0][0].organizationId.toString()).toBe(a.org._id.toString());

    // System 1 ran on the Decomposer's JSON alone.
    expect(res.decomposition.decomposition.intent).toBe("eligibility");
    expect(res.system1).toMatchObject([
      { model: "checkEligibility", status: "decided", eligible: true },
      { model: "routePolicy", status: "routed", track: "financial_aid" },
    ]);

    // Synthesizer received the decisions and only the relevant chunk.
    const prompt = (synthSpy.mock.calls[0][0] as BaseMessage[]).map((m) => String(m.content)).join("\n");
    expect(prompt).toContain("[System 1: checkEligibility]");
    expect(prompt).toContain('"eligible": true');
    expect(prompt).toContain("[Scholarship Guide.pdf - Page 3]");
    expect(prompt).not.toContain("Unrelated.pdf");
    expect(prompt).toContain(NOT_FOUND_MESSAGE);

    expect(res.grounded).toBe(true);
    expect(res.citations).toEqual([expect.objectContaining({ documentName: "Scholarship Guide.pdf", pageNumber: 3 })]);
    // Retrieval and Decomposer run in parallel, so only their relative position is fixed.
    const stages = res.trace.map((t) => t.stage);
    expect(stages[0]).toBe("token");
    expect(stages.slice(1, 3).sort()).toEqual(["decomposer", "retrieval"]);
    expect(stages.slice(3)).toEqual(["system1", "synthesizer", "grounding"]);
    expect(res.trace.find((t) => t.stage === "retrieval")?.detail).toBe("1 of 2 chunks above 0.6");
  });

  it("answers 'not in the knowledge base' without calling the Synthesizer when nothing is relevant", async () => {
    const { rawToken } = await setup();
    const synthesizerModel = vi.fn(() => fake("should not be used"));
    const res = await answerQuestion(
      { token: rawToken, origin: ORIGIN, question: "What is the capital of France?" },
      deps({
        retrieve: async () => [hit("Handbook.pdf", 1, "Unrelated", 0.3)],
        decomposerModel: () => fake('{"intent":"general_knowledge","parameters":{},"confidence":0.9}'),
        synthesizerModel,
      }),
    );
    expect(res.answer).toBe(NOT_FOUND_MESSAGE);
    expect(res.grounded).toBe(true);
    expect(synthesizerModel).not.toHaveBeenCalled();
    expect(res.trace.find((t) => t.stage === "synthesizer")).toMatchObject({ status: "skipped" });
  });

  it("asks for missing eligibility inputs deterministically", async () => {
    const { rawToken } = await setup();
    const res = await answerQuestion(
      { token: rawToken, origin: ORIGIN, question: "Am I eligible for the honours program?" },
      deps({ decomposerModel: () => fake('{"intent":"eligibility","parameters":{},"confidence":0.9}') }),
    );
    expect(res.answer).toBe(`${NOT_FOUND_MESSAGE} To check eligibility, please provide your gpa and year.`);
  });

  it("still synthesizes from a System 1 decision when no chunks are relevant", async () => {
    const { rawToken } = await setup();
    const synth = fake("You are not eligible according to the rules engine [System 1: checkEligibility].");
    const res = await answerQuestion(
      { token: rawToken, origin: ORIGIN, question: "Freshman with 3.9 GPA, eligible?" },
      deps({
        decomposerModel: () => fake('{"intent":"eligibility","parameters":{"gpa":3.9,"year":1},"confidence":1}'),
        synthesizerModel: () => synth,
      }),
    );
    expect(res.system1[0]).toMatchObject({ eligible: false });
    expect(res.grounded).toBe(true);
  });

  it("strips fabricated citations and reports the answer as ungrounded", async () => {
    const { rawToken } = await setup();
    const res = await answerQuestion(
      { token: rawToken, origin: ORIGIN, question: "What is the leave policy?" },
      deps({
        retrieve: async () => [hit("Handbook.pdf", 2, "Employees get 20 days of leave.")],
        decomposerModel: () => fake('{"intent":"general_knowledge","parameters":{},"confidence":1}'),
        synthesizerModel: () => fake("You get 20 days [Handbook.pdf - Page 2], plus 5 sick days [Benefits.pdf - Page 7]."),
      }),
    );
    expect(res.grounded).toBe(false);
    expect(res.invalidCitations).toEqual(["[Benefits.pdf - Page 7]"]);
    expect(res.answer).not.toContain("Benefits.pdf");
    expect(res.trace.find((t) => t.stage === "grounding")?.detail).toContain("removed 1");
  });

  it("records a decomposer fallback in the trace and still answers", async () => {
    const { rawToken } = await setup();
    const res = await answerQuestion(
      { token: rawToken, origin: ORIGIN, question: "Tell me about housing" },
      deps({
        retrieve: async () => [hit("Housing.pdf", 1, "Dorms open in August.")],
        decomposerModel: () => fake("garbage", "still garbage"),
        synthesizerModel: () => fake("Dorms open in August [Housing.pdf - Page 1]."),
      }),
    );
    expect(res.decomposition.source).toBe("fallback");
    expect(res.trace.find((t) => t.stage === "decomposer")).toMatchObject({ status: "fallback" });
    expect(res.grounded).toBe(true);
  });

  it.each([
    ["decomposer", { decomposerModel: failing }, 502],
    ["synthesizer", { retrieve: async () => [hit("A.pdf", 1, "text")], synthesizerModel: failing }, 502],
    ["retrieval", { retrieve: async () => { throw new Error("$vectorSearch index not found"); } }, 503],
    ["retrieval", { retrieve: async () => { throw new EmbeddingError("rate limited", 429); } }, 502],
  ] as const)("tags %s failures with their stage", async (stage, override, status) => {
    const { rawToken } = await setup();
    const err = await answerQuestion({ token: rawToken, origin: ORIGIN, question: "Anything at all?" }, deps(override as Partial<AskDeps>)).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err).toMatchObject({ stage, status });
  });
});

describe("token validation and tenant isolation", () => {
  it.each([
    ["malformed", "nope", ORIGIN, 401],
    ["unknown", `ka_live_${"A".repeat(43)}`, ORIGIN, 401],
  ])("rejects a %s token with %s", async (_n, token, origin, status) => {
    await setup();
    const retrieve = vi.fn();
    await expect(answerQuestion({ token, origin, question: "Anything?" }, deps({ retrieve }))).rejects.toMatchObject({ status, code: "invalid_token" });
    expect(retrieve).not.toHaveBeenCalled();
  });

  it("rejects a disallowed origin before any AI call", async () => {
    const { rawToken } = await setup();
    const decomposerModel = vi.fn(() => fake(ELIGIBILITY_JSON));
    await expect(
      answerQuestion({ token: rawToken, origin: "https://evil.example.com", question: "Anything?" }, deps({ decomposerModel })),
    ).rejects.toMatchObject({ status: 403, code: "origin_not_allowed" });
    expect(decomposerModel).not.toHaveBeenCalled();
  });

  it("rejects revoked tokens", async () => {
    const { a, rawToken } = await setup();
    await a.r.assistantTokens.updateMany({}, { $set: { revokedAt: new Date() } });
    await expect(answerQuestion({ token: rawToken, origin: ORIGIN, question: "Anything?" }, deps({}))).rejects.toMatchObject({
      status: 401,
      message: "This assistant token has been revoked.",
    });
  });

  it("scopes each token to its own organization and knowledge-base allow-list", async () => {
    const a = await makeTenant("org-a");
    const b = await makeTenant("org-b");
    const kb = await b.r.knowledgeBases.create(kbInput(b.ctx, "b-doc"));
    const { rawToken: tokenA } = await createAssistantToken(a.ctx, { name: "A", allowedOrigins: [ORIGIN] });
    const { rawToken: tokenB } = await createAssistantToken(b.ctx, {
      name: "B",
      allowedOrigins: [ORIGIN],
      knowledgeBaseIds: [kb._id.toString()],
    });

    const seen: Array<{ org: string; kbs: string[] }> = [];
    const retrieve: AskDeps["retrieve"] = async (ctx) => {
      seen.push({ org: ctx.organizationId.toString(), kbs: ctx.principal.knowledgeBaseIds.map(String) });
      return [];
    };
    const d = deps({ retrieve, decomposerModel: () => fake('{"intent":"general_knowledge","parameters":{},"confidence":1}') });
    await answerQuestion({ token: tokenA, origin: ORIGIN, question: "Question one?" }, d);
    await answerQuestion({ token: tokenB, origin: ORIGIN, question: "Question two?" }, d);

    expect(seen).toEqual([
      { org: a.org._id.toString(), kbs: [] },
      { org: b.org._id.toString(), kbs: [kb._id.toString()] },
    ]);
  });
});

describe("chat model config (AI_PROVIDER)", () => {
  const KEYS = ["AI_PROVIDER", "CHAT_MODEL", "AI_BASE_URL"];
  let saved: Record<string, string | undefined>;
  beforeEach(() => {
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    KEYS.forEach((k) => delete process.env[k]);
  });
  afterEach(() => KEYS.forEach((k) => (saved[k] === undefined ? delete process.env[k] : (process.env[k] = saved[k]))));

  it("Groq uses its OpenAI-compatible endpoint", () => {
    process.env.AI_PROVIDER = "Groq";
    expect(getChatConfig()).toEqual({ provider: "groq", baseUrl: "https://api.groq.com/openai/v1", model: "llama-3.3-70b-versatile" });
  });

  it("OpenAI uses the default endpoint; CHAT_MODEL overrides the model", () => {
    process.env.AI_PROVIDER = "OpenAI";
    process.env.CHAT_MODEL = "gpt-4.1-mini";
    expect(getChatConfig()).toEqual({ provider: "openai", baseUrl: "https://api.openai.com/v1", model: "gpt-4.1-mini" });
  });
});
