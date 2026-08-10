"use client";

import { LoaderCircle, Search, Sparkles } from "lucide-react";
import React, { useMemo, useState } from "react";

import type { InboxThread } from "@/lib/demo-data";

export type AskInboxSource = {
  messageId: string;
  threadId: string;
};

export type AskInboxAnswer = {
  answer: string;
  confidence: number;
  sourceMessageIds: string[];
  sources: AskInboxSource[];
  retrieval?: {
    queryCount: number;
    candidateThreadCount: number;
    evidenceCount: number;
  };
};

type AskInboxApiResult = {
  ok: boolean;
  data?: AskInboxAnswer;
  error?: { code?: string; message?: string };
};

type AskInboxPanelProps = {
  demoMode: boolean;
  threads: readonly InboxThread[];
  onOpenSource: (source: AskInboxSource) => void | Promise<void>;
};

const noEvidenceAnswer = (): AskInboxAnswer => ({
  answer: "Not enough evidence to answer this from the retrieved mail.",
  confidence: 0,
  sourceMessageIds: [],
  sources: [],
});

const stopWords = new Set([
  "about",
  "after",
  "before",
  "from",
  "have",
  "is",
  "that",
  "the",
  "this",
  "to",
  "what",
  "when",
  "where",
  "which",
  "who",
  "with",
  "would",
  "your",
]);

function questionTerms(question: string): string[] {
  return [
    ...new Set(
      (question.toLowerCase().match(/[\p{L}\p{N}@._+-]{2,}/gu) ?? []).filter(
        (term) => !stopWords.has(term),
      ),
    ),
  ];
}

function score(value: string, terms: readonly string[]): number {
  const normalized = value.toLowerCase();
  return terms.reduce(
    (total, term) => total + (normalized.includes(term) ? 1 : 0),
    0,
  );
}

/** Fixture-only mirror of the server contract for local demo and E2E use. */
function demoAskInbox(
  question: string,
  threads: readonly InboxThread[],
): AskInboxAnswer {
  const terms = questionTerms(question);
  const matches = threads.flatMap((thread) =>
    thread.messages.map((message) => ({
      thread,
      message,
      score:
        score(`${thread.sender} ${thread.subject}`, terms) * 4 +
        score(`${thread.preview} ${message.text}`, terms),
    })),
  );
  const best = matches.sort(
    (left, right) =>
      right.score - left.score ||
      right.message.id.localeCompare(left.message.id),
  )[0];
  if (!best || best.score === 0) return noEvidenceAnswer();

  return {
    answer: `${best.thread.sender} wrote: ${best.message.text}`,
    confidence: Math.min(0.95, 0.55 + best.score * 0.1),
    sourceMessageIds: [best.message.id],
    sources: [{ messageId: best.message.id, threadId: best.thread.id }],
    retrieval: {
      queryCount: 1,
      candidateThreadCount: 1,
      evidenceCount: 1,
    },
  };
}

export function AskInboxPanel({
  demoMode,
  threads,
  onOpenSource,
}: AskInboxPanelProps) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskInboxAnswer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isAsking, setIsAsking] = useState(false);
  const sourcesByMessageId = useMemo(
    () => new Map(answer?.sources.map((source) => [source.messageId, source])),
    [answer],
  );

  const ask = async () => {
    const trimmedQuestion = question.trim();
    if (!trimmedQuestion) {
      setError("Ask a question about your mail first.");
      setAnswer(null);
      return;
    }
    setIsAsking(true);
    setError(null);
    try {
      if (demoMode) {
        setAnswer(demoAskInbox(trimmedQuestion, threads));
        return;
      }
      const response = await fetch("/api/ai/ask-inbox", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ question: trimmedQuestion }),
      });
      const result = (await response.json()) as AskInboxApiResult;
      if (!response.ok || !result.ok || !result.data) {
        throw new Error(
          result.error?.message ??
            "Ask Inbox is unavailable. Gmail remains available.",
        );
      }
      setAnswer(result.data);
    } catch (cause) {
      setAnswer(null);
      setError(
        cause instanceof Error
          ? cause.message
          : "Ask Inbox is unavailable. Gmail remains available.",
      );
    } finally {
      setIsAsking(false);
    }
  };

  return (
    <section
      className="summary-card"
      aria-labelledby="ask-inbox-title"
      data-testid="ask-inbox"
    >
      <div className="summary-top">
        <h2 id="ask-inbox-title">Ask Inbox</h2>
        <span className="progress">source-backed answers</span>
      </div>
      <p>
        Ask a question across Gmail. Subzero retrieves only a small set of
        matching messages and shows every source it uses.
      </p>
      <form
        className="search-wrap"
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
      >
        <Search
          aria-hidden="true"
          size={15}
          style={{
            position: "absolute",
            left: 10,
            top: 10,
            color: "var(--muted)",
          }}
        />
        <input
          className="field"
          style={{ paddingLeft: 32 }}
          aria-label="Ask Inbox question"
          placeholder="What price did Alex finally agree to?"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button
          className="secondary-button"
          data-testid="ask-inbox-submit"
          disabled={isAsking}
          type="submit"
        >
          {isAsking ? (
            <>
              <LoaderCircle className="spin" size={14} /> Searching mail
            </>
          ) : (
            <>
              <Sparkles size={14} /> Ask Inbox
            </>
          )}
        </button>
      </form>
      {error ? (
        <div className="ai-error" role="alert">
          {error}
        </div>
      ) : null}
      {answer ? (
        <div data-testid="ask-inbox-answer" role="status">
          <p>{answer.answer}</p>
          {answer.sourceMessageIds.length > 0 ? (
            <div className="chips" aria-label="Ask Inbox sources">
              {answer.sourceMessageIds.map((messageId) => {
                const source = sourcesByMessageId.get(messageId);
                return source ? (
                  <button
                    className="chip"
                    key={messageId}
                    onClick={() => void onOpenSource(source)}
                  >
                    Source: {messageId}
                  </button>
                ) : null;
              })}
            </div>
          ) : (
            <span className="progress">No source was retrieved.</span>
          )}
        </div>
      ) : null}
    </section>
  );
}
