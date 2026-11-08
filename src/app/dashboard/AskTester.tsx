"use client";

import { useState, type FormEvent } from "react";

type AskResponse = {
  answer: string;
  grounded: boolean;
  citations: Array<{ documentName: string; pageNumber: number }>;
  invalidCitations: string[];
  decomposition: { source: string; decomposition: { intent: string; parameters: Record<string, unknown>; confidence: number } };
  system1: Array<Record<string, unknown> & { model: string; status: string }>;
  sources: Array<{ documentName: string; pageNumber: number; score: number; excerpt: string }>;
  trace: Array<{ stage: string; status: string; ms: number; detail?: string }>;
};

const EXAMPLES = [
  "I'm a sophomore with a 3.4 GPA. Am I eligible for the scholarship?",
  "Which policy covers a plagiarism complaint?",
  "What does the handbook say about leave?",
];

/** Sends a question through /api/ask with an assistant token, exactly as an embedded widget would. */
export function AskTester({ token, onTokenChange }: { token: string; onTokenChange: (t: string) => void }) {
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onAsk(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setResult(null);
    setPending(true);
    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token.trim()}` },
        body: JSON.stringify({ question }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const issue = (body as { issues?: Array<{ message: string }> }).issues?.[0]?.message;
        const stage = (body as { stage?: string }).stage;
        setError(`${issue ?? (body as { message?: string }).message ?? `Request failed (${res.status})`}${stage ? ` [stage: ${stage}]` : ""}`);
      } else {
        setResult(body as AskResponse);
      }
    } catch {
      setError("Could not reach the server.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="mt-8 rounded-xl border border-border bg-surface p-5">
      <h2 className="font-semibold">Ask tester</h2>
      <p className="mt-1 text-sm text-muted">
        Calls <code className="font-mono">POST /api/ask</code> with a token: Decomposer (LLM) → System 1 rules → Synthesizer (LLM).
      </p>

      <form onSubmit={onAsk} className="mt-4 space-y-3">
        <label className="block">
          <span className="text-sm font-medium">Assistant token</span>
          <input
            value={token}
            onChange={(e) => onTokenChange(e.target.value)}
            required
            placeholder="ka_live_…"
            className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-1.5 font-mono text-sm outline-none focus:border-accent"
          />
        </label>
        <label className="block">
          <span className="text-sm font-medium">Question</span>
          <textarea
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            required
            minLength={3}
            maxLength={2000}
            rows={2}
            className="mt-1 block w-full rounded-md border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" disabled={pending || !token.trim()} className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50">
            {pending ? "Thinking…" : "Ask"}
          </button>
          {EXAMPLES.map((q) => (
            <button key={q} type="button" onClick={() => setQuestion(q)} className="rounded-full border border-border px-2.5 py-1 text-xs text-muted hover:bg-background">
              {q}
            </button>
          ))}
        </div>
      </form>

      {error && <p role="alert" className="mt-4 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>}

      {result && (
        <div className="mt-5 space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold">Answer</h3>
              <span
                className={`rounded-full border px-2 py-0.5 text-xs ${result.grounded ? "border-green-600/40 text-green-700 dark:text-green-400" : "border-danger/40 text-danger"}`}
              >
                {result.grounded ? "Grounded" : "Not fully grounded"}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap rounded-md border border-border bg-background p-3 text-sm leading-relaxed">{result.answer}</p>
            {result.citations.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {result.citations.map((c) => (
                  <span key={`${c.documentName}-${c.pageNumber}`} className="rounded-full border border-border px-2 py-0.5 text-xs">
                    {c.documentName} · p.{c.pageNumber}
                  </span>
                ))}
              </div>
            )}
            {result.invalidCitations.length > 0 && (
              <p className="mt-2 text-xs text-danger">Removed fabricated citations: {result.invalidCitations.join(", ")}</p>
            )}
          </div>

          <details className="rounded-md border border-border p-3 text-sm" open>
            <summary className="cursor-pointer font-semibold">Pipeline trace</summary>
            <ol className="mt-3 space-y-1 text-xs">
              {result.trace.map((t, i) => (
                <li key={i} className="flex gap-2 font-mono">
                  <span className="w-24 shrink-0">{t.stage}</span>
                  <span className={t.status === "ok" ? "text-muted" : "text-accent"}>{t.status}</span>
                  <span className="text-muted">{t.ms} ms</span>
                  {t.detail && <span className="text-muted">· {t.detail}</span>}
                </li>
              ))}
            </ol>

            <TraceBlock title={`1 · Decomposer (LLM): ${result.decomposition.source}`} value={result.decomposition.decomposition} />
            <TraceBlock title="2 · System 1 (deterministic code)" value={result.system1.length ? result.system1 : "No System 1 model applies to this intent."} />
            <div className="mt-3">
              <h4 className="text-xs font-semibold">3 · Retrieved context ({result.sources.length})</h4>
              {result.sources.length === 0 ? (
                <p className="mt-1 text-xs text-muted">No chunks above the relevance threshold.</p>
              ) : (
                <ul className="mt-1 space-y-1.5">
                  {result.sources.map((s, i) => (
                    <li key={i} className="rounded border border-border p-2 text-xs">
                      <span className="font-medium">[{s.documentName} - Page {s.pageNumber}]</span>{" "}
                      <span className="text-muted">score {s.score.toFixed(3)}</span>
                      <p className="mt-1 text-muted">{s.excerpt}…</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </details>
        </div>
      )}
    </section>
  );
}

function TraceBlock({ title, value }: { title: string; value: unknown }) {
  return (
    <div className="mt-3">
      <h4 className="text-xs font-semibold">{title}</h4>
      <pre className="mt-1 overflow-x-auto rounded bg-background p-2 font-mono text-xs">
        {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
      </pre>
    </div>
  );
}
