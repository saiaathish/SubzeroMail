# Security model

Subzero Mail handles email, OAuth credentials, and provider keys. Treat a self-hosted instance as sensitive infrastructure. This document describes the implemented boundaries and the limits that remain before a public hosted rollout.

## Security goals and non-goals

### Goals

- Keep Gmail OAuth refresh tokens and BYOK provider keys out of browser storage and logs.
- Bind each mail request to one trusted, server-resolved Gmail account.
- Treat email HTML and email text as untrusted input.
- Keep AI as a suggestion layer. AI cannot call Gmail mutation APIs or send mail.
- Require an explicit send confirmation after draft creation or AI drafting.
- Minimize local retention: Gmail remains canonical; the server does not persist full raw message bodies in its thread cache by default.

### Non-goals and current limits

- Subzero is not an end-to-end encrypted email system. Gmail and the selected AI provider necessarily receive the data required for their respective operations.
- Local-model support is P2, not a current privacy substitute for a remote BYOK provider.
- The first OSS release is intended for self-hosters and explicitly configured OAuth test users. It is not evidence of public Google restricted-scope verification.
- The current account cookie is an HttpOnly local account identifier for the single-account design, not a complete hosted multi-user identity platform. Do not expose this build as a multi-tenant service without a hardened authentication and session design.
- Backup encryption, automated key rotation, and a security-report intake workflow are not implemented in this repository.

## Secrets and encryption

`SUBZERO_ENCRYPTION_KEY` is the server master key. It must be a 32-byte base64/base64url value or a 64-character hex value. Generate it outside the repository, for example:

```bash
openssl rand -base64 32
```

The server uses AES-256-GCM authenticated encryption with a random IV and authentication tag for:

- Gmail OAuth refresh tokens
- BYOK provider keys

Plaintext is decrypted only immediately before the Gmail/provider operation that needs it. The master key is not stored alongside ciphertext. A missing, malformed, tampered, or wrong key produces a non-sensitive failure.

Keep `.env`, `SUBZERO_ENCRYPTION_KEY`, Docker volumes, database backups, and host-level access private. Do not put secrets in `NEXT_PUBLIC_*` environment variables, source files, issue reports, or screenshots.

## OAuth and account isolation

The Google OAuth flow requests `https://www.googleapis.com/auth/gmail.modify` plus `openid`, `email`, and `profile` identity scopes. It uses a random state value in an HttpOnly, `SameSite=Lax` cookie, validates it with a timing-safe comparison, and clears it after the callback.

On success, the application stores only the local Subzero account ID in the session cookie. The encrypted refresh token stays server-side. Mail routes reload that stored credential and bind the Gmail adapter to the same account. The v1 one-account guard rejects a second Google subject.

OAuth configuration failures, revoked authorization, missing refresh tokens, insufficient scope, and account conflicts return safe reconnect/error states. They must never be solved by printing or copying a token into logs.

## Email rendering and prompt injection

Email is data, not instructions.

- HTML is sanitized before rendering. Scripts, event handlers, forms, unsafe URLs, and active content are removed.
- Remote images are blocked by default. The UI may offer an explicit **Load images** action, which re-sanitizes the original content with that option enabled.
- If rendering/parsing fails, the product must retain a safe original-message reading path.
- Content such as “ignore prior instructions” is ordinary untrusted email text. It cannot grant mail-send, label, archive, or other Gmail tool authority to an AI provider.

## AI and BYOK privacy boundary

Users choose and pay their provider directly. The current supported adapters are OpenAI-compatible APIs, Anthropic, and Gemini. Provider configuration supports save, test, status, and remove flows after Gmail connection.

Subzero constrains AI inputs by feature. Reply drafting uses the current thread, user intent, and an optional lightweight voice profile when available; it does not send unrelated mailbox history. Evidence-backed features retain source message identifiers where practical. Providers can still process the content sent to them, so choose a provider whose terms and retention policy you accept.

Structured output is validated before use. AI output cannot invoke Gmail APIs. The explicit-send route requires `{ "confirm": true }` even after an AI draft is generated.

## Logs, telemetry, and error handling

Security helpers redact OAuth tokens, provider keys, authorization headers, and email-content fields from log-safe values. Mail route error responses avoid raw Gmail, OAuth, and provider payloads.

Telemetry is off by default. The product does not collect message bodies, subjects, recipients, provider keys, OAuth tokens, or AI prompts for analytics. If future anonymous analytics are added, they must be opt-in or clearly disclosed and content-free.

## Data retention

| Data class                         | Retention boundary                                                                                 |
| ---------------------------------- | -------------------------------------------------------------------------------------------------- |
| Gmail mail state                   | Gmail remains authoritative.                                                                       |
| OAuth refresh token / provider key | Encrypted local server database.                                                                   |
| Server thread cache                | Metadata, labels, derived triage, summaries, and identifiers; no full raw message body by default. |
| Browser cache                      | Recent metadata, UI state, cached summaries, and recently opened bodies in local IndexedDB.        |

Self-host operators control their host and database volume. Clearing browser storage removes that browser cache; it does not revoke Gmail OAuth or delete Gmail mail. To revoke the OAuth grant, remove Subzero Mail from the Google account’s connected-app access controls. Provider keys can be removed in Settings.

## Deployment checklist

Before a real Gmail test or self-hosted use:

1. Set a strong `SUBZERO_ENCRYPTION_KEY` outside version control.
2. Set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and a `GOOGLE_REDIRECT_URI` that exactly matches the Google OAuth client configuration.
3. Use HTTPS for non-local deployments so secure cookies are protected in transit.
4. Limit host and Docker-volume access to trusted operators.
5. Use an authorized Google OAuth test account until restricted-scope public verification is complete.
6. Add provider keys through Settings; never place them in browser-exposed variables.
7. Verify a revoked OAuth path, invalid provider-key path, malicious HTML email, and prompt-injection email before calling a deployment release-ready.

## Security status

Fixture-backed encryption, redaction, sanitizer, OAuth, and mail-route tests exist. Live OAuth, provider, and browser security acceptance still require user-controlled credentials and a real test mailbox. See [`BUILD_STATUS.md`](BUILD_STATUS.md) for the current evidence and blockers.
