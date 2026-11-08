import { after, NextResponse } from "next/server";
import { withApi } from "@/lib/http/handler";
import { readMultipartWithLimit } from "@/lib/http/upload";
import { MAX_PDF_BYTES, MAX_UPLOAD_REQUEST_BYTES } from "@/lib/limits";
import { ingestChunks, listKnowledgeBases, registerUpload } from "@/lib/services/knowledgeBase";
import { requireTenant } from "@/lib/tenant/context";

export const runtime = "nodejs";
// Embedding runs in after(); give it room on serverless hosts.
export const maxDuration = 60;

export const GET = withApi(async () => {
  const ctx = await requireTenant();
  return NextResponse.json(await listKnowledgeBases(ctx));
});

/**
 * Multipart upload: `file` (PDF, required) and `title` (optional).
 * Limits are enforced before any processing; the response is 202 with the
 * document in `processing` state, and embedding continues in the background.
 */
export const POST = withApi(async (req) => {
  const ctx = await requireTenant();
  const form = await readMultipartWithLimit(req, MAX_UPLOAD_REQUEST_BYTES, MAX_PDF_BYTES);
  const upload = await registerUpload(ctx, form);
  after(() => ingestChunks(ctx, upload));
  return NextResponse.json(upload.knowledgeBase, { status: 202 });
});
