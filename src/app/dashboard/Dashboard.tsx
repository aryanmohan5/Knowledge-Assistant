"use client";

import { useRouter } from "next/navigation";
import { signOut } from "next-auth/react";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { formatBytes, MAX_DOCUMENTS_PER_ORG, MAX_PAGES_PER_PDF, MAX_PDF_BYTES } from "@/lib/limits";

type Status = "pending" | "processing" | "ready" | "failed";

type KnowledgeBaseItem = {
  _id: string;
  title: string;
  fileName: string;
  sizeBytes: number;
  pageCount: number;
  chunkCount: number;
  status: Status;
  error?: string;
  createdAt: string;
};

type Props = {
  user: { email: string; role: "owner" | "admin" | "member" };
  organization: { name: string; slug: string };
};

const POLL_MS = 3000;

async function apiError(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { message?: string };
  if (res.status === 403) return body.message ?? "You don't have permission to do that.";
  return body.message ?? `Request failed (${res.status}).`;
}

export function Dashboard({ user, organization }: Props) {
  const router = useRouter();
  const [items, setItems] = useState<KnowledgeBaseItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);
  const canDelete = user.role === "owner" || user.role === "admin";

  const load = useCallback(async () => {
    const res = await fetch("/api/knowledge-bases", { cache: "no-store" });
    if (res.status === 401) {
      router.push("/login");
      return;
    }
    if (!res.ok) {
      setError(await apiError(res));
      return;
    }
    const data = (await res.json()) as { items: KnowledgeBaseItem[] };
    setItems(data.items);
  }, [router]);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while anything is still being embedded.
  const busy = items?.some((i) => i.status === "pending" || i.status === "processing") ?? false;
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(t);
  }, [busy, load]);

  const count = items?.length ?? 0;
  const atLimit = count >= MAX_DOCUMENTS_PER_ORG;

  async function onUpload(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    const formEl = e.currentTarget; // currentTarget is null after the first await
    const form = new FormData(formEl);
    const file = form.get("file");
    if (!(file instanceof File) || file.size === 0) return setError("Choose a PDF to upload.");

    // Early feedback only; the server enforces every limit.
    if (!file.name.toLowerCase().endsWith(".pdf") && file.type !== "application/pdf") {
      return setError("Only PDF files can be uploaded.");
    }
    if (file.size > MAX_PDF_BYTES) {
      return setError(`"${file.name}" is ${formatBytes(file.size)}. PDFs can be at most ${formatBytes(MAX_PDF_BYTES)}.`);
    }
    if (atLimit) return setError(`You've reached the limit of ${MAX_DOCUMENTS_PER_ORG} documents.`);

    setUploading(true);
    const res = await fetch("/api/knowledge-bases", { method: "POST", body: form });
    setUploading(false);
    if (!res.ok) return setError(await apiError(res));

    formEl.reset();
    setNotice(`"${file.name}" uploaded. Processing usually takes under a minute.`);
    await load();
  }

  async function onDelete(item: KnowledgeBaseItem) {
    if (!confirm(`Delete "${item.title}"? Its content will no longer be used for answers.`)) return;
    setError(null);
    setNotice(null);
    setDeleting(item._id);
    const res = await fetch(`/api/knowledge-bases/${item._id}`, { method: "DELETE" });
    setDeleting(null);
    if (!res.ok) return setError(await apiError(res));
    setNotice(`Deleted "${item.title}".`);
    await load();
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">{organization.name}</h1>
          <p className="text-sm text-muted">
            {user.email} Â· {user.role}
          </p>
        </div>
        <button
          onClick={() => signOut({ callbackUrl: "/login" })}
          className="rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface"
        >
          Sign out
        </button>
      </header>

      <section className="mt-8 rounded-xl border border-border bg-surface p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-semibold">Upload a PDF</h2>
          <p className="text-sm text-muted">
            {count} of {MAX_DOCUMENTS_PER_ORG} documents Â· max {MAX_PAGES_PER_PDF} pages and{" "}
            {formatBytes(MAX_PDF_BYTES)} each
          </p>
        </div>
        <form onSubmit={onUpload} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex-1">
            <span className="text-sm font-medium">File</span>
            <input
              name="file"
              type="file"
              accept="application/pdf,.pdf"
              required
              disabled={atLimit || uploading}
              className="mt-1 block w-full text-sm file:mr-3 file:rounded-md file:border file:border-border file:bg-background file:px-3 file:py-1.5 file:text-sm"
            />
          </label>
          <label className="flex-1">
            <span className="text-sm font-medium">Title (optional)</span>
            <input
              name="title"
              maxLength={200}
              disabled={atLimit || uploading}
              placeholder="Defaults to the file name"
              className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-accent"
            />
          </label>
          <button
            type="submit"
            disabled={atLimit || uploading}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
          >
            {uploading ? "Uploadingâ€¦" : "Upload"}
          </button>
        </form>
        {atLimit && (
          <p className="mt-3 text-sm text-muted">Document limit reached. Delete a document to upload another.</p>
        )}
      </section>

      {error && (
        <p role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      {notice && <p className="mt-4 rounded-md border border-border bg-surface px-3 py-2 text-sm">{notice}</p>}

      <section className="mt-8">
        <h2 className="font-semibold">Documents</h2>
        {items === null ? (
          <p className="mt-4 text-sm text-muted">Loadingâ€¦</p>
        ) : items.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted">
            No documents yet. Upload a PDF to get started.
          </p>
        ) : (
          <div className="mt-4 overflow-x-auto rounded-xl border border-border bg-surface">
            <table className="w-full text-left text-sm">
              <thead className="border-b border-border text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">Document</th>
                  <th className="px-4 py-2 font-medium">Pages</th>
                  <th className="px-4 py-2 font-medium">Size</th>
                  <th className="px-4 py-2 font-medium">Chunks</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Uploaded</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {items.map((item) => (
                  <tr key={item._id} className="border-b border-border last:border-0 align-top">
                    <td className="px-4 py-3">
                      <div className="font-medium">{item.title}</div>
                      <div className="text-xs text-muted">{item.fileName}</div>
                    </td>
                    <td className="px-4 py-3 tabular-nums">{item.pageCount}</td>
                    <td className="px-4 py-3 tabular-nums">{formatBytes(item.sizeBytes)}</td>
                    <td className="px-4 py-3 tabular-nums">{item.status === "ready" ? item.chunkCount : "â€”"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={item.status} />
                      {item.status === "failed" && item.error && (
                        <div className="mt-1 max-w-xs text-xs text-danger">{item.error}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-muted">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {canDelete && (
                        <button
                          onClick={() => onDelete(item)}
                          disabled={deleting === item._id}
                          className="text-sm text-danger hover:underline disabled:opacity-50"
                        >
                          {deleting === item._id ? "Deletingâ€¦" : "Delete"}
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

const STATUS_STYLES: Record<Status, string> = {
  pending: "border-border text-muted",
  processing: "border-accent/40 text-accent",
  ready: "border-green-600/40 text-green-700 dark:text-green-400",
  failed: "border-danger/40 text-danger",
};

function StatusBadge({ status }: { status: Status }) {
  const label = status === "processing" ? "Processingâ€¦" : status[0].toUpperCase() + status.slice(1);
  return <span className={`inline-block rounded-full border px-2 py-0.5 text-xs ${STATUS_STYLES[status]}`}>{label}</span>;
}
