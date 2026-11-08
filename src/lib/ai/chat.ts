import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatOpenAI } from "@langchain/openai";
import { getAiApiKey, getChatConfig } from "@/lib/env";

/**
 * LangChain chat model for the provider selected by AI_PROVIDER. Groq is
 * reached through its OpenAI-compatible endpoint, so one client class serves
 * both. Chat Completions is forced because Groq has no Responses API.
 */
export function createChatModel(
  opts: { temperature?: number; maxTokens?: number; json?: boolean } = {},
): BaseChatModel {
  const cfg = getChatConfig();
  return new ChatOpenAI({
    model: cfg.model,
    apiKey: getAiApiKey(cfg.provider),
    configuration: { baseURL: cfg.baseUrl },
    temperature: opts.temperature ?? 0,
    maxTokens: opts.maxTokens,
    timeout: 30_000,
    maxRetries: 2,
    useResponsesApi: false,
    // JSON mode is supported by both OpenAI and Groq; the output is still validated with zod.
    modelKwargs: opts.json ? { response_format: { type: "json_object" } } : undefined,
  });
}

/** Plain text from a LangChain message, whatever shape its content takes. */
export function messageText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (typeof part === "string" ? part : (part as { text?: string })?.text ?? ""))
      .join("");
  }
  return "";
}
