import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy | Subzero Mail",
  description:
    "How the current Subzero Mail web app handles Gmail and AI data.",
};

const sectionStyle = {
  lineHeight: 1.65,
  color: "var(--muted)",
};

const listStyle = {
  ...sectionStyle,
  paddingLeft: "1.25rem",
};

export default function PrivacyPage() {
  return (
    <main className="settings-page" aria-labelledby="privacy-title">
      <header className="settings-page-head">
        <div>
          <p className="nav-label">Subzero Mail / Privacy</p>
          <h1 id="privacy-title">Privacy, in plain language.</h1>
          <p>
            This page describes the current web app and local Chrome extension
            boundaries. Gmail remains the source of truth; public OAuth and
            Chrome Web Store approval are separate manual gates.
          </p>
        </div>
        <a className="secondary-button voice-back-link" href="/">
          Back to Subzero Mail
        </a>
      </header>

      <section className="settings-card" aria-labelledby="data-title">
        <h2 id="data-title">What the web app handles</h2>
        <p style={sectionStyle}>
          Subzero Mail is a single-account, Gmail-first client. Its current
          Google OAuth request uses the Gmail read/modify scope plus the
          identity scopes below:
        </p>
        <ul style={listStyle}>
          <li>
            <code>https://www.googleapis.com/auth/gmail.modify</code>
          </li>
          <li>
            <code>openid</code>, <code>email</code>, and <code>profile</code>
          </li>
        </ul>
        <p style={sectionStyle}>
          That access supports the connected mailbox workflow: showing recent
          threads, reading messages, searching, changing mailbox labels and read
          state, archiving, and creating or sending a draft only after an
          explicit confirmation.
        </p>
      </section>

      <section className="settings-card" aria-labelledby="storage-title">
        <h2 id="storage-title">Storage and retention</h2>
        <ul style={listStyle}>
          <li>
            Gmail remains authoritative. The local server stores encrypted OAuth
            refresh-token data, provider keys, thread metadata, labels, derived
            triage and summaries, Open Loops, settings, and draft-related state.
            Full raw message bodies are not copied into the thread cache by
            default.
          </li>
          <li>
            The browser uses IndexedDB for recent thread/UI cache data,
            including recently opened bodies. Theme and demo state use browser
            local storage.
          </li>
          <li>
            There is no general automatic deletion schedule or account-deletion
            endpoint evidenced in the current web app. Self-host operators
            control the local database, Docker volume, backups, and encryption
            key.
          </li>
        </ul>
      </section>

      <section className="settings-card" aria-labelledby="ai-title">
        <h2 id="ai-title">AI providers</h2>
        <p style={sectionStyle}>
          AI features are bring-your-own-key. The current web app supports
          OpenAI-compatible APIs, Anthropic, and Gemini. When you invoke an AI
          feature, the selected provider can receive the current thread or a
          bounded evidence set needed for that feature. Ask Inbox does not send
          a complete mailbox or raw HTML to the provider.
        </p>
        <p style={sectionStyle}>
          The provider controls its own logging and retention. Review the
          provider&apos;s terms before sending email content. Provider keys are
          encrypted locally and can be removed from BYOK Settings.
        </p>
      </section>

      <section className="settings-card" aria-labelledby="extension-title">
        <h2 id="extension-title">Chrome extension boundary</h2>
        <p style={sectionStyle}>
          The local MV3 extension requests Chrome identity, storage, alarms, and
          optional-permission APIs plus the narrow Gmail API origin. Provider
          origins are requested only after a visible BYOK settings action. It
          does not scrape Gmail pages or request broad website access. Recent
          thread metadata and sync cursors use IndexedDB; small theme/account
          settings use chrome.storage.local. Chrome&apos;s identity token cache
          holds the access token; Subzero does not copy it into extension
          storage.
        </p>
        <p style={sectionStyle}>
          The extension still needs a dedicated Google OAuth client, restricted
          scope review, a public HTTPS privacy URL, and clean-profile
          sign-out/revoke/deletion verification before public distribution.
        </p>
      </section>

      <section className="settings-card" aria-labelledby="content-title">
        <h2 id="content-title">Email HTML and remote images</h2>
        <p style={sectionStyle}>
          Email is untrusted input. The current sanitizer removes scripts, event
          handlers, forms, unsafe URLs, and other active content. It permits
          sanitized remote image URLs with lazy loading and a no-referrer
          policy, so a browser may contact an image host when an email image is
          rendered. The extension fetches selected Gmail thread bodies on demand
          and uses the browser-safe sanitizer before rendering them; remote
          images remain a sender-controlled network request risk.
        </p>
      </section>

      <section className="settings-card" aria-labelledby="controls-title">
        <h2 id="controls-title">Sign out, revoke, and delete</h2>
        <ul style={listStyle}>
          <li>
            Web sign out clears the local account cookie and the browser thread
            cache. It does not revoke Google access or delete server data.
          </li>
          <li>
            Revoke Gmail access from the Google account&apos;s connected-app
            controls. Subzero does not permanently delete Gmail mail.
          </li>
          <li>
            Remove web provider keys in BYOK Settings. Extension BYOK keys are
            session-only and are cleared on sign out or worker restart.
          </li>
          <li>
            Clear browser site data to remove IndexedDB and local-storage data.
            No general server account-deletion flow is currently evidenced.
          </li>
        </ul>
      </section>

      <section className="settings-card" aria-labelledby="analytics-title">
        <h2 id="analytics-title">Analytics and extension status</h2>
        <p style={sectionStyle}>
          Telemetry is off by default. The current product does not collect
          message bodies, subjects, recipients, OAuth tokens, provider keys, or
          AI prompts for product analytics.
        </p>
        <p style={sectionStyle}>
          The local extension package, MV3 build, popup, icons, Gmail adapter,
          local AI/P1 surfaces, and Chromium fixture suite exist. Do not use
          this page as proof of live Gmail OAuth, provider-network behavior,
          restricted-scope approval, or Chrome Web Store publication.
        </p>
      </section>

      <footer>
        <p className="progress">Last reviewed: 2026-08-11.</p>
      </footer>
    </main>
  );
}
