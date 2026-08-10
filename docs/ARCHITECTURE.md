# Architecture

Subzero Mail is a Gmail-first, single-account Next.js application. It keeps Gmail as the canonical mailbox and stores only the minimum local state needed for speed, encrypted credentials, and derived features. It is not a Gmail mirror or a multi-tenant mail platform.

## System shape

```text
Browser (Next.js / React)
  ├─ Inbox UI, keyboard workflow, compose, settings
  └─ IndexedDB/Dexie cache
       ├─ recent thread metadata
       ├─ recently opened thread bodies
       ├─ UI state
       └─ cached summaries

Next.js route handlers (Node runtime)
  ├─ Google OAuth start/callback and trusted account resolution
  ├─ Gmail mail API routes
  └─ Provider-key settings route
       │
       ├─ Gmail API: metadata-first list/search, lazy full thread fetch,
       │  archive/read/unread/labels/drafts/send
       ├─ Local SQLite-compatible store: encrypted refresh tokens/keys,
       │  thread metadata, triage, summaries, settings, future P1 state
       └─ Provider-neutral AI layer: OpenAI-compatible, Anthropic, Gemini

External systems
  ├─ Google OAuth and Gmail API
  └─ User-selected AI provider (BYOK)
```

## Request and trust flow

1. The browser starts OAuth at `GET /api/auth/google`.
2. Google returns to `/api/auth/google/callback`. The callback verifies OAuth state, checks for the requested Gmail scope, encrypts the refresh token, and stores one account record.
3. The callback writes HttpOnly cookies for the short-lived OAuth state flow and the local Subzero account identifier. The cookie holds an account ID, not an OAuth token.
4. Mail routes resolve that account server-side, reload the encrypted refresh token from the local store, and bind a `GmailMailProvider` to the same account. A request cannot choose an arbitrary Gmail account ID.
5. The provider reads Gmail metadata first. Full thread content is fetched only when a thread is opened. Gmail mutations go through the Gmail API and return a confirmation or a client-reconciliation signal for optimistic UI state.

If OAuth is missing, revoked, misconfigured, or lacks the required scope, routes return recoverable errors or redirect back with a safe reason. They do not return OAuth tokens or provider keys.

## Mail API surface

The application routes are account-gated. Their responses use safe JSON and do not forward Gmail/OAuth payloads.

| Route                                                | Purpose                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| `GET /api/mail/threads?limit=&pageToken=&label=`     | Recent metadata-first thread page. The provider defaults to 200 recent threads. |
| `GET /api/mail/threads/:threadId`                    | Lazy full-thread detail.                                                        |
| `GET /api/mail/search?q=`                            | Gmail query pass-through. Subzero does not reimplement Gmail search grammar.    |
| `POST /api/mail/threads/:threadId/archive`           | Remove `INBOX` through Gmail.                                                   |
| `POST /api/mail/threads/:threadId/read`              | Mark read.                                                                      |
| `POST /api/mail/threads/:threadId/unread`            | Mark unread.                                                                    |
| `POST` / `DELETE /api/mail/threads/:threadId/labels` | Apply or remove a Gmail label with `{ "labelId": "..." }`.                      |
| `POST /api/mail/drafts`                              | Create a Gmail draft.                                                           |
| `POST /api/mail/drafts/:draftId/send`                | Send a draft only with `{ "confirm": true }`.                                   |

Mutation failures return `mutation.state: "reconcile"`. The UI must roll back or refresh optimistic archive/read/label state from Gmail rather than treating local state as authoritative.

## AI boundary

AI handles ambiguous semantic work only: triage fallback, summaries, action/deadline extraction, and reply drafts. Basic mailbox state, navigation, Gmail query execution, obvious newsletter detection, and Gmail mutations stay deterministic.

The AI interface is provider-neutral and validates structured output before it reaches the UI. For P0, the supported provider adapters are OpenAI-compatible, Anthropic, and Gemini. A provider key is user-supplied and is decrypted only immediately before a provider call.

AI output is a suggestion. It cannot invoke Gmail APIs. The send route requires explicit confirmation even after a user accepts or edits an AI draft.

## Persistence and cache boundary

| Store           | Holds                                                                                                              | Does not hold by default |
| --------------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------ |
| Gmail           | Canonical threads, labels, drafts, sent mail                                                                       | Local-only derived state |
| Local database  | Encrypted refresh tokens and provider keys; account metadata; thread metadata; labels; triage; summaries; settings | Full raw thread bodies   |
| IndexedDB/Dexie | Recent metadata, opened bodies, UI state, cached summaries                                                         | Server credentials       |

The default local database path is `./data/subzero.db`; Docker maps it to `/app/data/subzero.db` in the named `subzero-data` volume. The implementation uses a SQLite-compatible local store with a schema kept portable for later Postgres work.

## P0 boundaries

- One Gmail account only.
- Gmail API only. No Gmail scraping or IMAP path.
- No full mailbox mirror, permanent delete, autonomous send, vector database, or microservice stack.
- Remote email HTML is untrusted and passes through the security sanitizer before rendering.
- Gmail wins on conflict. Local cache or optimistic state is refreshed/reconciled on failure.

## Current integration status

Route, adapter, storage, security, and fixture-backed test layers are present. Live acceptance still needs a configured Google OAuth client, matching redirect URI, authorized Gmail test mailbox, and a user-owned AI provider key. See [`BUILD_STATUS.md`](BUILD_STATUS.md) for acceptance evidence and blockers; do not infer live readiness from fixture-backed behavior.
