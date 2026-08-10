# Subzero Mail

Free, open-source, Gmail-first mail processing for one account. Subzero focuses on the high-frequency loop: see what matters, work from the keyboard, read a thread with source-backed context, draft a reply, send only when explicitly confirmed, and search with Gmail syntax. AI use is bring-your-own-key (BYOK).

This repository is an OSS MVP with the P0 release gate still open. Local P1 slices are implemented and tested, but they are not release-ready until P0 is proven against a real Gmail account. Treat [`docs/BUILD_STATUS.md`](docs/BUILD_STATUS.md) as the acceptance-status source of truth. A green local test run is not live Gmail/OAuth verification.

## Screenshots

**Pending:** no checked-in screenshot artifact exists yet. Add real, visually verified screenshots here after the visual QA gate; this placeholder is not product evidence.

## What Subzero does and does not do

- Gmail only. One connected Gmail account. Gmail remains the canonical mailbox state.
- Uses the Gmail API, never Gmail UI scraping or IMAP for v1.
- Uses deterministic logic before AI for obvious inbox state and routing.
- Supports BYOK providers: OpenAI-compatible APIs, Anthropic, and Google Gemini.
- Never permanently deletes mail. AI cannot invoke Gmail mutations or silently send mail.
- Does not ship Outlook, multiple accounts, native mobile apps, shared inboxes, CRM tools, bulk outreach, read receipts, a vector database, or a full mailbox mirror.

## Requirements

- Node.js `>=22.5.0` for local development.
- A Google Cloud OAuth web client and an authorized Gmail test user for live Gmail verification.
- A generated `SUBZERO_ENCRYPTION_KEY` for encrypted OAuth refresh tokens and provider keys.
- A provider key only when using AI features. Subzero does not supply or resell inference.
- Docker Desktop or a compatible Docker Engine only for the Docker path.

## Clean-checkout setup

```bash
git clone <your-fork-or-repository-url>
cd subzero-mail
npm ci
cp .env.example .env.local
```

Next.js loads `.env.local` for local development. Docker Compose reads `.env`, so copy the same values to `.env` when using the container path.

Generate the server master key locally. Keep it private; do not commit `.env` or `.env.local`.

```bash
openssl rand -base64 32
```

Set the result as `SUBZERO_ENCRYPTION_KEY` in `.env.local` (or `.env` for Docker). The application accepts a 32-byte base64/base64url value or a 64-character hex value.

### Configure Google OAuth

1. Create or select a Google Cloud project and enable the Gmail API for it.
2. Create a **Web application** OAuth client.
3. Configure the OAuth consent screen. Until public verification is complete, add the Gmail account you will use as an authorized test user.
4. Add this exact local redirect URI to the client:

   ```text
   http://localhost:3000/api/auth/google/callback
   ```

5. Set these values in `.env.local` (or `.env` for Docker):

   ```dotenv
   GOOGLE_CLIENT_ID=...
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REDIRECT_URI=http://localhost:3000/api/auth/google/callback
   ```

For a self-hosted domain, replace the URI in both Google Cloud and `GOOGLE_REDIRECT_URI` with the same absolute callback URL, for example `https://mail.example.com/api/auth/google/callback`.

Subzero requests `https://www.googleapis.com/auth/gmail.modify` plus identity scopes. Gmail read/modify access is a restricted Google scope. Public, unrestricted hosted distribution may require Google verification; that verification is not required for the first OSS self-host/test-user release.

### Configure BYOK

After Gmail is connected, open Settings and choose a provider, model, and your provider key. The supported runtime choices are:

- OpenAI-compatible API
- Anthropic
- Google Gemini

Settings supports key save, connection test, configured/not-configured status, and removal. Stored keys are encrypted; the complete saved key is not shown again.

`.env.example` also lists `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, and `GOOGLE_GENERATIVE_AI_API_KEY` as optional server-side defaults. The per-user release path is runtime BYOK in Settings. Never put a secret in a `NEXT_PUBLIC_*` variable.

### Start locally

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000), then use **Connect Gmail**. The OAuth start endpoint is `GET /api/auth/google`; a missing OAuth configuration returns a safe `oauth_not_configured` response instead of exposing credentials.

For fixture-backed local exploration only, set both demo flags in `.env.local` to `true`:

```dotenv
NEXT_PUBLIC_SUBZERO_DEMO_MODE=true
SUBZERO_DEMO_MODE=true
```

Demo mode is not a live Gmail test and must not be used to claim OAuth, Gmail mutation, or provider verification.

## Docker self-hosting

1. Complete the `.env` configuration above. `SUBZERO_ENCRYPTION_KEY` and the Google OAuth values are required for live Gmail OAuth.
2. For a deployed origin, update `GOOGLE_REDIRECT_URI` and the Google OAuth redirect URI together.
3. Build and start the service:

   ```bash
   docker compose up --build -d
   ```

4. Open [http://localhost:3000](http://localhost:3000), or your reverse-proxied origin.

The Compose service exposes port `3000` and persists the local database in the named `subzero-data` volume at `/app/data/subzero.db`. Treat the host, the Docker volume, `.env`, and the master key as sensitive. Back up the volume intentionally; no backup or key-rotation workflow is implemented here.

If port `3000` is already in use, set `SUBZERO_PORT` in `.env` to another host port (the container still listens on `3000`).

Stop the service with:

```bash
docker compose down
```

## Data and privacy model

| Data                              | Where it lives     | Notes                                                                                                                                                                       |
| --------------------------------- | ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Gmail mailbox state               | Gmail              | Canonical source of truth. Local conflicts refresh from Gmail.                                                                                                              |
| OAuth refresh token               | Local SQLite store | Encrypted with authenticated encryption using `SUBZERO_ENCRYPTION_KEY`.                                                                                                     |
| BYOK provider key                 | Local SQLite store | Encrypted at rest; decrypted only immediately before a provider call.                                                                                                       |
| Thread cache                      | Local SQLite store | Metadata, labels, derived triage, and summaries. Full raw message bodies are not persisted there by default.                                                                |
| Recently opened messages/UI state | Browser IndexedDB  | Local client cache for responsiveness.                                                                                                                                      |
| AI input                          | Chosen provider    | Scoped to the feature: current thread and intent for drafts; evidence-bounded input for supported semantic tasks. Unrelated mailbox history is not sent for reply drafting. |

Telemetry is off by default. Subzero does not collect message bodies, subjects, recipients, OAuth tokens, provider keys, or AI prompts for product analytics.

Read [the security model](docs/SECURITY.md) before exposing a self-hosted instance to other people.

## Feature matrix

Status labels below describe current documentation/build state, not a production release claim. PRD acceptance status lives in [`docs/BUILD_STATUS.md`](docs/BUILD_STATUS.md).

| Priority         | Capability                                                               | Status                                 | Notes                                                                                                                                                                                                                              |
| ---------------- | ------------------------------------------------------------------------ | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P0.1             | Gmail connect and recent metadata-first sync                             | In progress; live verification blocked | Google OAuth flow, one-account guard, pagination, lazy thread detail, and revoked-auth handling are implemented/tested against fixtures. Live validation needs configured credentials and a test mailbox.                          |
| P0.2             | Fast inbox shell and Gmail mutations                                     | In progress                            | Dense three-zone workflow, cache, archive/read/unread/label API contracts, and recoverable mutation responses exist. End-to-end live Gmail verification remains open.                                                              |
| P0.3             | Keyboard-first workflow                                                  | In progress                            | Core inbox shortcuts and visible focus are implemented; cross-browser release acceptance remains open.                                                                                                                             |
| P0.4             | Priority / Focus Views                                                   | In progress                            | Deterministic-first triage and schema-validated AI contracts are present; labeled-evaluation acceptance remains open.                                                                                                              |
| P0.5             | Evidence-backed thread summaries                                         | In progress                            | Summary schema and source IDs exist. Cache invalidation and live-provider acceptance remain open.                                                                                                                                  |
| P0.6             | Compose, reply, reply-all, explicit send                                 | In progress                            | Gmail draft/send API contracts and explicit-send confirmation exist. Live Gmail acceptance remains open.                                                                                                                           |
| P0.7             | AI reply drafting                                                        | In progress                            | Provider-neutral draft contracts and failure handling exist. Live BYOK provider validation remains open.                                                                                                                           |
| P0.8             | Gmail search and command palette                                         | In progress                            | Gmail-style query pass-through and keyboard palette behavior exist; live Gmail search acceptance remains open.                                                                                                                     |
| P0 cross-cutting | BYOK, secret handling, safe email rendering                              | In progress                            | Provider-key save/test/remove, encryption, redaction, sanitization, and remote-image controls exist. Live acceptance remains open.                                                                                                 |
| P1.1             | Ask Inbox                                                                | Implemented locally; release-blocked   | Bounded Gmail-query retrieval, evidence/source chips, and an explicit no-evidence state are covered by unit/integration tests and Chrome/WebKit demo acceptance tests. Live Gmail/provider validation and the P0 gate remain open. |
| P1.2             | Open Loops                                                               | Implemented locally; release-blocked   | Source-backed deterministic extraction, deduplication, edit/resolve flows, and low-confidence suggestion handling are covered by unit/integration tests and Chrome/WebKit demo acceptance tests. P1 release remains behind P0.     |
| P1.3             | Voice Profile                                                            | Implemented locally; release-blocked   | Explicit opt-in, bounded sent-mail sampling, compact editable/resettable profile, and no raw-sample persistence are covered locally. Live Gmail/provider validation and the P0 gate remain open.                                   |
| P1.4             | Custom Focus rules                                                       | Implemented locally; release-blocked   | Inspectable deterministic rules, account scoping, validation/de-duplication, and Focus application are covered by unit/integration tests and Chrome/WebKit demo acceptance tests. P1 release remains behind P0.                    |
| P1.5             | Snooze                                                                   | Cut / deferred                         | Not implemented in this release; Gmail snooze semantics are not a low-cost slice, and no fragile substitute is shipped.                                                                                                            |
| P2               | Quick replies, snippets, auto-archive, receipts, local models/embeddings | Deferred                               | PRD requires P0/P1 stability first.                                                                                                                                                                                                |

## Known limitations and blockers

- Live Gmail/OAuth credentials are configured locally; acceptance still needs browser authorization with an authorized Gmail test user and a callback port that is free and matches `GOOGLE_REDIRECT_URI`.
- A public hosted OAuth rollout may need Google restricted-scope verification. The first OSS release may target developers, self-hosters, and explicitly configured test users instead.
- Live AI acceptance needs a user-owned provider key and provider quota. No provider key is currently configured, requested, printed, or committed by this project.
- One Gmail account only. No Outlook, generic IMAP, multi-account, native mobile, shared inbox, or enterprise-admin support.
- Local evidence: 18 Vitest files and 77/77 tests pass; typecheck, a clean production build, formatting, Chrome/WebKit 13/13 E2E, and 10 consecutive Chrome smoke runs pass. This does not prove live Gmail/provider behavior.
- Firefox was attempted but the bundled browser could not create a usable tab on this macOS runner (`MachCheckInListener TimedOut`). WebKit passes 13/13. Edge is opt-in (`SUBZERO_INCLUDE_EDGE=true`) and requires an installed system Edge binary; no Edge result is claimed.
- The production E2E command rebuilds the Next artifact before serving. Keep `.next` isolated from overlapping builds; stale/concurrent output can cause ENOENT failures even when a clean build passes.
- Docker Compose syntax, image build, and an isolated demo container health check pass. Live container Gmail/OAuth is not claimed. The Docker path requires a configured `.env`, OAuth test user, encryption key, and optional BYOK key, and persists SQLite in the `subzero-data` volume.
- A clean clone installs and builds successfully. `npm audit --omit=dev` currently reports 7 transitive advisories (3 high, 4 moderate) in Next/PostCSS, sharp, and googleapis/uuid; the available fix requires breaking upgrades and has not been forced into this release.
- P1 and P2 are not release-ready. Do not treat demo data or fixture-backed tests as proof of production behavior.
- Screenshot artifacts are pending.

## Development and contribution

Run the smallest relevant gate first, then the broader gate before a handoff:

```bash
# TypeScript
npm run typecheck

# Unit and integration tests
npm test
npm run test:integration

# Browser tests
npm run test:e2e
npm run test:smoke

# Full release gate
npm run test:all

# Formatting check
npm run format:check
```

Keep changes mapped to PRD IDs, add tests with each vertical slice, and update `docs/BUILD_STATUS.md` only with evidence for the corresponding acceptance criteria. Preserve the boundaries in [`docs/PRD.md`](docs/PRD.md): P0 before P1, P2 only after P0/P1 stability, Gmail API only, and no autonomous send.

Useful project references:

- [Product requirements](docs/PRD.md)
- [Build status](docs/BUILD_STATUS.md)
- [Architecture](docs/ARCHITECTURE.md)
- [Security model](docs/SECURITY.md)
- [MIT License](LICENSE)
