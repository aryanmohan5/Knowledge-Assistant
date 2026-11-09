import { extractText, getDocumentProxy } from "unpdf";
import { HttpError } from "@/lib/http/errors";

export type PdfPage = { pageNumber: number; text: string };

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]; // "%PDF-"

/** Checks the file signature; browsers' reported MIME types are not trustworthy. */
export function isPdf(bytes: Uint8Array): boolean {
  // The header may be preceded by a little junk; the spec allows it within the first 1 KB.
  const head = bytes.subarray(0, 1024);
  for (let i = 0; i <= head.length - PDF_MAGIC.length; i++) {
    if (PDF_MAGIC.every((b, j) => head[i + j] === b)) return true;
  }
  return false;
}

/**
 * Opens a PDF. Callers check `numPages` against the page limit *before*
 * extracting any text.
 */
export async function openPdf(bytes: Uint8Array) {
  if (!isPdf(bytes)) {
    throw new HttpError(415, "unsupported_file_type", "Only PDF files can be uploaded.");
  }
  try {
    // pdf.js may transfer (detach) the buffer it is given, so hand it a copy.
    return await getDocumentProxy(bytes.slice());
  } catch (err) {
    if ((err as Error)?.name === "PasswordException") {
      throw new HttpError(422, "pdf_encrypted", "This PDF is password-protected. Remove the password and try again.");
    }
    throw new HttpError(422, "pdf_invalid", "This file could not be read as a PDF. It may be corrupted.");
  }
}

function normalize(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Per-page text, 1-based page numbers, so every chunk can cite its page. */
export async function extractPages(pdf: Awaited<ReturnType<typeof openPdf>>): Promise<PdfPage[]> {
  const { text } = await extractText(pdf, { mergePages: false });
  return text.map((t, i) => ({ pageNumber: i + 1, text: normalize(t) }));
}
