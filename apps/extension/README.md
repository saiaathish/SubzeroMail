# Subzero Mail extension

WXT + React + TypeScript MV3 client. The action opens a useful popup; its
primary action opens/focuses the full-page `app.html` client. A scoped
`https://mail.google.com/*` content script adds restrained Shadow DOM controls,
and the Side Panel provides the deeper intelligence rail. Gmail DOM is used
only for placement/context; Gmail API calls and mailbox mutations stay in the
background worker after user-initiated Chrome identity authorization.

## Local commands

Run these from the repository root:

```bash
# Install all workspace dependencies from the lockfile.
npm ci

# Run WXT with extension HMR.
PATH="/opt/homebrew/bin:/Users/saiaathishkarthik/.local/bin:$PATH" npm run extension:dev

# Build the Chrome MV3 output.
PATH="/opt/homebrew/bin:/Users/saiaathishkarthik/.local/bin:$PATH" npm run extension:build

# Create a distributable zip.
PATH="/opt/homebrew/bin:/Users/saiaathishkarthik/.local/bin:$PATH" npm run extension:zip

# Type-check only the extension.
PATH="/opt/homebrew/bin:/Users/saiaathishkarthik/.local/bin:$PATH" npm run typecheck --workspace=@subzero/extension
```

Load the generated Chrome directory from `.output/chrome-mv3` using `chrome://extensions`, with Developer mode enabled. The generated manifest is MV3 and requests `identity`, `storage`, `alarms`, `permissions`, `sidePanel`, and `notifications`, plus the narrow Gmail API host permission and scoped Gmail page access. AI provider origins are optional and requested only after a user approves a provider in the settings dialog. `tabs` and `scripting` are not requested.

## What works locally

- The full-page extension shell opens from the popup and keeps the existing tab focused when possible.
- First launch opens onboarding in the popup, then starts interactive Google authorization from `Continue with Google`.
- The full-page client and Side Panel remain connection-gated until live Gmail access succeeds; no fixture inbox is shown to users.
- After connection, the popup exposes Open Subzero, Quick compose, refresh, account status, sync status, and live thread count.
- `Cmd/Ctrl+K`, `J`, `K`, `Enter`, `E`, `U`, `R`, `C`, `/`, and `Escape` are wired in the shell.
- Live Gmail sync uses `chrome.identity.getAuthToken`, Gmail metadata endpoints, IndexedDB caching, and bounded archive/read mutations. The dedicated extension OAuth client is configured in `apps/extension/wxt.config.ts`; fixture helpers remain only for isolated tests.
- Archive/read actions update the local view optimistically and restore the row when Gmail rejects the mutation.
- Selected Gmail HTML is sanitized in the browser-safe security boundary before rendering; remote images remain an explicit sender-controlled network risk.
- Thread summaries and intent-based drafts use the shared `@subzero/ai` schema boundary with a deterministic local fallback; send still requires an explicit click.
- Ask Inbox retrieves a bounded local evidence set and renders source chips that open the originating thread.
- Open Loops are detected from explicit requests/promises, stored in IndexedDB, resolved locally, and resurfaced through `chrome.alarms` reminders.
- BYOK settings support OpenAI-compatible custom Base URLs, Anthropic, and Gemini. API keys are session-only in the background worker and never go through Chrome sync or local settings.
- Light/dark theme state is persisted through `chrome.storage.local` when available and does not replace account state.
- Chrome storage and alarms have an in-memory fallback for isolated tests outside an extension runtime.
- Gmail embedded mode mounts one idempotent Shadow DOM action cluster per open thread, an inline summary surface, compose drafting action, quick command palette, focus signals, and an `Open in Subzero` escape hatch. A Gmail SPA observer reports route/compose context to the background worker.
- The Side Panel exposes `Now`, `Ask`, `Open Loops`, source chips, current-thread continuity, Gmail preferences, and theme controls. Reminder alarms can create actionable Chrome notifications when the runtime grants notification support.

## Manual OAuth boundary

The UI starts `chrome.identity.getAuthToken({ interactive: true })` when the
user chooses `Continue with Google` during onboarding or from the connection
gate. The token remains in Chrome's identity cache and is used by the worker
for Gmail API calls; it is not written to `chrome.storage` or IndexedDB. The manifest contains the dedicated Google
extension client ID
`542024114315-24dh9eo654fjs59on3i5dgosfaooulen.apps.googleusercontent.com`.
Verify the consent/restricted-scope flow manually before release.

A future integration must provide a short-lived authorization URL from a server-owned flow, pass it to the typed `oauth/start` message, validate the returned redirect, and complete token exchange outside this extension scaffold. Do not put credentials in this package or in `chrome.storage.local`.

## Live/manual gaps

- UNKNOWN: consent configuration and restricted-scope review for the configured Google extension client.
- UNKNOWN: clean-profile Gmail authorization, HTML/body/search/mutation behavior, revoke/logout, cache deletion, and live sync evidence.
- UNKNOWN: live Gmail DOM selector stability, real Gmail content-script rendering, side-panel context sync in a clean Chrome profile, and manual dark/light Gmail verification. Local fixture/unit proof exists; these are not live Gmail claims.
- UNKNOWN: live provider/network behavior, provider-side retention, quotas, and user-approved optional host permission behavior for each selected provider.
- PASS (draft): the Chrome Web Store listing has a public GitHub privacy-policy
  URL, configured support URL, reviewer instructions, a 128x128 icon, and three
  fresh 1280x800 extension screenshots saved in the draft. UNKNOWN: release
  signing key, final live verification, and Chrome Web Store review.
- UNCERTAIN: whether future OAuth should remain direct Gmail API access or use a server relay; current code uses direct Gmail API access.
