import type { PdfPage } from "./extract";

export type TextChunk = {
  chunkIndex: number;
  pageNumber: number;
  text: string;
  tokenCount: number;
};

export const DEFAULT_CHUNK_SIZE = 1200;
export const DEFAULT_CHUNK_OVERLAP = 200;

const SEPARATORS = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " "];

/** Finds the latest natural break in `window`, preferring paragraph > line > sentence > word. */
function lastBreak(window: string): number {
  for (const sep of SEPARATORS) {
    const idx = window.lastIndexOf(sep);
    if (idx !== -1) return idx + sep.length;
  }
  return -1;
}

/**
 * Splits text into windows of at most `size` characters, cut at natural
 * boundaries, with `overlap` characters of context carried into the next one.
 */
export function splitText(text: string, size = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP): string[] {
  if (overlap >= size) throw new Error("overlap must be smaller than size");
  const chunks: string[] = [];
  let start = 0;

  while (start < text.length) {
    let end = Math.min(start + size, text.length);
    if (end < text.length) {
      // Only look for a break in the second half so chunks don't get tiny.
      const minEnd = start + Math.floor(size / 2);
      const brk = lastBreak(text.slice(minEnd, end));
      if (brk !== -1) end = minEnd + brk;
    }

    const piece = text.slice(start, end).trim();
    if (piece) chunks.push(piece);
    if (end >= text.length) break;

    // Step back for overlap, then forward to a word start so chunks don't open mid-word.
    let next = Math.max(end - overlap, start + 1);
    const space = text.indexOf(" ", next);
    if (space !== -1 && space < end) next = space + 1;
    start = next;
  }

  return chunks;
}

/**
 * Chunks each page separately, so every chunk belongs to exactly one page and
 * can be cited as "document, p. N".
 */
export function chunkPages(pages: PdfPage[], size = DEFAULT_CHUNK_SIZE, overlap = DEFAULT_CHUNK_OVERLAP): TextChunk[] {
  const out: TextChunk[] = [];
  for (const page of pages) {
    for (const text of splitText(page.text, size, overlap)) {
      out.push({
        chunkIndex: out.length,
        pageNumber: page.pageNumber,
        text,
        tokenCount: Math.ceil(text.length / 4),
      });
    }
  }
  return out;
}
