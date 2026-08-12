import { useEffect, useMemo, useState, type FormEvent } from "react";

import { sendExtensionMessage } from "../runtime";
import {
  DEFAULT_EXTENSION_STATE,
  type ExtensionPreferences,
  type ExtensionState,
  type Theme,
} from "../types";
import type { OpenLoop } from "@subzero/core";

interface Reminder {
  loopId: string;
  threadId: string;
  text: string;
  dueAt: string;
  kind: "overdue" | "due_soon";
}

interface AskResult {
  answer: string;
  confidence: number;
  evidence: Array<{ messageId: string; threadId: string; text: string }>;
  provider?: string;
}

interface SummaryResult {
  summary: string;
  latestDelta: string | null;
  actionRequired: string | null;
  deadline: string | null;
  provider?: string;
}

export function SidePanel() {
  const [state, setState] = useState<ExtensionState>(DEFAULT_EXTENSION_STATE);
  const [loops, setLoops] = useState<OpenLoop[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<AskResult | null>(null);
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");

  async function refresh() {
    const [stateResponse, loopsResponse] = await Promise.all([
      sendExtensionMessage<ExtensionState>({ type: "app/get-state" }),
      sendExtensionMessage<{ loops: OpenLoop[]; reminders: Reminder[] }>({
        type: "loops/list",
      }),
    ]);
    if (stateResponse.ok && stateResponse.data) setState(stateResponse.data);
    if (loopsResponse.ok && loopsResponse.data) {
      setLoops(loopsResponse.data.loops);
      setReminders(loopsResponse.data.reminders);
    }
  }

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 900);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = state.theme;
    document.documentElement.style.colorScheme = state.theme;
  }, [state.theme]);

  const currentThread = state.gmail.threadId;
  const openLoops = useMemo(
    () => loops.filter((loop) => loop.status === "open"),
    [loops],
  );

  async function summarizeCurrentThread() {
    if (!currentThread) {
      setNotice("Open a Gmail thread to see its summary here.");
      return;
    }
    setBusy(true);
    const response = await sendExtensionMessage<SummaryResult>({
      type: "ai/summarize",
      threadId: currentThread,
    });
    setBusy(false);
    if (!response.ok || !response.data) {
      setNotice(response.error?.message ?? "Summary unavailable.");
      return;
    }
    setSummary(response.data);
    setNotice("Summary ready.");
  }

  async function askInbox(event: FormEvent) {
    event.preventDefault();
    const value = question.trim();
    if (!value) return;
    setBusy(true);
    const response = await sendExtensionMessage<AskResult>({
      type: "ai/ask-inbox",
      question: value,
    });
    setBusy(false);
    if (!response.ok || !response.data) {
      setNotice(response.error?.message ?? "Ask Inbox unavailable.");
      return;
    }
    setAnswer(response.data);
  }

  async function resolve(loopId: string) {
    const response = await sendExtensionMessage({
      type: "loops/resolve",
      loopId,
    });
    if (!response.ok) {
      setNotice(response.error?.message ?? "Loop could not be resolved.");
      return;
    }
    await refresh();
  }

  async function openThread(threadId?: string) {
    const response = await sendExtensionMessage({
      type: "gmail/open-in-subzero",
      threadId,
    });
    if (!response.ok)
      setNotice(response.error?.message ?? "Could not open Subzero.");
  }

  async function setTheme(theme: Theme) {
    const response = await sendExtensionMessage<ExtensionState>({
      type: "app/set-theme",
      theme,
    });
    if (response.ok && response.data) setState(response.data);
  }

  async function updatePreference(
    key: keyof ExtensionPreferences,
    value: boolean | ExtensionPreferences["experience"],
  ) {
    const response = await sendExtensionMessage<ExtensionState>({
      type: "settings/update-preferences",
      preferences: { [key]: value },
    });
    if (response.ok && response.data) setState(response.data);
  }

  return (
    <main className="sidepanel-shell">
      <header className="sidepanel-header">
        <div>
          <p className="eyebrow">SUBZERO</p>
          <h1>Intelligence rail</h1>
          <p className="muted">{state.account.email ?? "Local inbox"}</p>
        </div>
        <button
          className="theme-toggle"
          type="button"
          aria-label={`Use ${state.theme === "dark" ? "light" : "dark"} theme`}
          onClick={() =>
            void setTheme(state.theme === "dark" ? "light" : "dark")
          }
        >
          {state.theme === "dark" ? "☼" : "☾"}
        </button>
      </header>

      <section
        className="rail-section current-section"
        aria-labelledby="now-heading"
      >
        <div className="section-heading">
          <h2 id="now-heading">Now</h2>
          <span
            className="status-dot"
            aria-label={`${openLoops.length} open loops`}
          />
        </div>
        {currentThread ? (
          <div className="current-thread">
            <div>
              <p className="eyebrow">CURRENT THREAD</p>
              <p className="thread-id">{currentThread}</p>
              {summary ? (
                <p className="summary-copy">{summary.summary}</p>
              ) : null}
            </div>
            <div className="button-row">
              <button
                type="button"
                onClick={() => void summarizeCurrentThread()}
                disabled={busy}
              >
                {busy ? "Reading…" : summary ? "Refresh summary" : "Summarize"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void openThread(currentThread)}
              >
                Open in Subzero
              </button>
            </div>
            {summary?.actionRequired ? (
              <p className="meta-line">
                <strong>Action</strong>
                {summary.actionRequired}
              </p>
            ) : null}
            {summary?.deadline ? (
              <p className="meta-line">
                <strong>Due</strong>
                {summary.deadline}
              </p>
            ) : null}
          </div>
        ) : (
          <div className="empty-state">
            Open a Gmail conversation. Subzero will follow along.
          </div>
        )}
        <div className="stat-grid" aria-label="Inbox focus counts">
          <div>
            <strong>
              {openLoops.filter((loop) => loop.direction === "i_owe").length}
            </strong>
            <span>I owe</span>
          </div>
          <div>
            <strong>
              {openLoops.filter((loop) => loop.direction === "they_owe").length}
            </strong>
            <span>They owe</span>
          </div>
          <div>
            <strong>{reminders.length}</strong>
            <span>Due soon</span>
          </div>
        </div>
      </section>

      <section className="rail-section" aria-labelledby="ask-heading">
        <div className="section-heading">
          <h2 id="ask-heading">Ask</h2>
          <span className="muted">source-backed</span>
        </div>
        <form className="ask-form" onSubmit={(event) => void askInbox(event)}>
          <input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Ask your inbox…"
            aria-label="Ask your inbox"
          />
          <button type="submit" disabled={busy || !question.trim()}>
            Ask
          </button>
        </form>
        {answer ? (
          <div className="answer-box">
            <p>{answer.answer}</p>
            <p className="muted">
              {Math.round(answer.confidence * 100)}% confidence ·{" "}
              {answer.provider ?? "local"}
            </p>
            <div className="source-list" aria-label="Answer sources">
              {answer.evidence.map((source) => (
                <button
                  key={`${source.threadId}:${source.messageId}`}
                  type="button"
                  className="source-chip"
                  onClick={() => void openThread(source.threadId)}
                >
                  {source.text.slice(0, 62)}
                  {source.text.length > 62 ? "…" : ""}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="rail-section" aria-labelledby="loops-heading">
        <div className="section-heading">
          <h2 id="loops-heading">Open Loops</h2>
          <span className="muted">{openLoops.length} open</span>
        </div>
        {openLoops.length === 0 ? (
          <div className="empty-state">No commitments waiting on you.</div>
        ) : (
          <div className="loop-list">
            {openLoops.slice(0, 8).map((loop) => (
              <article className="loop-row" key={loop.id}>
                <div>
                  <p>{loop.text}</p>
                  <span className="muted">
                    {loop.dueAt
                      ? new Date(loop.dueAt).toLocaleDateString()
                      : "No due date"}
                  </span>
                </div>
                <div className="button-row compact">
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => void openThread(loop.threadId)}
                  >
                    Open
                  </button>
                  <button
                    type="button"
                    className="quiet"
                    onClick={() => void resolve(loop.id)}
                  >
                    Resolve
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <details className="rail-section preferences-section">
        <summary>Gmail preferences</summary>
        <label>
          <span>Experience</span>
          <select
            value={state.preferences.experience}
            onChange={(event) =>
              void updatePreference(
                "experience",
                event.target.value as ExtensionPreferences["experience"],
              )
            }
          >
            <option value="both">Gmail + standalone</option>
            <option value="gmail-only">Gmail enhancements</option>
            <option value="standalone-only">Standalone only</option>
          </select>
        </label>
        <label>
          <span>Thread actions</span>
          <input
            type="checkbox"
            checked={state.preferences.showThreadActions}
            onChange={(event) =>
              void updatePreference("showThreadActions", event.target.checked)
            }
          />
        </label>
        <label>
          <span>Compose AI</span>
          <input
            type="checkbox"
            checked={state.preferences.showComposeAI}
            onChange={(event) =>
              void updatePreference("showComposeAI", event.target.checked)
            }
          />
        </label>
        <label>
          <span>Open Loop suggestions</span>
          <input
            type="checkbox"
            checked={state.preferences.enableOpenLoopSuggestions}
            onChange={(event) =>
              void updatePreference(
                "enableOpenLoopSuggestions",
                event.target.checked,
              )
            }
          />
        </label>
        <label>
          <span>Reminders</span>
          <input
            type="checkbox"
            checked={state.preferences.enableReminders}
            onChange={(event) =>
              void updatePreference("enableReminders", event.target.checked)
            }
          />
        </label>
        <label>
          <span>Auto labels</span>
          <input
            type="checkbox"
            checked={state.preferences.enableAutoLabels}
            onChange={(event) =>
              void updatePreference("enableAutoLabels", event.target.checked)
            }
          />
        </label>
        <label>
          <span>Auto archive</span>
          <input
            type="checkbox"
            checked={state.preferences.enableAutoArchive}
            onChange={(event) =>
              void updatePreference("enableAutoArchive", event.target.checked)
            }
          />
        </label>
      </details>

      {notice ? (
        <p className="rail-notice" role="status">
          {notice}
        </p>
      ) : null}
    </main>
  );
}
