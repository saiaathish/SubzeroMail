import { ExternalLink, Pencil, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useState } from "react";

import { getDemoCounts, type FixtureThread } from "../fixtures";
import { sendExtensionMessage } from "../runtime";
import {
  DEFAULT_EXTENSION_STATE,
  type ExtensionState,
  type SubzeroExperience,
} from "../types";

export function Popup() {
  const [state, setState] = useState<ExtensionState>(DEFAULT_EXTENSION_STATE);
  const [counts, setCounts] = useState({ total: 0, needsReply: 0, waiting: 0 });
  const [busy, setBusy] = useState(false);
  const [experience, setExperience] = useState<SubzeroExperience>("both");

  useEffect(() => {
    void Promise.all([
      sendExtensionMessage<ExtensionState>({ type: "app/get-state" }),
      sendExtensionMessage<FixtureThread[]>({ type: "mail/get-threads" }),
    ]).then(([stateResponse, threadsResponse]) => {
      if (stateResponse.ok && stateResponse.data) setState(stateResponse.data);
      if (threadsResponse.ok && threadsResponse.data) {
        setCounts(getDemoCounts(threadsResponse.data));
      }
    });
  }, []);

  useEffect(() => {
    setExperience(state.preferences.experience);
  }, [state.preferences.experience]);

  async function finishOnboarding() {
    setBusy(true);
    const response = await sendExtensionMessage<ExtensionState>({
      type: "settings/update-preferences",
      preferences: { experience, onboardingComplete: true },
    });
    if (response.ok && response.data) setState(response.data);
    setBusy(false);
  }

  async function openApp() {
    setBusy(true);
    await sendExtensionMessage({ type: "app/open" });
    window.close();
  }

  async function refresh() {
    setBusy(true);
    const response = await sendExtensionMessage<ExtensionState>({
      type: state.account.mode === "connected" ? "mail/sync" : "app/sync-demo",
    });
    if (response.ok && response.data && "theme" in response.data) {
      setState(response.data);
    }
    const threads = await sendExtensionMessage<FixtureThread[]>({
      type: "mail/get-threads",
    });
    if (threads.ok && threads.data) setCounts(getDemoCounts(threads.data));
    setBusy(false);
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
        <section className="sz-onboarding__intro">
          <p className="sz-onboarding__eyebrow">WELCOME TO SUBZERO</p>
          <h1>Keep Gmail. Add the power layer.</h1>
          <p>
            Choose where Subzero should meet you. You can change this later in
            Gmail preferences.
          </p>
        </section>
        <fieldset className="sz-onboarding__choices">
          <legend>How do you want to use Subzero?</legend>
          {[
            [
              "gmail-only",
              "Enhance Gmail",
              "Use Gmail normally with Subzero built in.",
            ],
            [
              "standalone-only",
              "Use Subzero",
              "Open the full keyboard-first client.",
            ],
            ["both", "Both", "Gmail enhancements plus the full client."],
          ].map(([value, label, description]) => (
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
              <span>
                <strong>
                  {label}
                  {value === "both" ? " · recommended" : ""}
                </strong>
                <small>{description}</small>
              </span>
            </label>
          ))}
        </fieldset>
        <div className="sz-onboarding__footer">
          <p>
            AI is optional. Continue now and connect a provider later from
            settings when you want summaries or drafting.
          </p>
          <button
            className="sz-popup__primary"
            type="button"
            onClick={() => void finishOnboarding()}
            disabled={busy}
          >
            {busy ? "Saving…" : "Continue"}
          </button>
        </div>
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
          {state.sync.status === "demo" ? "Demo" : "Ready"}
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
