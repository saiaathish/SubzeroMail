"use client";

import React, { useCallback, useEffect, useState } from "react";
import { type VoiceProfile, VoiceProfileSchema } from "@subzero/ai";

const endpoint = "/api/settings/voice-profile";

const emptyProfile: VoiceProfile = {
  formality: "neutral",
  averageLength: "medium",
  greetingPatterns: [],
  signoffPatterns: [],
  directness: 0.5,
  formattingNotes: [],
};

type VoiceProfileData = {
  configured: boolean;
  profile: VoiceProfile | null;
};

function lines(value: string) {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function errorMessage(value: unknown) {
  if (
    value &&
    typeof value === "object" &&
    "error" in value &&
    value.error &&
    typeof value.error === "object" &&
    "message" in value.error &&
    typeof value.error.message === "string"
  ) {
    return value.error.message;
  }
  return "Voice Profile request failed. Please try again.";
}

async function requestVoiceProfile(
  method: "GET" | "POST",
  body?: Record<string, unknown>,
): Promise<VoiceProfileData> {
  const response = await fetch(endpoint, {
    method,
    headers: body ? { "content-type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error(errorMessage(payload));

  const data =
    payload &&
    typeof payload === "object" &&
    "ok" in payload &&
    payload.ok === true &&
    "data" in payload
      ? payload.data
      : null;
  if (!data || typeof data !== "object" || !("profile" in data)) {
    throw new Error("Voice Profile response was invalid.");
  }

  const profile = data.profile;
  if (profile === null) return { configured: false, profile: null };
  const parsed = VoiceProfileSchema.safeParse(profile);
  if (!parsed.success) throw new Error("Voice Profile response was invalid.");
  return { configured: true, profile: parsed.data };
}

export function VoiceProfileSettings() {
  const [profile, setProfile] = useState<VoiceProfile | null>(null);
  const [draft, setDraft] = useState<VoiceProfile>(emptyProfile);
  const [sampleCount, setSampleCount] = useState(20);
  const [optIn, setOptIn] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await requestVoiceProfile("GET");
      setProfile(data.profile);
      setDraft(data.profile ?? emptyProfile);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Voice Profile could not be loaded.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    if (!optIn) {
      setError("Confirm opt-in before sampling sent messages.");
      return;
    }
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const data = await requestVoiceProfile("POST", {
        action: "create",
        optIn: true,
        sampleCount,
      });
      if (!data.profile) throw new Error("Voice Profile was not created.");
      setProfile(data.profile);
      setDraft(data.profile);
      setNotice("Voice Profile created. You can edit it below at any time.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Voice Profile could not be created.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const save = async () => {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const data = await requestVoiceProfile("POST", {
        action: "save",
        // Saving a profile is also an explicit opt-in action.
        optIn: true,
        profile: draft,
      });
      if (!data.profile) throw new Error("Voice Profile was not saved.");
      setProfile(data.profile);
      setDraft(data.profile);
      setNotice("Voice Profile changes saved.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Voice Profile could not be saved.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  const reset = async () => {
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      await requestVoiceProfile("POST", { action: "reset" });
      setProfile(null);
      setDraft(emptyProfile);
      setOptIn(false);
      setNotice("Voice Profile reset. Future drafts will use no profile.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Voice Profile could not be reset.",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="voice-settings-page" aria-labelledby="voice-profile-title">
      <header className="voice-settings-header">
        <div>
          <a className="voice-back-link" href="/">
            ← Inbox
          </a>
          <p className="nav-label">Writing preferences</p>
          <h1 id="voice-profile-title">Voice Profile</h1>
          <p>
            A compact description of how you write, used only when you ask
            Subzero to draft a reply.
          </p>
        </div>
      </header>

      <section
        className="voice-privacy-note"
        aria-label="Voice Profile privacy"
      >
        <strong>Your sent email is not a training dataset.</strong>
        <p>
          With your opt-in, Subzero reads 20–50 sent messages once to derive a
          compact profile through your configured AI provider. Raw sampled
          messages are not stored in Subzero and are not sent with later drafts.
        </p>
      </section>

      {error ? (
        <p className="banner error" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="banner success" role="status">
          {notice}
        </p>
      ) : null}

      {loading ? (
        <p className="summary-card" role="status">
          Loading Voice Profile…
        </p>
      ) : profile ? (
        <section className="voice-profile-card" aria-label="Edit Voice Profile">
          <div className="voice-profile-card-heading">
            <div>
              <p className="nav-label">Compact profile</p>
              <h2>Inspect and edit</h2>
            </div>
            <span className="voice-profile-status">Active</span>
          </div>

          <div className="voice-form-grid">
            <label>
              Formality
              <select
                aria-label="Formality"
                className="field"
                disabled={submitting}
                value={draft.formality}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    formality: event.target.value as VoiceProfile["formality"],
                  }))
                }
              >
                <option value="casual">Casual</option>
                <option value="neutral">Neutral</option>
                <option value="formal">Formal</option>
              </select>
            </label>
            <label>
              Typical length
              <select
                aria-label="Typical length"
                className="field"
                disabled={submitting}
                value={draft.averageLength}
                onChange={(event) =>
                  setDraft((current) => ({
                    ...current,
                    averageLength: event.target
                      .value as VoiceProfile["averageLength"],
                  }))
                }
              >
                <option value="short">Short</option>
                <option value="medium">Medium</option>
                <option value="long">Long</option>
              </select>
            </label>
            <label>
              Directness (0–1)
              <input
                aria-label="Directness"
                className="field"
                disabled={submitting}
                max="1"
                min="0"
                step="0.1"
                type="number"
                value={draft.directness}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  setDraft((current) => ({
                    ...current,
                    directness: Number.isFinite(value)
                      ? Math.max(0, Math.min(1, value))
                      : current.directness,
                  }));
                }}
              />
            </label>
          </div>

          <label>
            Greeting patterns <span>One per line</span>
            <textarea
              aria-label="Greeting patterns"
              className="field"
              disabled={submitting}
              rows={3}
              value={draft.greetingPatterns.join("\n")}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  greetingPatterns: lines(event.target.value),
                }))
              }
            />
          </label>
          <label>
            Signoff patterns <span>One per line</span>
            <textarea
              aria-label="Signoff patterns"
              className="field"
              disabled={submitting}
              rows={3}
              value={draft.signoffPatterns.join("\n")}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  signoffPatterns: lines(event.target.value),
                }))
              }
            />
          </label>
          <label>
            Formatting notes <span>One per line</span>
            <textarea
              aria-label="Formatting notes"
              className="field"
              disabled={submitting}
              rows={4}
              value={draft.formattingNotes.join("\n")}
              onChange={(event) =>
                setDraft((current) => ({
                  ...current,
                  formattingNotes: lines(event.target.value),
                }))
              }
            />
          </label>

          <div className="voice-profile-actions">
            <button
              className="primary-button"
              disabled={submitting}
              onClick={() => void save()}
              type="button"
            >
              Save changes
            </button>
            <button
              className="danger-button"
              disabled={submitting}
              onClick={() => void reset()}
              type="button"
            >
              Reset profile
            </button>
          </div>
        </section>
      ) : (
        <section
          className="voice-profile-card"
          aria-label="Create Voice Profile"
        >
          <p className="nav-label">Optional setup</p>
          <h2>Teach drafts your writing style</h2>
          <p>
            Drafting remains available without a profile. Create one only if you
            want your BYOK provider to derive style preferences from selected
            sent mail.
          </p>

          <label className="voice-opt-in">
            <input
              checked={optIn}
              disabled={submitting}
              onChange={(event) => setOptIn(event.target.checked)}
              type="checkbox"
            />
            <span>
              I opt in to sample sent messages once for Voice Profile creation.
            </span>
          </label>
          <label className="voice-sample-count">
            Number of sent messages to sample
            <select
              aria-label="Number of sent messages to sample"
              className="field"
              disabled={submitting}
              value={sampleCount}
              onChange={(event) => setSampleCount(Number(event.target.value))}
            >
              {[20, 30, 40, 50].map((count) => (
                <option key={count} value={count}>
                  {count} messages
                </option>
              ))}
            </select>
          </label>
          <button
            className="primary-button"
            disabled={!optIn || submitting}
            onClick={() => void create()}
            type="button"
          >
            Create Voice Profile
          </button>
        </section>
      )}
    </main>
  );
}
