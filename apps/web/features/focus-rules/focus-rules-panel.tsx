"use client";

import { Pencil, Plus, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";

import {
  focusBucketLabel,
  focusRuleFieldLabel,
  focusRuleFields,
  type FocusRule,
} from "./types";

type ApiResult = {
  ok: boolean;
  data?: { rules: FocusRule[] };
  error?: { message?: string };
};

const buckets = Object.keys(focusBucketLabel) as FocusRule["bucket"][];

export function FocusRulesPanel() {
  const [rules, setRules] = useState<FocusRule[]>([]);
  const [draft, setDraft] = useState<Omit<FocusRule, "id">>({
    bucket: "priority",
    field: "from",
    pattern: "",
    enabled: true,
  });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [autoArchive, setAutoArchive] = useState(false);

  useEffect(() => {
    void fetch("/api/settings/focus-rules", { credentials: "same-origin" })
      .then(async (response) => {
        const result = (await response.json()) as ApiResult;
        if (!response.ok || !result.ok || !result.data)
          throw new Error(
            result.error?.message ?? "Could not load Focus rules.",
          );
        setRules(result.data.rules);
      })
      .catch((cause) =>
        setNotice(
          cause instanceof Error
            ? cause.message
            : "Could not load Focus rules.",
        ),
      )
      .finally(() => setLoading(false));
    void fetch("/api/settings/auto-archive", { credentials: "same-origin" })
      .then(async (response) => {
        const result = (await response.json()) as {
          ok?: boolean;
          data?: { enabled?: boolean };
        };
        if (response.ok && result.ok && result.data) {
          setAutoArchive(result.data.enabled === true);
        }
      })
      .catch(() => undefined);
  }, []);

  const toggleAutoArchive = async (enabled: boolean) => {
    setAutoArchive(enabled);
    try {
      const response = await fetch("/api/settings/auto-archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ enabled }),
      });
      const result = (await response.json()) as {
        ok?: boolean;
        error?: { message?: string };
      };
      if (!response.ok || !result.ok)
        throw new Error(
          result.error?.message ?? "Could not save auto-archive setting.",
        );
      setNotice(
        enabled
          ? "Auto-archive enabled: obvious newsletters will skip the inbox."
          : "Auto-archive disabled.",
      );
    } catch (cause) {
      setAutoArchive(!enabled);
      setNotice(
        cause instanceof Error
          ? cause.message
          : "Could not save auto-archive setting.",
      );
    }
  };

  const persist = async (next: FocusRule[]) => {
    setRules(next);
    const response = await fetch("/api/settings/focus-rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ rules: next }),
    });
    const result = (await response.json()) as ApiResult;
    if (!response.ok || !result.ok || !result.data)
      throw new Error(result.error?.message ?? "Could not save Focus rules.");
    setRules(result.data.rules);
    setNotice("Focus rules saved.");
  };

  const addOrUpdate = async () => {
    if (!draft.pattern.trim()) {
      setNotice("Add a phrase, address, or sender domain first.");
      return;
    }
    const next = editingId
      ? rules.map((rule) =>
          rule.id === editingId ? { ...draft, id: editingId } : rule,
        )
      : [...rules, { ...draft, id: crypto.randomUUID() }];
    try {
      await persist(next);
      setEditingId(null);
      setDraft({
        bucket: "priority",
        field: "from",
        pattern: "",
        enabled: true,
      });
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "Could not save Focus rules.",
      );
    }
  };

  const edit = (rule: FocusRule) => {
    setEditingId(rule.id);
    setDraft({
      bucket: rule.bucket,
      field: rule.field,
      pattern: rule.pattern,
      enabled: rule.enabled,
    });
  };

  const remove = async (id: string) => {
    try {
      await persist(rules.filter((rule) => rule.id !== id));
    } catch (cause) {
      setNotice(
        cause instanceof Error ? cause.message : "Could not remove Focus rule.",
      );
    }
  };

  return (
    <section className="settings-page" data-testid="focus-rules-panel">
      <div className="settings-page-head">
        <div>
          <p className="nav-label">Deterministic triage</p>
          <h1>Custom Focus rules</h1>
          <p>
            Rules are inspectable and run before default Focus signals. They
            never call a model.
          </p>
        </div>
        <a className="secondary-button" href="/">
          Back to inbox
        </a>
      </div>
      {notice ? (
        <div className="banner" role="status">
          {notice}
        </div>
      ) : null}
      <div className="settings-card">
        <label className="focus-rule-toggle">
          <input
            type="checkbox"
            checked={autoArchive}
            aria-label="Auto-archive obvious newsletters"
            onChange={(event) => void toggleAutoArchive(event.target.checked)}
          />
          <span>
            <b>Auto-archive obvious newsletters</b>
            <small>
              Threads with a deterministic newsletter signal (confidence ≥ 0.90)
              skip the primary inbox on refresh. No model is involved.
            </small>
          </span>
        </label>
      </div>
      <div className="settings-card">
        <h2>{editingId ? "Edit rule" : "Add a rule"}</h2>
        <div className="focus-rule-form">
          <label>
            Bucket
            <select
              className="field"
              disabled={loading}
              value={draft.bucket}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  bucket: event.target.value as FocusRule["bucket"],
                }))
              }
            >
              {buckets.map((bucket) => (
                <option key={bucket} value={bucket}>
                  {focusBucketLabel[bucket]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Match field
            <select
              className="field"
              disabled={loading}
              value={draft.field}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  field: event.target.value as FocusRule["field"],
                }))
              }
            >
              {focusRuleFields.map((field) => (
                <option key={field} value={field}>
                  {focusRuleFieldLabel[field]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Contains
            <input
              className="field"
              disabled={loading}
              value={draft.pattern}
              placeholder="@school.edu or newsletters"
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  pattern: event.target.value,
                }))
              }
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              disabled={loading}
              checked={draft.enabled}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  enabled: event.target.checked,
                }))
              }
            />{" "}
            Enabled
          </label>
        </div>
        <div className="modal-footer">
          <button
            className="primary-button"
            disabled={loading}
            onClick={() => void addOrUpdate()}
          >
            <Save size={14} /> {editingId ? "Save changes" : "Add rule"}
          </button>
          {editingId ? (
            <button
              className="secondary-button"
              onClick={() => {
                setEditingId(null);
                setDraft({
                  bucket: "priority",
                  field: "from",
                  pattern: "",
                  enabled: true,
                });
              }}
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>
      <div className="settings-card">
        <h2>Rules</h2>
        {loading ? <p className="empty-state">Loading Focus rules…</p> : null}
        {!loading && !rules.length ? (
          <p className="empty-state">No custom rules yet.</p>
        ) : null}
        {rules.map((rule) => (
          <div className="focus-rule-row" key={rule.id}>
            <div>
              <strong>{focusBucketLabel[rule.bucket]}</strong>
              <span>
                {focusRuleFieldLabel[rule.field]} contains “{rule.pattern}”
              </span>
              <small>{rule.enabled ? "Enabled" : "Disabled"}</small>
            </div>
            <div className="toolbar-group">
              <button
                className="icon-button"
                aria-label={`Edit Focus rule ${rule.pattern}`}
                onClick={() => edit(rule)}
              >
                <Pencil size={14} />
              </button>
              <button
                className="icon-button"
                aria-label={`Delete Focus rule ${rule.pattern}`}
                onClick={() => void remove(rule.id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="progress">
        Example: Always Priority / Sender / @school.edu. Example: Always Other /
        Any field / newsletters.
      </p>
    </section>
  );
}
