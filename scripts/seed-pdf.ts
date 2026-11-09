import { PDFDocument, StandardFonts, type PDFFont } from "pdf-lib";
import type { SeedDocument } from "./seed-data";

// Fixed metadata so the same content always yields the same bytes (and checksum),
// which lets the upload endpoint recognise re-seeded files as duplicates.
const FIXED_DATE = new Date("2026-01-01T00:00:00Z");

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split("\n")) {
    if (!paragraph.trim()) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of paragraph.split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Renders one seed document: one PDF page per entry in `pages`, first line as heading. */
export async function buildPdf(doc: SeedDocument): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(doc.title);
  pdf.setAuthor("Knowledge Assistant seed");
  pdf.setProducer("pdf-lib");
  pdf.setCreator("scripts/seed.ts");
  pdf.setCreationDate(FIXED_DATE);
  pdf.setModificationDate(FIXED_DATE);
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  for (const text of doc.pages) {
    const page = pdf.addPage([612, 792]);
    const [heading, ...rest] = text.split("\n");
    let y = 740;
    page.drawText(heading, { x: 56, y, size: 14, font: bold });
    y -= 28;
    for (const line of wrap(rest.join("\n").trim(), font, 11, 500)) {
      if (y < 56) throw new Error(`"${doc.fileName}" has a page that is too long to fit`);
      if (line) page.drawText(line, { x: 56, y, size: 11, font });
      y -= 15;
    }
  }
  return pdf.save();
}
