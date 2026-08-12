# @subzero/ui

Shared Subzero Mail primitives for the web app and browser extension. The package is built for a dense, keyboard-first inbox: cold-blue accents, midnight surfaces, electric-ice focus states, quiet borders, and content-first message layouts.

## Install

The workspace already provides React and `lucide-react`. Import the package stylesheet once from each consuming app:

```tsx
import {
  CommandPalette,
  FocusTabs,
  MessageSurface,
  SubzeroMark,
  ThreadRow,
} from "@subzero/ui";
import "@subzero/ui/styles.css";
```

Wrap the app shell with `subzero-ui`, or set the theme attribute on an existing ancestor such as `html`:

```tsx
<div className="subzero-ui" data-subzero-theme="dark">
  <SubzeroMark showName />
  {/* mail layout */}
</div>
```

`dark` is the default preset. Use `data-subzero-theme="light"` or the equivalent `subzero-theme-light` class for the light preset. The package also understands the existing app convention `data-theme="light|dark"`.

## Primitives

- `SubzeroMark` provides the Subzero snowflake mark and optional wordmark.
- `FocusTabs` is a controlled `role="tablist"` with roving focus and Arrow/Home/End navigation.
- `ThreadRow` is a single, non-nested button row for sender, subject, preview, labels, and thread indicators.
- `CommandPalette` provides a modal command list with search, arrow-key navigation, Enter to run, Escape to close, and focus restoration.
- `MessageSurface` renders a message header and readable body surface without another card inside the thread layout.
- `ThemeToggle` exposes a controlled light/dark switch with an accessible action label.
- `EmptyState` supports a title, useful next-step description, icon, action, and error/success tones.
- `StatusPill` pairs status text with a semantic icon and optional live-region behavior.

## Example

```tsx
const tabs = [
  { id: "inbox", label: "Inbox", count: 12 },
  { id: "needs-reply", label: "Needs reply", count: 4 },
  { id: "waiting", label: "Waiting" },
];

<FocusTabs
  items={tabs}
  value="inbox"
  onValueChange={(next) => setView(next)}
  aria-label="Mailbox views"
/>

<ThreadRow
  thread={{
    id: "maya-contract",
    sender: "Maya Chen",
    subject: "Contract notes for Thursday",
    preview: "I added the revised terms and highlighted two decisions.",
    timestamp: "9:42 AM",
    unread: true,
    labels: ["Priority"],
    hasAttachment: true,
  }}
  onSelect={(thread) => openThread(thread.id)}
/>

<MessageSurface
  sender="Maya Chen"
  senderAddress="maya@example.com"
  recipients="you@example.com"
  timestamp="Today, 9:42 AM"
>
  <p>The revised terms are ready for your review.</p>
</MessageSurface>
```

## Token and layout hooks

Tokens use three layers in `src/styles/tokens.css`:

1. Primitive values such as `--sz-space-1`, `--sz-color-electric-ice-400`, and typography scales.
2. Semantic aliases such as `--sz-color-bg-surface`, `--sz-color-text-muted`, and `--sz-color-error-text`.
3. Component values such as `--sz-thread-row-min-height` and `--sz-command-width`.

Spacing follows a 4px rhythm. `.sz-layout`, `.sz-layout__sidebar`, `.sz-layout__main`, and `.sz-responsive-scroll-x` are optional layout hooks for shared web/extension shells. The layout collapses to one column below 840px; thread and message primitives tighten below 560px.

## Accessibility notes

Interactive primitives use real buttons, visible `:focus-visible` rings, minimum 44px controls, explicit labels, and reduced-motion handling. `FocusTabs` skips disabled tabs. `CommandPalette` restores focus to the opener and keeps Tab navigation inside the open dialog.

Consumers still own page-level focus management, route announcements, command authorization, and the semantics of custom `actions` slots.

## Known integration boundaries

- The package is presentational. It does not fetch mail, own routing, persist theme state, or call Gmail/AI APIs.
- `CommandPalette` renders in place with a fixed overlay. Mount it near the app root if an ancestor creates a stacking context.
- `MessageSurface` renders `children` as React content. Sanitize email HTML before passing it to a consumer-owned renderer.
- No remote assets or CDN font imports are used. No verified local Instrument Sans asset exists in this repository yet, so the CSS exposes an Instrument Sans-first stack with a documented local-font TODO.
- `lucide-react` is the only runtime dependency. No React Bits imports or registry assumptions are used.
- The primitives do not copy Superhuman geometry, wording, icons, CSS, or brand treatment.
