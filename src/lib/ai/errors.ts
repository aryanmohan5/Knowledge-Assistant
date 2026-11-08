/** Which pipeline stage an AI failure came from, so the API can say so. */
export type AiStage = "decomposer" | "synthesizer" | "retrieval";

/** Failure in an AI-backed stage. `message` is safe to show; `cause` is for logs only. */
export class AiError extends Error {
  constructor(
    public readonly stage: AiStage,
    message: string,
    public readonly status: 502 | 503 = 502,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "AiError";
  }
}
