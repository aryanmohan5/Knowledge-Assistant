import { describe, expect, it } from "vitest";
import { chunkPages, splitText } from "@/lib/pdf/chunk";
import { extractPages, isPdf, openPdf } from "@/lib/pdf/extract";
import { makePdf } from "./pdfHelpers";

describe("PDF extraction", () => {
  it("extracts text per page with 1-based page numbers", async () => {
    const pdf = await openPdf(await makePdf(["Alpha page one text", "Beta page two text"]));
    expect(pdf.numPages).toBe(2);
    const pages = await extractPages(pdf);
    expect(pages.map((p) => p.pageNumber)).toEqual([1, 2]);
    expect(pages[0].text).toContain("Alpha page one");
    expect(pages[1].text).toContain("Beta page two");
  });

  it("rejects files that aren't PDFs, by content rather than name", async () => {
    expect(isPdf(new TextEncoder().encode("hello world"))).toBe(false);
    await expect(openPdf(new TextEncoder().encode("<html>not a pdf</html>"))).rejects.toMatchObject({
      status: 415,
      code: "unsupported_file_type",
    });
  });

  it("rejects a corrupt PDF with a clear error", async () => {
    await expect(openPdf(new TextEncoder().encode("%PDF-1.7\ngarbage"))).rejects.toMatchObject({ status: 422 });
  });
});

describe("chunking", () => {
  const words = Array.from({ length: 900 }, (_, i) => `word${i}`).join(" ");

  it("keeps chunks within size, overlaps them, and loses no text", () => {
    const chunks = splitText(words, 500, 100);
    expect(chunks.length).toBeGreaterThan(5);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(500);
    // Consecutive chunks share some context.
    const tail = chunks[0].split(" ").slice(-3).join(" ");
    expect(chunks[1]).toContain(tail.split(" ").pop());
    // Every word appears somewhere.
    const all = new Set(chunks.join(" ").split(" "));
    for (let i = 0; i < 900; i++) expect(all.has(`word${i}`)).toBe(true);
  });

  it("prefers paragraph and sentence boundaries", () => {
    const text = `${"First sentence here. ".repeat(20)}\n\n${"Second paragraph text. ".repeat(20)}`;
    const chunks = splitText(text, 600, 50);
    expect(chunks[0].endsWith(".")).toBe(true);
  });

  it("never lets a chunk span pages and numbers chunks globally", () => {
    const chunks = chunkPages(
      [
        { pageNumber: 1, text: words.slice(0, 3000) },
        { pageNumber: 2, text: "short page" },
        { pageNumber: 3, text: "" },
      ],
      1000,
      100,
    );
    expect(chunks.map((c) => c.chunkIndex)).toEqual(chunks.map((_, i) => i));
    expect(chunks.at(-1)).toMatchObject({ pageNumber: 2, text: "short page" });
    expect(chunks.some((c) => c.pageNumber === 3)).toBe(false);
  });
});
