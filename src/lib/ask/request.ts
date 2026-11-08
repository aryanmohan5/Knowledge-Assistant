import { z } from "zod";
import { HttpError } from "@/lib/http/errors";

export const askBodySchema = z.object({
  question: z
    .string({ error: "question is required" })
    .trim()
    .min(3, "question must be at least 3 characters")
    .max(2000, "question must be at most 2000 characters"),
  token: z.string().trim().optional(),
  knowledgeBaseIds: z.array(z.string().regex(/^[a-f0-9]{24}$/i, "invalid knowledge base id")).max(50).optional(),
});

export type AskInput = {
  token: string;
  origin: string | null;
  question: string;
  knowledgeBaseIds?: string[];
  /** Origins trusted in addition to the token's allow-list (the app's own origin). */
  trustedOrigins?: string[];
};

/**
 * Pulls the assistant token (Authorization: Bearer, or `token` in the body),
 * the caller's Origin, and the validated question out of a request.
 */
export function parseAskRequest(headers: Headers, body: unknown): AskInput {
  const parsed = askBodySchema.parse(body ?? {});
  const auth = headers.get("authorization");
  const bearer = auth?.match(/^Bearer\s+(\S+)$/i)?.[1];
  const token = bearer ?? parsed.token;
  if (!token) {
    throw new HttpError(401, "invalid_token", "An assistant token is required (Authorization: Bearer <token>).");
  }
  return {
    token,
    origin: headers.get("origin"),
    question: parsed.question,
    knowledgeBaseIds: parsed.knowledgeBaseIds,
  };
}
