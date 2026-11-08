"use client";

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { splitAnswer } from "@/lib/ask/renderCitations";

type AskResult = {
  answer: string;
  grounded: boolean;
  notFound: boolean;
  citations: Array<{ documentName: string; pageNumber: number }>;
};

type ErrorKind = "unavailable" | "provider" | "search" | "invalid" | "network";

type Message =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "assistant"; question: string; state: "pending" }
  | { id: number; role: "assistant"; question: string; state: "done"; result: AskResult }
  | { id: number; role: "assistant"; question: string; state: "error"; kind: ErrorKind; message: string };

const TIMEOUT_MS = 60_000;

const ERROR_COPY: Record<ErrorKind, string> = {
  unavailable: "This assistant is no longer available.",
  provider: "The assistant is having trouble right now.",
  search: "Search is temporarily unavailable.",
  invalid: "",
  network: "Couldn't reach the assistant. Check your connection.",
};

async function ask(token: string, question: string): Promise<{ ok: true; result: AskResult } | { ok: false; kind: ErrorKind; message: string }> {
  try {
    const res = await fetch("/api/ask", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ question }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (res.ok) return { ok: true, result: body as unknown as AskResult };

    const message = (body.issues as Array<{ message: string }> | undefined)?.[0]?.message ?? (body.message as string | undefined) ?? "";
    if (res.status === 401 || res.status === 403) return { ok: false, kind: "unavailable", message: message || ERROR_COPY.unavailable };
    if (res.status === 400) return { ok: false, kind: "invalid", message: message || "Please rephrase your question." };
    if (res.status === 503) return { ok: false, kind: "search", message: ERROR_COPY.search };
    return { ok: false, kind: "provider", message: ERROR_COPY.provider };
  } catch {
    return { ok: false, kind: "network", message: ERROR_COPY.network };
  }
}

export function EmbedChat({ token, organizationName }: { token: string; organizationName: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");
  const [disabled, setDisabled] = useState(false);
  const nextId = useRef(1);
  const bottom = useRef<HTMLDivElement>(null);
  const busy = messages.some((m) => m.role === "assistant" && m.state === "pending");

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages]);

  async function run(question: string, replaceId?: number) {
    const id = replaceId ?? nextId.current++;
    setMessages((prev) => {
      const pending: Message = { id, role: "assistant", question, state: "pending" };
      return replaceId ? prev.map((m) => (m.id === replaceId ? pending : m)) : [...prev, pending];
    });

    const outcome = await ask(token, question);
    if (!outcome.ok && outcome.kind === "unavailable") setDisabled(true);
    setMessages((prev) =>
      prev.map((m): Message =>
        m.id !== id
          ? m
          : outcome.ok
            ? { id, role: "assistant", question, state: "done", result: outcome.result }
            : { id, role: "assistant", question, state: "error", kind: outcome.kind, message: outcome.message },
      ),
    );
  }

  function submit(e?: FormEvent) {
    e?.preventDefault();
    const q = draft.trim();
    if (!q || busy || disabled) return;
    if (q.length < 3) return;
    setDraft("");
    setMessages((prev) => [...prev, { id: nextId.current++, role: "user", text: q }]);
    void run(q);
  }

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  }

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex items-center gap-2 border-b border-border bg-surface px-4 py-3">
        <span className="h-2 w-2 rounded-full bg-accent" aria-hidden />
        <div className="min-w-0">
          <h1 className="truncate text-sm font-semibold">{organizationName} Assistant</h1>
          <p className="text-xs text-muted">Answers come from {organizationName}&apos;s documents</p>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
        {messages.length === 0 && (
          <div className="mt-6 text-center text-sm text-muted">
            <p>Ask a question about policies, scholarships or services.</p>
            <p className="mt-1 text-xs">Every answer links to the document and page it came from.</p>
          </div>
        )}

        {messages.map((m) =>
          m.role === "user" ? (
            <div key={m.id} className="flex justify-end">
              <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent px-3 py-2 text-sm text-accent-foreground">{m.text}</p>
            </div>
          ) : (
            <div key={m.id} className="flex justify-start">
              <div className="max-w-[90%]">
                {m.state === "pending" && (
                  <p className="rounded-2xl rounded-bl-sm border border-border bg-surface px-3 py-2 text-sm text-muted">
                    <span className="animate-pulse">Looking through the documents…</span>
                  </p>
                )}
                {m.state === "done" && <Answer result={m.result} />}
                {m.state === "error" && (
                  <div role="alert" className="rounded-2xl rounded-bl-sm border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
                    <p>{m.message}</p>
                    {m.kind !== "unavailable" && m.kind !== "invalid" && (
                      <button onClick={() => run(m.question, m.id)} disabled={busy} className="mt-1.5 text-xs font-medium underline disabled:opacity-50">
                        Try again
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ),
        )}
        <div ref={bottom} />
      </div>

      {disabled ? (
        <p role="alert" className="border-t border-border bg-surface px-4 py-3 text-center text-sm text-muted">
          This assistant is no longer available.
        </p>
      ) : (
        <form onSubmit={submit} className="flex items-end gap-2 border-t border-border bg-surface p-3">
          <label htmlFor="q" className="sr-only">Your question</label>
          <textarea
            id="q"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            maxLength={2000}
            placeholder="Type your question…"
            className="max-h-32 min-h-[2.5rem] flex-1 resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-accent"
          />
          <button
            type="submit"
            disabled={busy || draft.trim().length < 3}
            className="h-10 rounded-lg bg-accent px-4 text-sm font-medium text-accent-foreground hover:opacity-90 disabled:opacity-50"
          >
            Ask
          </button>
        </form>
      )}
    </div>
  );
}

function Answer({ result }: { result: AskResult }) {
  const segments = splitAnswer(result.answer);
  const usedRules = segments.some((s) => s.type === "decision");

  return (
    <div className={`rounded-2xl rounded-bl-sm border px-3 py-2 text-sm ${result.notFound && result.citations.length === 0 ? "border-dashed border-border bg-background" : "border-border bg-surface"}`}>
      {result.notFound && result.citations.length === 0 && (
        <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted">Not in the knowledge base</p>
      )}
      <p className="whitespace-pre-wrap leading-relaxed">
        {segments.map((s, i) =>
          s.type === "text" ? (
            <span key={i}>{s.text}</span>
          ) : s.type === "source" ? (
            <span key={i} className="mx-0.5 inline-block rounded border border-border bg-background px-1 align-baseline text-[11px] text-muted" title={`${s.documentName}, page ${s.pageNumber}`}>
              {s.documentName.replace(/\.pdf$/i, "")} · p.{s.pageNumber}
            </span>
          ) : (
            <span key={i} className="mx-0.5 inline-block rounded border border-accent/40 px-1 align-baseline text-[11px] text-accent" title={`Decided by the rules engine (${s.model})`}>
              rules engine
            </span>
          ),
        )}
      </p>

      {usedRules && <p className="mt-2 text-xs text-muted">Decisions marked “rules engine” were computed by fixed eligibility and routing rules, not by AI.</p>}

      {result.citations.length > 0 && (
        <div className="mt-2 border-t border-border pt-2">
          <p className="text-xs font-medium text-muted">Sources</p>
          <ul className="mt-1 space-y-0.5 text-xs">
            {result.citations.map((c) => (
              <li key={`${c.documentName}-${c.pageNumber}`}>
                {c.documentName} · page {c.pageNumber}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!result.grounded && !result.notFound && (
        <p className="mt-2 text-xs text-danger">Some statements could not be verified against the documents.</p>
      )}
    </div>
  );
}
