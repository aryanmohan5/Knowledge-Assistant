"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";

type TokenItem = {
  _id: string;
  name: string;
  tokenPrefix: string;
  allowedOrigins: string[];
  revokedAt: string | null;
  expiresAt?: string;
  lastUsedAt?: string;
  createdAt: string;
};

async function message(res: Response): Promise<string> {
  const body = (await res.json().catch(() => ({}))) as { message?: string; issues?: Array<{ message: string }> };
  return body.issues?.[0]?.message ?? body.message ?? `Request failed (${res.status}).`;
}

/** Create, list and revoke assistant tokens (owner/admin). */
export function TokensPanel({ onCreated }: { onCreated: (rawToken: string) => void }) {
  const [items, setItems] = useState<TokenItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [defaultOrigin, setDefaultOrigin] = useState("");

  const load = useCallback(async () => {
    const res = await fetch("/api/assistant-tokens", { cache: "no-store" });
    if (!res.ok) return setError(await message(res));
    setItems(((await res.json()) as { items: TokenItem[] }).items);
  }, []);

  useEffect(() => {
    setDefaultOrigin(window.location.origin);
    void load();
  }, [load]);

  async function onCreate(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const formEl = e.currentTarget;
    const form = new FormData(formEl);
    setError(null);
    setCreated(null);
    setBusy(true);
    const res = await fetch("/api/assistant-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: form.get("name"),
        allowedOrigins: String(form.get("origins") ?? "")
          .split(/[\s,]+/)
          .filter(Boolean),
      }),
    });
    setBusy(false);
    if (!res.ok) return setError(await message(res));
    const { rawToken } = (await res.json()) as { rawToken: string };
    setCreated(rawToken);
    setCopied(false);
    onCreated(rawToken);
    formEl.reset();
    await load();
  }

  async function onRevoke(t: TokenItem) {
    if (!confirm(`Revoke "${t.name}"? Sites using it will stop working immediately.`)) return;
    const res = await fetch(`/api/assistant-tokens/${t._id}`, { method: "DELETE" });
    if (!res.ok) return setError(await message(res));
    await load();
  }

  return (
    <section className="mt-8 rounded-xl border border-border bg-surface p-5">
      <h2 className="font-semibold">Assistant tokens</h2>
      <p className="mt-1 text-sm text-muted">
        A token lets a website call <code className="font-mono">/api/ask</code> for your organization, from the origins you list.
      </p>

      <form onSubmit={onCreate} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="sm:w-48">
          <span className="text-sm font-medium">Name</span>
          <input name="name" required maxLength={100} placeholder="Website widget" className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm outline-none focus:border-accent" />
        </label>
        <label className="flex-1">
          <span className="text-sm font-medium">Allowed origins</span>
          <input
            name="origins"
            required
            key={defaultOrigin}
            defaultValue={defaultOrigin}
            placeholder="https://www.example.com"
            className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-sm outline-none focus:border-accent"
          />
        </label>
        <button type="submit" disabled={busy} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50">
          {busy ? "Creating…" : "Create token"}
        </button>
      </form>
      <p className="mt-1 text-xs text-muted">Separate several origins with spaces or commas. Keep this page&apos;s origin to use the tester below.</p>

      {created && (
        <div className="mt-4 rounded-md border border-accent/40 bg-accent/5 p-3 text-sm">
          <p className="font-medium">Copy this token now. It won&apos;t be shown again.</p>
          <div className="mt-2 flex items-center gap-2">
            <code className="flex-1 overflow-x-auto rounded bg-background px-2 py-1 font-mono text-xs">{created}</code>
            <button
              onClick={async () => {
                await navigator.clipboard.writeText(created);
                setCopied(true);
              }}
              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-background"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}

      {items && items.length > 0 && (
        <ul className="mt-4 divide-y divide-border rounded-md border border-border">
          {items.map((t) => (
            <li key={t._id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <div>
                <span className="font-medium">{t.name}</span>{" "}
                <code className="font-mono text-xs text-muted">{t.tokenPrefix}…</code>
                <div className="text-xs text-muted">
                  {t.allowedOrigins.join(", ")} · {t.lastUsedAt ? `last used ${new Date(t.lastUsedAt).toLocaleString()}` : "never used"}
                </div>
              </div>
              {t.revokedAt ? (
                <span className="text-xs text-muted">Revoked</span>
              ) : (
                <button onClick={() => onRevoke(t)} className="text-sm text-danger hover:underline">Revoke</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
