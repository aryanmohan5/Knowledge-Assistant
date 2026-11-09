import type { System1Result } from "./system1";

export const NOT_FOUND_MESSAGE = "The knowledge base does not contain information to answer this question.";

export type SourceChunk = {
  knowledgeBaseId: string;
  documentName: string;
  pageNumber: number;
  text: string;
  score: number;
};

export type Citation = { documentName: string; pageNumber: number; knowledgeBaseId: string };

/** The exact tag the Synthesizer must copy: `[Name.pdf - Page 3]`. */
export function sourceTag(c: { documentName: string; pageNumber: number }): string {
  return `[${c.documentName} - Page ${c.pageNumber}]`;
}

export function system1Tag(r: System1Result): string {
  return `[System 1: ${r.model}]`;
}

const DOC_TAG = /\[([^[\]\n]+?)\s+-\s+Page\s+(\d+)\]/gi;
const SYS_TAG = /\[System 1:\s*([A-Za-z]+)\]/gi;

const norm = (s: string) => s.trim().replace(/\s+/g, " ").toLowerCase();

export type GroundingReport = {
  /** The answer with any fabricated citation tags removed. */
  answer: string;
  citations: Citation[];
  invalidCitations: string[];
  usedSystem1: string[];
  notFound: boolean;
  /** True when every tag is real and the answer is either cited or the explicit not-found reply. */
  grounded: boolean;
};

/**
 * Deterministic check on the Synthesizer's output: every citation tag must
 * match a chunk that was actually retrieved (document name + page) or a
 * System 1 model that actually ran. Fabricated tags are stripped and reported.
 */
export function verifyCitations(answer: string, chunks: SourceChunk[], system1: System1Result[]): GroundingReport {
  const byKey = new Map(chunks.map((c) => [`${norm(c.documentName)}#${c.pageNumber}`, c]));
  const ranModels = new Set(system1.map((r) => r.model.toLowerCase()));

  const citations = new Map<string, Citation>();
  const invalid: string[] = [];
  const usedSystem1 = new Set<string>();

  let cleaned = answer.replace(DOC_TAG, (tag, name: string, page: string) => {
    const hit = byKey.get(`${norm(name)}#${Number(page)}`);
    if (!hit) {
      invalid.push(tag);
      return "";
    }
    citations.set(`${hit.knowledgeBaseId}#${hit.pageNumber}`, {
      documentName: hit.documentName,
      pageNumber: hit.pageNumber,
      knowledgeBaseId: hit.knowledgeBaseId,
    });
    return sourceTag(hit);
  });

  cleaned = cleaned.replace(SYS_TAG, (tag, model: string) => {
    if (!ranModels.has(model.toLowerCase())) {
      invalid.push(tag);
      return "";
    }
    usedSystem1.add(model);
    return tag;
  });

  cleaned = cleaned.replace(/[ \t]+([.,;:])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
  const notFound = norm(cleaned).includes(norm(NOT_FOUND_MESSAGE));
  const hasAnySource = citations.size > 0 || usedSystem1.size > 0;

  return {
    answer: cleaned,
    citations: [...citations.values()],
    invalidCitations: invalid,
    usedSystem1: [...usedSystem1],
    notFound,
    grounded: invalid.length === 0 && (hasAnySource || notFound),
  };
}
