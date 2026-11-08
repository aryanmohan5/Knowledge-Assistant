/**
 * Mandatory per-tenant upload limits. Shared by the server (authoritative)
 * and the dashboard (early feedback only).
 */
export const MAX_DOCUMENTS_PER_ORG = 10;
export const MAX_PAGES_PER_PDF = 20;
export const MAX_PDF_BYTES = 10 * 1024 * 1024;

/** Headroom for multipart boundaries and the optional title field. */
export const MAX_UPLOAD_REQUEST_BYTES = MAX_PDF_BYTES + 64 * 1024;

/** Guards against pathological PDFs (e.g. microscopic text) driving embedding cost. */
export const MAX_CHUNKS_PER_PDF = 400;

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  const mb = bytes / (1024 * 1024);
  // Whole numbers for limits ("10 MB"); two decimals otherwise so 10.0001 MB doesn't read as "10.0 MB".
  return Number.isInteger(mb) ? `${mb} MB` : `${mb.toFixed(2)} MB`;
}
