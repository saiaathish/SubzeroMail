# Subzero Mail privacy

**Status: PARTIAL (web + local extension policy; public release review pending)**

Last reviewed: 2026-08-11.

This document describes the current web application and the local WXT MV3
extension. It is not evidence of Chrome Web Store approval, Google OAuth
verification, or a public privacy URL.

## What Subzero Mail is

Subzero Mail is a Gmail-first, single-account web client. Gmail remains the
canonical mailbox. The current web OAuth implementation requests these Google
scopes:

```text
https://www.googleapis.com/auth/gmail.modify
openid
email
profile
```

`gmail.modify` is used for the Gmail read/modify workflow. It is a restricted
Google scope; public distribution may require Google's current verification
process. The repository contains web-client evidence, not extension approval
evidence.

## Data the current web app handles

| Data                                   | Why it is handled                                                                                | Where it is stored or sent                                                                                                                                                                                  | Retention/deletion boundary                                                                                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Google identity and Gmail mailbox data | Sign in, show threads, search, read, label, archive, draft, and send after explicit confirmation | Gmail remains authoritative. The app fetches data through the Gmail API.                                                                                                                                    | No general automatic deletion schedule is implemented. Gmail mail is not deleted by Subzero.                                                                          |
| OAuth refresh token                    | Keep the connected Gmail session working                                                         | Encrypted in the local server SQLite database; not stored in browser storage by the current web flow                                                                                                        | Sign out clears the session cookie, but does not revoke Google access or delete the local database row. Revoke access in the Google account's connected-app controls. |
| Thread metadata and derived state      | Fast inbox rendering, triage, summaries, Open Loops, and drafts                                  | Local server SQLite stores metadata, labels, identifiers, derived triage/summaries, Open Loops, settings, and draft-related state. Full raw message bodies are not copied into the thread cache by default. | Operator-controlled local database/volume. No general expiry or account-delete route is evidenced.                                                                    |
| Recently opened mail and UI cache      | Make the browser inbox responsive                                                                | Browser IndexedDB stores recent thread data, UI state, cached summaries, and recently opened bodies. Theme and demo flags use browser local storage.                                                        | Sign out clears the browser thread cache. Clearing site data removes browser storage. This does not delete Gmail or server data.                                      |
| Provider key                           | Call the user's selected AI provider                                                             | Encrypted in the local server database and decrypted immediately before a provider operation.                                                                                                               | The Settings flow can remove a provider key. No claim of provider-side deletion is made.                                                                              |
| AI input and output                    | User-requested triage, summaries, drafts, Open Loops, or Ask Inbox                               | The selected provider receives the current-thread or bounded evidence input required by the invoked feature. Derived output may be cached locally.                                                          | Provider retention is controlled by that provider's terms and settings, not by Subzero. Review the provider policy before sending mail content.                       |
| Voice Profile                          | Optional user-requested drafting assistance                                                      | A compact profile is stored locally when the user opts in; raw sampled messages are not intended to be persisted.                                                                                           | The current Settings flow supports reset/removal. Provider-side deletion is not claimed.                                                                              |

## Extension-local boundary

The extension requests `identity`, `storage`, `alarms`, and `permissions`, plus
the narrow Gmail API origin `https://gmail.googleapis.com/*`. AI provider
origins are optional and requested only from the visible BYOK settings gesture
for the origin the user selected. It does not request `<all_urls>`, Gmail page
access, browsing history, `scripting`, or `cookies`. The full-page client and
popup use bundled executable code only.

Gmail remains canonical. The extension stores recent thread metadata and sync
cursors in IndexedDB, and small UI/account settings in `chrome.storage.local`.
Temporary OAuth access tokens stay in Chrome's identity token cache; Subzero
does not copy them into IndexedDB or Chrome storage. Logout/cache-clear
behavior remains a release test gate.

## Provider transmission

Subzero supports OpenAI-compatible APIs with a custom base URL, Anthropic, and
Gemini in the extension and web code. The user chooses the provider, supplies
the key, and pays the provider directly. Extension keys are session-only in the
background worker: they are not persisted in `chrome.storage`, IndexedDB, or
Chrome sync, and are cleared on sign out or worker restart. Subzero does not
claim to control a provider's logging, training, human review, or retention. A
provider may receive email text and thread context when the user invokes an AI
feature. Ask Inbox uses a bounded evidence set and does not send a complete
mailbox or raw HTML to the provider.

AI output is validated and remains a suggestion layer. It cannot call Gmail
mutation APIs, and sending requires an explicit confirmation.

## HTML email and remote images

The current web app treats email HTML as untrusted input. The sanitizer removes
scripts, event handlers, forms, unsafe URLs, and other active content. It keeps
safe layout styles and sanitizes `http`/`https` image URLs with lazy loading and
`no-referrer`.

The current sanitizer permits sanitized remote image URLs; the
`allowRemoteImages` option is compatibility-only in the current source. A
browser can therefore contact an image host when an email image is rendered.
Do not describe the current web app as blocking all remote images. The visible
**Load images** control is not proof of default network blocking. Extension
The extension fetches selected Gmail thread bodies on demand, sanitizes them
with the browser-safe `@subzero/security/client` surface, and renders the
sanitized result. Remote image URLs remain permitted after sanitization and
are loaded with `loading="lazy"` and `referrerpolicy="no-referrer"`; this is a
sender-controlled network request risk, not a claim that all tracking images
are blocked. The demo also exercises an unsafe link fixture and verifies that
active URLs are removed.

## Sign out, revoke, and deletion controls

- **Web sign out:** the current `POST /api/auth/logout` route clears the local
  HttpOnly account cookie. The client also clears its IndexedDB thread cache.
- **Google access:** sign out does not revoke the Gmail grant. Revoke it from
  the Google account's connected-app controls.
- **Provider keys:** remove a configured key from BYOK Settings.
- **Voice Profile:** use its reset/remove control when the profile is no longer
  wanted.
- **Browser data:** clear site data to remove local IndexedDB and local-storage
  values.
- **Server data:** no general account deletion endpoint, automatic retention
  expiry, backup deletion workflow, or key-rotation workflow is evidenced.
  Self-host operators must manage the local database, Docker volume, backups,
  and encryption key deliberately.
- **Gmail mail:** Subzero does not permanently delete mail in the current MVP.

## Analytics and sharing

Telemetry is off by default. The current product does not collect message
bodies, subjects, recipients, OAuth tokens, provider keys, or AI prompts for
product analytics. No advertising or sale of email data is evidenced in this
repository.

## Privacy contact

For privacy questions or requests about Subzero Mail, contact
`saiaathishk@gmail.com`.

## Chrome extension release status

The local extension package, MV3 build, icon set, popup, full-page client,
Gmail API adapter, local AI/P1 surfaces, and Chromium suite exist. The manifest
contains the dedicated Chrome Extension OAuth client ID. Live Gmail OAuth,
provider-network behavior, revoke/sign-out/deletion verification,
restricted-scope approval, public HTTPS hosting, and store review remain
manual blockers. Do not describe the extension as publicly available.

The public web policy route is [`/privacy`](../apps/web/app/privacy/page.tsx).
The repository does not currently evidence a fixed public deployment origin;
the privacy contact is `saiaathishk@gmail.com`.
