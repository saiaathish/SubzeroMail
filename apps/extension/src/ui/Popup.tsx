import { ExternalLink, Pencil, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import type { FixtureThread } from "../fixtures";
import { sendExtensionMessage } from "../runtime";
import {
  DEFAULT_EXTENSION_STATE,
  type ExtensionState,
  type SubzeroExperience,
} from "../types";

const EXPERIENCE_OPTIONS: Array<{
  value: SubzeroExperience;
  label: string;
  description: string;
  recommended?: boolean;
}> = [
  {
    value: "gmail-only",
    label: "Enhance Gmail",
    description: "Keep Gmail as your home, with Subzero built in.",
  },
  {
    value: "standalone-only",
    label: "Use Subzero",
    description: "Open the full keyboard-first client.",
  },
  {
    value: "both",
    label: "Both",
    description: "Gmail enhancements plus the full client.",
    recommended: true,
  },
];

export function Popup() {
  const [state, setState] = useState<ExtensionState>(DEFAULT_EXTENSION_STATE);
  const [counts, setCounts] = useState({ total: 0, needsReply: 0, waiting: 0 });
  const [busy, setBusy] = useState(false);
  const [experience, setExperience] = useState<SubzeroExperience>("both");
  const [connectionError, setConnectionError] = useState<string | null>(null);

  useEffect(() => {
    void sendExtensionMessage<ExtensionState>({ type: "app/get-state" }).then(
      async (stateResponse) => {
        if (!stateResponse.ok || !stateResponse.data) return;
        setState(stateResponse.data);
        if (stateResponse.data.account.mode !== "connected") return;

        const threadsResponse = await sendExtensionMessage<FixtureThread[]>({
          type: "mail/get-threads",
        });
        if (threadsResponse.ok && threadsResponse.data) {
          setCounts(getLiveCounts(threadsResponse.data));
        }
      },
    );
  }, []);

  useEffect(() => {
    setExperience(state.preferences.experience);
  }, [state.preferences.experience]);

  async function connectGoogle() {
    setBusy(true);
    setConnectionError(null);

    try {
      const auth = await sendExtensionMessage<{
        status: string;
        message: string;
        threads?: FixtureThread[];
        email?: string;
      }>({ type: "oauth/start" });
      const result = auth.data;
      if (
        !auth.ok ||
        !result ||
        result.status !== "completed" ||
        typeof result.email !== "string" ||
        !Array.isArray(result.threads)
      ) {
        setConnectionError(
          auth.error?.message ??
            result?.message ??
            "Google authorization did not complete. Try again to connect Gmail.",
        );
        return;
      }

      const preferences = await sendExtensionMessage<ExtensionState>({
        type: "settings/update-preferences",
        preferences: { experience, onboardingComplete: true },
      });
      if (!preferences.ok || !preferences.data) {
        setConnectionError(
          preferences.error?.message ??
            "Google authorized Gmail, but Subzero could not save your preferences. Try again.",
        );
        return;
      }

      setState(preferences.data);
      setCounts(getLiveCounts(result.threads));
      await sendExtensionMessage({ type: "app/open" });
      window.close();
    } catch {
      setConnectionError("Google connection could not start. Try again.");
    } finally {
      setBusy(false);
    }
  }

  async function openApp() {
    setBusy(true);
    await sendExtensionMessage({ type: "app/open" });
    window.close();
  }

  async function refresh() {
    setBusy(true);
    try {
      const response = await sendExtensionMessage<{
        threads: FixtureThread[];
        email: string;
      }>({ type: "mail/sync" });
      if (!response.ok || !response.data) {
        setConnectionError(
          response.error?.message ?? "Gmail refresh failed. Try again.",
        );
        return;
      }

      const nextState = await sendExtensionMessage<ExtensionState>({
        type: "app/get-state",
      });
      if (nextState.ok && nextState.data) setState(nextState.data);
      setCounts(getLiveCounts(response.data.threads));
    } finally {
      setBusy(false);
    }
  }

  function quickCompose() {
    void sendExtensionMessage({ type: "compose/quick", mode: "new" });
    void openApp();
  }

  if (!state.preferences.onboardingComplete) {
    return (
      <main className="sz-popup sz-popup--onboarding">
        <header className="sz-popup__header">
          <div>
            <div className="sz-popup__mark">
              <span aria-hidden="true">✦</span> SUBZERO
            </div>
            <p>Make Gmail faster without replacing it.</p>
          </div>
        </header>
        <section
          className="sz-onboarding__intro"
          aria-labelledby="sz-onboarding-title"
        >
          <p className="sz-onboarding__eyebrow">WELCOME TO SUBZERO</p>
          <h1 id="sz-onboarding-title">How should Subzero meet Gmail?</h1>
          <p>Choose a starting point. You can change it later in Settings.</p>
        </section>
        <fieldset className="sz-onboarding__choices" disabled={busy}>
          <legend>Choose your starting point</legend>
          {EXPERIENCE_OPTIONS.map(
            ({ value, label, description, recommended }) => (
              <label
                className={`sz-onboarding__choice${experience === value ? " is-selected" : ""}`}
                key={value}
              >
                <input
                  type="radio"
                  name="subzero-experience"
                  value={value}
                  checked={experience === value}
                  onChange={() => setExperience(value as SubzeroExperience)}
                />
                <span className="sz-onboarding__choice-copy">
                  <strong>{label}</strong>
                  {recommended ? (
                    <span className="sz-onboarding__recommended">
                      Recommended
                    </span>
                  ) : null}
                  <small>{description}</small>
                </span>
              </label>
            ),
          )}
        </fieldset>
        <div className="sz-onboarding__footer">
          <p>AI is optional. Add a provider later in Settings.</p>
          {connectionError ? (
            <p
              className="sz-popup__error"
              id="sz-onboarding-error"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              {connectionError}
            </p>
          ) : null}
          <button
            className="sz-popup__primary"
            type="button"
            onClick={() => void connectGoogle()}
            disabled={busy}
            aria-busy={busy}
            aria-describedby={
              connectionError ? "sz-onboarding-error" : undefined
            }
          >
            {busy ? "Connecting…" : "Continue with Google"}
          </button>
        </div>
      </main>
    );
  }

  if (state.account.mode !== "connected") {
    return (
      <main className="sz-popup sz-popup--connection">
        <header className="sz-popup__header">
          <div>
            <div className="sz-popup__mark">
              <span aria-hidden="true">✦</span> SUBZERO
            </div>
            <p>Gmail productivity client</p>
          </div>
        </header>
        <section className="sz-connection__intro">
          <p className="sz-onboarding__eyebrow">CONNECT YOUR INBOX</p>
          <h1>Ready when you are.</h1>
          <p>
            Connect Google to load your live Gmail inbox. Subzero will not show
            mail until you approve access.
          </p>
        </section>
        <div className="sz-connection__notice">
          <ShieldCheck size={15} /> Gmail access stays behind Google&apos;s
          authorization screen.
        </div>
        {connectionError ? (
          <p
            className="sz-popup__error"
            id="sz-connection-error"
            role="status"
            aria-live="polite"
            aria-atomic="true"
          >
            {connectionError}
          </p>
        ) : null}
        <button
          className="sz-popup__primary"
          type="button"
          onClick={() => void connectGoogle()}
          disabled={busy}
          aria-busy={busy}
          aria-describedby={connectionError ? "sz-connection-error" : undefined}
        >
          {busy ? "Connecting…" : "Continue with Google"}
        </button>
      </main>
    );
  }

  return (
    <main className="sz-popup" data-subzero-theme={state.theme}>
      <header className="sz-popup__header">
        <div>
          <div className="sz-popup__mark">
            <span aria-hidden="true">✦</span> SUBZERO
          </div>
          <p>Gmail productivity client</p>
        </div>
        <span
          className={`sz-popup__status sz-popup__status--${state.sync.status}`}
        >
          <span aria-hidden="true" />{" "}
          {state.sync.status === "idle" ? "Connected" : "Syncing"}
        </span>
      </header>

      <section className="sz-popup__account" aria-label="Account status">
        <div className="sz-popup__avatar">
          {state.account.mode === "connected" ? "G" : "SZ"}
        </div>
        <div>
          <strong>{state.account.label}</strong>
          <span>{state.account.email ?? "No account connected"}</span>
        </div>
        <ShieldCheck size={16} aria-label="Local state boundary" />
      </section>

      <div className="sz-popup__metrics" aria-label="Inbox counts">
        <div>
          <strong>{state.sync.threadCount ?? counts.total}</strong>
          <span>threads</span>
        </div>
        <div>
          <strong>{counts.needsReply}</strong>
          <span>needs reply</span>
        </div>
        <div>
          <strong>{counts.waiting}</strong>
          <span>waiting</span>
        </div>
      </div>

      <div className="sz-popup__actions">
        <button className="sz-popup__primary" onClick={() => void openApp()}>
          <ExternalLink size={16} /> Open Subzero <kbd>↵</kbd>
        </button>
        <div className="sz-popup__secondary-row">
          <button onClick={quickCompose}>
            <Pencil size={15} /> Quick compose
          </button>
          <button onClick={() => void refresh()} disabled={busy}>
            <RefreshCw size={15} className={busy ? "sz-popup__spin" : ""} />{" "}
            Refresh
          </button>
        </div>
      </div>

      <footer>{state.sync.detail}</footer>
    </main>
  );
}

function getLiveCounts(threads: FixtureThread[]) {
  const active = threads.filter((thread) => !thread.archived);
  return {
    total: active.length,
    needsReply: active.filter((thread) => thread.bucket === "needs_reply")
      .length,
    waiting: active.filter((thread) => thread.bucket === "waiting").length,
  };
}
