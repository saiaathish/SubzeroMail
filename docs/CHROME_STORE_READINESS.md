# Chrome Web Store readiness

**Status: PARTIAL — local package/build PASS; public release BLOCKED**

This is an evidence ledger for the current Subzero Mail Chrome extension. It
proves local implementation and fixture-backed validation only. It is not
evidence of a published item, live Gmail OAuth, Google restricted-scope review,
or Chrome Web Store approval.

Last reviewed: 2026-08-11.

## Evidence boundary

| Gate                                   | Status                                         | Evidence and boundary                                                                                                                                                                                                                                                                                                                                                                                      |
| -------------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Web client Gmail/OAuth                 | PASS (web evidence)                            | The current web client requests `https://www.googleapis.com/auth/gmail.modify` plus `openid`, `email`, and `profile`. See [`oauth.ts`](../apps/web/app/api/auth/google/oauth.ts) and the existing live rows in [`BUILD_STATUS.md`](BUILD_STATUS.md).                                                                                                                                                       |
| Extension source package               | PASS (local)                                   | `apps/extension` contains WXT app/popup/background entrypoints, typed runtime messages, demo fixtures, and platform adapters.                                                                                                                                                                                                                                                                              |
| Extension manifest and permissions     | PASS (local)                                   | `npm run extension:build` emits MV3; `scripts/validate-extension.mjs` verifies `identity`, `storage`, `alarms`, `permissions`, `sidePanel`, `notifications`, the Gmail-only content-script match (`https://mail.google.com/*`), Gmail API host access, icons, popup, and no broad required permissions. Optional provider and loopback origins are requested from the visible BYOK settings flow.          |
| Extension ID                           | KNOWN (draft item) / MANUAL                    | Chrome Web Store draft item ID is `mdiopbbmnkdbkmkadcloadgbedfofdge`; release signing/verified-upload configuration and a published version remain unverified.                                                                                                                                                                                                                                             |
| Extension Google OAuth client          | CONFIGURED (external + local) / MANUAL         | Google Cloud has a dedicated `Subzero Mail Chrome Extension` client whose item ID is wired in `apps/extension/wxt.config.ts`; no secret is stored. Consent success, clean-profile authorization, and restricted-scope review remain unverified.                                                                                                                                                            |
| Single-purpose statement               | PARTIAL (draft)                                | A narrow store-purpose statement is drafted in [`CHROME_STORE_PERMISSION_JUSTIFICATION.md`](CHROME_STORE_PERMISSION_JUSTIFICATION.md). It becomes a product claim only after the extension implementation matches it.                                                                                                                                                                                      |
| Privacy disclosure                     | PARTIAL (repository policy; public URL MANUAL) | [`PRIVACY.md`](PRIVACY.md) documents the web and extension boundaries and includes the configured privacy contact. Final public HTTPS hosting, reachability, and the URL saved for store submission remain unverified; the web `/privacy` deployment origin is still not assigned.                                                                                                                         |
| Store listing                          | PARTIAL (saved draft; not submitted)           | Draft item `mdiopbbmnkdbkmkadcloadgbedfofdge` has the package, category/language, icon, three fresh MV3 screenshots, homepage/support links, reviewer instructions, and privacy/data disclosures saved. No review result is claimed.                                                                                                                                                                       |
| Google restricted-scope verification   | BLOCKED                                        | `gmail.modify` is a restricted Gmail scope. No current manual Google verification record for an extension distribution is present in the repository. Verify the current Google requirements before submission.                                                                                                                                                                                             |
| Local extension build/zip/browser test | PASS (local/demo)                              | `npm run extension:test` builds, validates the MV3 artifact, and passes 4 Chromium tests covering app/popup, P0 actions, P1 AI/Ask/Loops, and logout/theme. `npm run extension:zip` emits a reproducible zip.                                                                                                                                                                                              |
| Gmail embedded content script          | PASS (local/demo) / MANUAL (live)              | The content script matches only `https://mail.google.com/*`, observes Gmail SPA state, and mounts thread actions, inline summaries, compose drafting, quick replies, focus signals, and a command palette in Shadow DOM. Fixture/unit and Chromium evidence exists; real Gmail DOM resilience and no-breakage remain manual.                                                                               |
| Side Panel and reminder notifications  | PASS (local/demo) / MANUAL (live)              | The MV3 Side Panel contains Now, Ask, Open Loops, sources, preferences, and themes. `chrome.alarms` and `chrome.notifications` provide Open/Snooze/Resolve reminder actions. Local/fixture evidence exists; clean-profile Chrome behavior and real Gmail context remain manual.                                                                                                                            |
| Chrome Web Store review/submission     | BLOCKED / MANUAL                               | Publisher account and draft item exist, but release signing/verified upload, final live evidence, submission, review result, and published item status remain open.                                                                                                                                                                                                                                        |
| Extension functional parity            | PASS (local/demo) / PARTIAL (live)             | Focus views, keyboard shell, theme, local cache, popup, Gmail-only embedded controls, Side Panel, reminder notifications, OAuth boundary, Gmail API sync/mutation, sanitized HTML, summaries, intent drafts, Ask Inbox, Open Loops/reminders, session-only BYOK, and logout are present and fixture-tested. Live Gmail/provider/store behavior remains manual; see [`CLIENT_PARITY.md`](CLIENT_PARITY.md). |

## Proposed single purpose

> Subzero Mail is a Gmail-first companion that helps one user focus, read,
> draft, and follow up from their inbox using a Gmail-only contextual surface,
> the Subzero Side Panel, and user-controlled Subzero Mail workflows.

This wording is intentionally narrow. The extension uses Gmail API calls and a
local IndexedDB metadata cache. Its content script runs only on
`https://mail.google.com/*` and uses the Gmail DOM for volatile placement and
context, while its controls are isolated in Shadow DOM. It does not request
unrelated site access. Do not claim live sync, Gmail DOM resilience, Side Panel
behavior, reminder delivery, or background reliability until a real-account
clean-profile test is recorded.

## Required manual blockers

The following gates need human-controlled external evidence before a public
Chrome Web Store claim can be marked complete:

1. Create and record the extension package, manifest version, signing/public
   key, and resulting extension ID. Keep the private signing key out of the
   repository.
2. Confirm that OAuth is owned by the extension rather than delegated to the
   web client. The current extension config contains a dedicated client ID;
   verify its Google Console registration and extension-ID/origin configuration.
   Do not claim that the current web client is an extension client.
3. Confirm the final requested Google scopes and Chrome permissions against the
   implemented code, including `sidePanel`, `notifications`, the Gmail-only
   content-script match, the Gmail API host permission, and optional provider/
   loopback origins. Remove any permission that is not required by a shipped
   user flow.
4. Complete the current Google restricted-scope verification and any current
   Chrome Web Store privacy/data-use review required for the final distribution
   model. **VERIFY CURRENT DOCS** before relying on a checklist or limit.
5. Produce real extension screenshots, icons, privacy-policy URL, support
   contact, test-user/reviewer instructions, and a signed upload artifact. The
   local assets and draft text are not external verification; final public URL,
   upload, and signing evidence remain open.
6. Test OAuth consent, revoked access, sign-out, deletion controls, data
   disclosure, remote-image behavior, Gmail SPA remount/no-duplicate behavior,
   contextual controls, Side Panel context updates, reminder notification
   Open/Snooze/Resolve actions, and every listed store permission in a clean
   Chrome profile with a real Gmail account.
7. Submit only after the preceding gates pass, then record the actual review
   result and published item status. No store review or public availability is
   evidenced by this repository.

## Release decision

Do not submit or describe the extension as publicly available while any of
these remain unproven: release signing/verified upload, configured extension
OAuth client/origin alignment in a clean profile, final permissions,
restricted-scope verification, live Gmail/provider evidence, or store review.

The current web app may retain its separately documented web evidence. That
evidence is not a Chrome extension PASS.
