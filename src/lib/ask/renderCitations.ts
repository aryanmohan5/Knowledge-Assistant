export type AnswerSegment =
  | { type: "text"; text: string }
  | { type: "source"; documentName: string; pageNumber: number }
  | { type: "decision"; model: string };

const TAG = /\[(?:System 1:\s*([A-Za-z]+)|([^[\]\n]+?)\s+-\s+Page\s+(\d+))\]/g;

/**
 * Splits an answer into text and citation segments so a UI can render the
 * `[Doc.pdf - Page N]` and `[System 1: model]` tags as chips. Pure; safe to
 * use on the client.
 */
export function splitAnswer(answer: string): AnswerSegment[] {
  const out: AnswerSegment[] = [];
  let last = 0;
  for (const m of answer.matchAll(TAG)) {
    if (m.index > last) out.push({ type: "text", text: answer.slice(last, m.index) });
    if (m[1]) out.push({ type: "decision", model: m[1] });
    else out.push({ type: "source", documentName: m[2].trim(), pageNumber: Number(m[3]) });
    last = m.index + m[0].length;
  }
  if (last < answer.length) out.push({ type: "text", text: answer.slice(last) });
  return out;
}
