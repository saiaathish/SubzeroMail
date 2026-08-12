# Chrome Web Store listing draft

**Status: PARTIAL (DRAFT - DO NOT SUBMIT)**

The local extension artifact exists, but this copy is still a draft. It must
not be used to claim public availability, live Gmail verification, or approved
permissions.

A prior draft record names item `mdiopbbmnkdbkmkadcloadgbedfofdge` and package
version `0.1.0` with the dedicated Chrome Extension OAuth client. Current
publisher/upload/submission/publication state was not independently re-verified
in this docs pass. No Chrome Web Store review, approval, or public availability
is claimed.

## Listing copy

### Proposed title

Subzero Mail - Focused Gmail

### Proposed short description

> A focused Gmail workspace for keyboard triage, source-backed AI, and
> user-controlled BYOK providers.

Length and current Chrome Web Store short-description rules: **VERIFY CURRENT
DOCS**.

### Proposed full description

> Subzero Mail is a Gmail-first companion for one connected Gmail account. It
> is designed for the high-frequency inbox loop: focus on what matters, move
> through threads with the keyboard, and manage Gmail metadata through the
> Gmail API. The local extension build includes Focus Views, sanitized thread
> rendering, summaries, intent drafts, bounded Ask Inbox, Open Loops, and
> session-only BYOK settings. On Gmail, a content script scoped only to
> `https://mail.google.com/*` adds restrained contextual controls in Shadow
> DOM: thread actions, inline summaries, compose drafting, quick replies,
> focus signals, and a command palette. The Chrome Side Panel provides the
> deeper Now, Ask, Open Loops, source, preference, and theme surfaces. MV3
> alarms can surface sparse reminder notifications with Open, Snooze, and
> Resolve actions. Live Gmail OAuth, provider behavior, and notification
> behavior remain manual release gates.
>
> Subzero Mail is open source and bring-your-own-key. Gmail remains the
> mailbox source of truth. AI is a suggestion layer: drafts remain editable and
> sending requires an explicit user confirmation. The chosen AI provider may
> receive the content required for the feature you invoke; review that
> provider's terms and retention policy before using it.
>
> The local manifest requests `identity`, `storage`, `alarms`, `permissions`,
> `sidePanel`, and `notifications`, plus the narrow Gmail API origin and a
> Gmail-only content-script match. Provider and loopback origins are optional
> and requested only after a visible user gesture. Gmail DOM is used only for
> placement and page context; mailbox reads and mutations remain Gmail API
> operations in the background worker. The extension does not browse unrelated
> sites or use email content for product analytics by default.

This description is a draft. Remove every sentence that the final extension
cannot demonstrate in a clean Chrome profile.

## Data disclosure draft

| Store question                        | Draft answer                                                                                                                                                         | Final state                               |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| What is the single purpose?           | Gmail-first contextual focus, reading, drafting, and reminders for one user, with a Gmail-only embedded surface and Side Panel.                                      | VERIFY AGAINST IMPLEMENTATION             |
| What data is handled?                 | Google account identity, Gmail metadata/content needed for the invoked workflow, and user-selected AI input.                                                         | VERIFY AGAINST MANIFEST AND NETWORK TRACE |
| Why is Gmail data used?               | To show the connected mailbox and perform the user-requested Gmail workflow.                                                                                         | VERIFY CURRENT DOCS                       |
| Is data sold or used for advertising? | No such behavior is evidenced in this repository; the final extension must preserve that boundary.                                                                   | VERIFY CURRENT IMPLEMENTATION             |
| Is data sent to third parties?        | Gmail data goes to Google through Gmail APIs. User-invoked AI input may go to the selected provider.                                                                 | VERIFY PROVIDER ROUTES AND STORE FORM     |
| Is retention controlled by Subzero?   | The current web app has local server/browser retention boundaries; the extension caches recent metadata in IndexedDB and has no automatic deletion claim.            | VERIFY CURRENT IMPLEMENTATION             |
| Privacy policy URL                    | Repository policy: [`PRIVACY.md`](PRIVACY.md). Final public HTTPS URL, reachability, and the URL saved in the store draft remain manual/unverified in this checkout. | MANUAL / VERIFY BEFORE SUBMISSION         |

## Asset and submission checklist

Required listing material and current state:

- [x] Reproducible local extension zip and version; signed upload artifact remains manual.
- [x] Draft item identifier is recorded as `mdiopbbmnkdbkmkadcloadgbedfofdge`;
      publication and public availability are not claimed.
- [x] Local 128x128 RGB PNG store icon is present in the extension asset set;
      final store-asset review remains manual.
- [x] Three local 1280x800 RGB PNG screenshots were captured from the built
      MV3 extension; external draft upload and final visual review remain
      manual.
- [ ] Optional promotional tile, marquee tile, and video are intentionally
      omitted from this draft.
- [ ] Final public HTTPS privacy URL and support/contact route verified in the
      draft and from a clean external browser.
- [x] Reviewer instructions saved for the credential-free local demo; no
      secrets are included.

The local screenshot set was generated from `apps/extension/.output/chrome-mv3`
after the extension Chromium suite/build was validated. This is local/demo
evidence only; do not substitute it for clean-profile or store-review proof,
and do not substitute the checked-in web screenshots for extension screenshots.

## Submission blockers

The listing remains a draft pending clean-profile Gmail DOM/OAuth verification,
Side Panel and reminder-notification verification, provider-network checks,
Google consent and restricted-scope review, release signing/verified-upload
choice, final permissions/data-use review, public privacy/support verification,
and Chrome Web Store review. Do not click **Submit for review** until those
external gates are complete.
