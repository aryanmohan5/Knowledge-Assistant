import { HttpError } from "./errors";
import { formatBytes } from "@/lib/limits";

/**
 * Reads a multipart body while enforcing a hard byte cap on the raw stream,
 * so an oversized (or lying Content-Length) upload is cut off before it is
 * buffered in memory.
 */
export async function readMultipartWithLimit(req: Request, maxBytes: number, fileLimitBytes: number): Promise<FormData> {
  const contentType = req.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data")) {
    throw new HttpError(415, "invalid_request", "Upload must be sent as multipart/form-data.");
  }

  const tooLarge = () =>
    new HttpError(413, "file_too_large", `PDFs can be at most ${formatBytes(fileLimitBytes)}.`);

  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  if (!req.body) throw new HttpError(400, "file_required", "Choose a PDF to upload.");

  const reader = req.body.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    parts.push(value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    body.set(p, offset);
    offset += p.byteLength;
  }

  try {
    return await new Response(body, { headers: { "content-type": contentType } }).formData();
  } catch {
    throw new HttpError(400, "invalid_request", "Malformed upload.");
  }
}
