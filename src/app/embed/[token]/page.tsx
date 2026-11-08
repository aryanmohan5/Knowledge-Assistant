import type { Metadata } from "next";
import { getEmbedTarget, type EmbedFailure } from "@/lib/tenant/embed";
import { connectToDatabase } from "@/lib/db/connect";
import { EmbedChat } from "./EmbedChat";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Assistant",
  robots: { index: false, follow: false },
};

const REASONS: Record<EmbedFailure | "error", string> = {
  malformed: "This assistant link is not valid.",
  not_found: "This assistant link is not valid.",
  revoked: "This assistant has been turned off by its owner.",
  expired: "This assistant link has expired.",
  org_inactive: "This assistant is currently unavailable.",
  error: "The assistant could not be loaded. Please try again later.",
};

/** Public, account-free chat page meant to be embedded in an iframe. */
export default async function EmbedPage({ params }: { params: Promise<{ token: string }> }) {
  const token = decodeURIComponent((await params).token);

  let target: Awaited<ReturnType<typeof getEmbedTarget>> | { ok: false; reason: "error" };
  try {
    await connectToDatabase();
    target = await getEmbedTarget(token);
  } catch (err) {
    console.error("[embed] failed to load assistant", err);
    target = { ok: false, reason: "error" };
  }

  if (!target.ok) {
    return (
      <main className="flex h-dvh items-center justify-center bg-background p-6">
        <div role="alert" className="max-w-xs text-center">
          <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-border text-lg text-muted">!</div>
          <h1 className="font-semibold">Assistant unavailable</h1>
          <p className="mt-1 text-sm text-muted">{REASONS[target.reason]}</p>
        </div>
      </main>
    );
  }

  return <EmbedChat token={token} organizationName={target.organizationName} />;
}
