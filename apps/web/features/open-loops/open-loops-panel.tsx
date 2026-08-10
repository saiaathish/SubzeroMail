"use client";

import {
  Check,
  ExternalLink,
  Pencil,
  Plus,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import {
  openLoopDirectionLabel,
  type OpenLoop,
  type OpenLoopDirection,
} from "./types";

export type OpenLoopThreadTarget = {
  id: string;
  latestMessageId: string;
  subject: string;
};

type ApiResult<T> = {
  ok: boolean;
  data?: T;
  error?: { message?: string };
};

const directions: OpenLoopDirection[] = ["i_owe", "they_owe", "waiting"];

function dueLabel(dueAt: string | null) {
  return dueAt ? `Due ${dueAt}` : "No due date";
}

function loopGroups(loops: readonly OpenLoop[]) {
  return directions.map((direction) => ({
    direction,
    loops: loops.filter(
      (loop) =>
        loop.status === "open" &&
        !loop.suggestion &&
        loop.direction === direction,
    ),
  }));
}

export function OpenLoopsPanel({
  selectedThread,
  onOpenSource,
}: {
  selectedThread: OpenLoopThreadTarget | null;
  onOpenSource: (threadId: string, sourceMessageId: string | null) => void;
}) {
  const [loops, setLoops] = useState<OpenLoop[]>([]);
  const [loading, setLoading] = useState(true);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [manualDirection, setManualDirection] =
    useState<OpenLoopDirection>("i_owe");
  const [manualText, setManualText] = useState("");
  const [manualDueAt, setManualDueAt] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDirection, setEditDirection] =
    useState<OpenLoopDirection>("i_owe");
  const [editText, setEditText] = useState("");
  const [editDueAt, setEditDueAt] = useState("");

  const loadLoops = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/open-loops", {
        credentials: "same-origin",
      });
      const result = (await response.json()) as ApiResult<{
        loops: OpenLoop[];
      }>;
      if (!response.ok || !result.ok || !result.data) {
        throw new Error(result.error?.message ?? "Could not load Open Loops.");
      }
      setLoops(result.data.loops);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not load Open Loops.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLoops();
  }, [loadLoops]);

  const groups = useMemo(() => loopGroups(loops), [loops]);
  const suggestions = useMemo(
    () => loops.filter((loop) => loop.status === "open" && loop.suggestion),
    [loops],
  );
  const resolved = useMemo(
    () => loops.filter((loop) => loop.status === "resolved"),
    [loops],
  );

  const extract = async () => {
    if (!selectedThread) return;
    setExtracting(true);
    try {
      const response = await fetch("/api/open-loops/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ threadId: selectedThread.id }),
      });
      const result = (await response.json()) as ApiResult<{
        loops: OpenLoop[];
      }>;
      if (!response.ok || !result.ok) {
        throw new Error(
          result.error?.message ?? "Open Loop extraction is unavailable.",
        );
      }
      await loadLoops();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Open Loop extraction is unavailable.",
      );
    } finally {
      setExtracting(false);
    }
  };

  const addManual = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedThread) return;
    try {
      const response = await fetch("/api/open-loops", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          threadId: selectedThread.id,
          sourceMessageId: selectedThread.latestMessageId,
          direction: manualDirection,
          text: manualText,
          dueAt: manualDueAt || null,
        }),
      });
      const result = (await response.json()) as ApiResult<{ loop: OpenLoop }>;
      if (!response.ok || !result.ok) {
        throw new Error(result.error?.message ?? "Could not add Open Loop.");
      }
      setManualText("");
      setManualDueAt("");
      await loadLoops();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not add Open Loop.",
      );
    }
  };

  const saveLoop = async (loop: OpenLoop) => {
    try {
      const response = await fetch(
        `/api/open-loops/${encodeURIComponent(loop.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({
            direction: editDirection,
            text: editText,
            dueAt: editDueAt || null,
          }),
        },
      );
      const result = (await response.json()) as ApiResult<{ loop: OpenLoop }>;
      if (!response.ok || !result.ok) {
        throw new Error(result.error?.message ?? "Could not update Open Loop.");
      }
      setEditingId(null);
      await loadLoops();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update Open Loop.",
      );
    }
  };

  const resolveLoop = async (loop: OpenLoop) => {
    try {
      const response = await fetch(
        `/api/open-loops/${encodeURIComponent(loop.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ status: "resolved" }),
        },
      );
      const result = (await response.json()) as ApiResult<{ loop: OpenLoop }>;
      if (!response.ok || !result.ok) {
        throw new Error(
          result.error?.message ?? "Could not resolve Open Loop.",
        );
      }
      await loadLoops();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not resolve Open Loop.",
      );
    }
  };

  const startEditing = (loop: OpenLoop) => {
    setEditingId(loop.id);
    setEditDirection(loop.direction);
    setEditText(loop.text);
    setEditDueAt(loop.dueAt ?? "");
  };

  return (
    <div className="open-loops-panel" data-testid="open-loops-panel">
      <div className="list-toolbar">
        <div className="list-header">
          <div>
            <h1>Open Loops</h1>
            <p>Visible follow-ups with source-backed state.</p>
          </div>
          <button
            className="icon-button"
            aria-label="Refresh Open Loops"
            onClick={() => void loadLoops()}
          >
            <RefreshCw size={16} />
          </button>
        </div>
        <button
          className="secondary-button"
          disabled={!selectedThread || extracting}
          onClick={() => void extract()}
        >
          <Sparkles size={14} />
          {extracting ? "Detecting…" : "Detect open loops"}
        </button>
      </div>

      {error ? (
        <div className="ai-error" role="alert">
          {error}
        </div>
      ) : null}

      <form
        className="open-loop-form"
        onSubmit={(event) => void addManual(event)}
      >
        <p className="progress">
          {selectedThread
            ? `Add a manual loop for “${selectedThread.subject}”.`
            : "Select a thread before adding a manual loop."}
        </p>
        <select
          aria-label="Manual Open Loop direction"
          className="field"
          value={manualDirection}
          onChange={(event) =>
            setManualDirection(event.target.value as OpenLoopDirection)
          }
        >
          {directions.map((direction) => (
            <option key={direction} value={direction}>
              {openLoopDirectionLabel[direction]}
            </option>
          ))}
        </select>
        <input
          aria-label="Manual Open Loop"
          className="field"
          placeholder="Describe the follow-up"
          value={manualText}
          onChange={(event) => setManualText(event.target.value)}
          required
        />
        <input
          aria-label="Manual Open Loop due date"
          className="field"
          placeholder="Due date (optional)"
          value={manualDueAt}
          onChange={(event) => setManualDueAt(event.target.value)}
        />
        <button
          className="secondary-button"
          disabled={!selectedThread}
          type="submit"
        >
          <Plus size={14} /> Add open loop
        </button>
      </form>

      {loading ? <div className="empty-state">Loading Open Loops…</div> : null}
      {!loading && !loops.length ? (
        <div className="empty-state">
          No Open Loops yet. Detect one from the selected thread or add one
          manually.
        </div>
      ) : null}

      {!loading
        ? groups.map(({ direction, loops: groupLoops }) =>
            groupLoops.length ? (
              <LoopGroup
                key={direction}
                title={openLoopDirectionLabel[direction]}
                loops={groupLoops}
                editingId={editingId}
                editDirection={editDirection}
                editText={editText}
                editDueAt={editDueAt}
                onEditDirection={setEditDirection}
                onEditText={setEditText}
                onEditDueAt={setEditDueAt}
                onStartEditing={startEditing}
                onCancelEditing={() => setEditingId(null)}
                onSave={saveLoop}
                onResolve={resolveLoop}
                onOpenSource={onOpenSource}
              />
            ) : null,
          )
        : null}
      {!loading && suggestions.length ? (
        <LoopGroup
          title="Suggestions"
          loops={suggestions}
          editingId={editingId}
          editDirection={editDirection}
          editText={editText}
          editDueAt={editDueAt}
          onEditDirection={setEditDirection}
          onEditText={setEditText}
          onEditDueAt={setEditDueAt}
          onStartEditing={startEditing}
          onCancelEditing={() => setEditingId(null)}
          onSave={saveLoop}
          onResolve={resolveLoop}
          onOpenSource={onOpenSource}
        />
      ) : null}
      {!loading && resolved.length ? (
        <LoopGroup
          title="Resolved"
          loops={resolved}
          editingId={editingId}
          editDirection={editDirection}
          editText={editText}
          editDueAt={editDueAt}
          onEditDirection={setEditDirection}
          onEditText={setEditText}
          onEditDueAt={setEditDueAt}
          onStartEditing={startEditing}
          onCancelEditing={() => setEditingId(null)}
          onSave={saveLoop}
          onResolve={resolveLoop}
          onOpenSource={onOpenSource}
        />
      ) : null}
    </div>
  );
}

function LoopGroup({
  title,
  loops,
  editingId,
  editDirection,
  editText,
  editDueAt,
  onEditDirection,
  onEditText,
  onEditDueAt,
  onStartEditing,
  onCancelEditing,
  onSave,
  onResolve,
  onOpenSource,
}: {
  title: string;
  loops: readonly OpenLoop[];
  editingId: string | null;
  editDirection: OpenLoopDirection;
  editText: string;
  editDueAt: string;
  onEditDirection: (value: OpenLoopDirection) => void;
  onEditText: (value: string) => void;
  onEditDueAt: (value: string) => void;
  onStartEditing: (loop: OpenLoop) => void;
  onCancelEditing: () => void;
  onSave: (loop: OpenLoop) => void;
  onResolve: (loop: OpenLoop) => void;
  onOpenSource: (threadId: string, sourceMessageId: string | null) => void;
}) {
  return (
    <section className="loop-group" aria-label={title}>
      <p className="nav-label">{title}</p>
      {loops.map((loop) => {
        const editing = editingId === loop.id;
        return (
          <article
            className="loop-row"
            key={loop.id}
            data-testid={`open-loop-${loop.id}`}
          >
            {editing ? (
              <div className="open-loop-edit">
                <select
                  aria-label="Open Loop direction"
                  className="field"
                  value={editDirection}
                  onChange={(event) =>
                    onEditDirection(event.target.value as OpenLoopDirection)
                  }
                >
                  {directions.map((direction) => (
                    <option key={direction} value={direction}>
                      {openLoopDirectionLabel[direction]}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Open Loop description"
                  className="field"
                  value={editText}
                  onChange={(event) => onEditText(event.target.value)}
                />
                <input
                  aria-label="Open Loop due date"
                  className="field"
                  value={editDueAt}
                  onChange={(event) => onEditDueAt(event.target.value)}
                />
                <div className="button-row">
                  <button
                    className="secondary-button"
                    onClick={() => onSave(loop)}
                    disabled={!editText.trim()}
                  >
                    <Check size={14} /> Save changes
                  </button>
                  <button className="text-button" onClick={onCancelEditing}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div>
                  <b>{loop.text}</b>
                  <small>
                    {openLoopDirectionLabel[loop.direction]} ·{" "}
                    {dueLabel(loop.dueAt)}
                    {loop.suggestion
                      ? ` · Suggested at ${Math.round(loop.confidence * 100)}% confidence`
                      : ""}
                  </small>
                </div>
                <div className="button-row">
                  {loop.sourceMessageId ? (
                    <button
                      className="text-button"
                      aria-label={`Open source for ${loop.text}`}
                      onClick={() =>
                        onOpenSource(loop.threadId, loop.sourceMessageId)
                      }
                    >
                      <ExternalLink size={14} /> Source
                    </button>
                  ) : null}
                  {loop.status === "open" ? (
                    <button
                      className="text-button"
                      aria-label={`Edit ${loop.text}`}
                      onClick={() => onStartEditing(loop)}
                    >
                      <Pencil size={14} /> Edit
                    </button>
                  ) : null}
                  {loop.status === "open" ? (
                    <button
                      className="text-button"
                      aria-label={`Resolve ${loop.text}`}
                      onClick={() => void onResolve(loop)}
                    >
                      <Check size={14} /> Resolve
                    </button>
                  ) : null}
                </div>
              </>
            )}
          </article>
        );
      })}
    </section>
  );
}
