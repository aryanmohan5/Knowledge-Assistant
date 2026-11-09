import { PDFDocument, StandardFonts } from "pdf-lib";
import { vi } from "vitest";

/** Builds a real PDF with one text block per page. */
export async function makePdf(pages: string[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (const text of pages) {
    const page = doc.addPage([612, 792]);
    const words = text.split(" ");
    let line = "";
    let y = 750;
    for (const word of words) {
      if ((line + " " + word).length > 90) {
        page.drawText(line, { x: 40, y, size: 10, font });
        y -= 14;
        line = word;
      } else {
        line = line ? `${line} ${word}` : word;
      }
    }
    if (line) page.drawText(line, { x: 40, y, size: 10, font });
  }
  return doc.save();
}

export function pdfFile(bytes: Uint8Array, name = "doc.pdf"): File {
  return new File([bytes as BlobPart], name, { type: "application/pdf" });
}

export function uploadForm(file: File, title?: string): FormData {
  const form = new FormData();
  form.set("file", file);
  if (title) form.set("title", title);
  return form;
}

/** Deterministic fake vector so tests can tell chunks apart. */
export function fakeVector(text: string, dims: number): number[] {
  const v = new Array(dims).fill(0).map((_, i) => ((text.charCodeAt(i % text.length) || 1) % 97) / 97 + 0.01);
  return v;
}

/** Stubs fetch with an OpenAI-compatible /embeddings endpoint. */
export function mockEmbeddingsApi(dims: number, status = 200) {
  const fn = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
    if (status !== 200) return new Response(JSON.stringify({ error: { message: "nope" } }), { status });
    const body = JSON.parse(String(init?.body)) as { input: string[] };
    return Response.json({
      data: body.input.map((t, index) => ({ index, embedding: fakeVector(t, dims) })),
    });
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}
