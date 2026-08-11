# Superhuman Mail — Public Architecture Reconstruction + 80/20 Replication Map

**Purpose:** Reverse-engineer how Superhuman Mail works from public first-party sources, then identify the smallest product surface that reproduces most of the everyday value for a solo power user.

**Last researched:** 2026-08-10

> **Important limitation**
>
> Superhuman is proprietary. No public source exposes its complete current backend topology, database schemas, internal services, model-routing logic, or source code. This document therefore separates:
>
> - **CONFIRMED** — directly stated by Superhuman.
> - **STRONGLY INFERRED** — supported by multiple current first-party signals.
> - **HISTORICAL** — directly documented by Superhuman engineering, but from an older implementation.
> - **UNKNOWN** — not public; do not pretend otherwise.
>
> The goal is not to clone their internals byte-for-byte. The goal is to understand the product mechanics well enough to reproduce the highest-value 80% with a much smaller system.

---

# 1. Executive model

Superhuman Mail is fundamentally **not an email provider**. Gmail or Microsoft 365 remains the mailbox/system of record. Superhuman sits on top as a high-performance client and intelligence layer.

The product's core loop is:

```text
Google / Microsoft mailbox
        ↓
OAuth + mail APIs
        ↓
Superhuman sync / normalization layer
        ↓
local cache + cloud state
        ↓
classification / prioritization
        ↓
Split Inbox + ultra-fast keyboard UI
        ↓
summaries / drafts / reminders / Ask AI
        ↓
user action
        ↓
optimistic local update
        ↓
persist mutation to Gmail / Microsoft
```

The _real_ product is not “AI email.” It is a combination of:

1. **Fast local interaction**
2. **A different inbox state model**
3. **Keyboard-first execution**
4. **Automatic prioritization**
5. **AI compression of reading/writing**
6. **Follow-up state**
7. **Reliable synchronization back to the actual mailbox**

That distinction matters for Subzero Mail. If the LLM disappears, a serious Superhuman-style client still has a lot left: sync, cache, keyboard navigation, Split Inbox, search, snooze/reminders, optimistic mutations, and a task-like inbox state machine.

---

# 2. Product surfaces

Superhuman Mail currently exists across several surfaces.

| Surface                         | Public evidence                                         | Status    |
| ------------------------------- | ------------------------------------------------------- | --------- |
| Web client                      | Superhuman documents a browser/web experience           | CONFIRMED |
| Chrome extension                | Official download docs list it                          | CONFIRMED |
| macOS desktop app               | Official download docs                                  | CONFIRMED |
| Windows desktop app             | Official download docs                                  | CONFIRMED |
| iOS/iPadOS                      | Official download docs                                  | CONFIRMED |
| Android                         | Official download docs                                  | CONFIRMED |
| Gmail-native background agent   | Auto Labels / Archive / Drafts / Reminders inside Gmail | CONFIRMED |
| Outlook-native background agent | Same concept for Outlook                                | CONFIRMED |

For an 80/20 clone, **only the web client is necessary**.

Desktop wrappers, mobile clients, and provider-native background agents create major maintenance cost without being required to prove the core product value.

---

# 3. Confirmed production infrastructure

## 3.1 Cloud

Superhuman's current Data Privacy Addendum states specifically that **Superhuman Mail is hosted on Google Cloud Platform**.

It also confirms:

- Google Cloud KMS for encryption-key management.
- Google Application Layer Transport Security for internal service-to-service traffic.
- Google Kubernetes Engine for system configuration.
- Google Cloud Security Scanner.
- OAuth2 delegated to Google or Microsoft for authentication.
- Production backup restoration / incident simulation.
- SOC 2 Type 2 and ISO 27001 controls.
- TLS 1.2+ in transit.
- AES-256 encryption at rest.
- Private networks, load balancers, and web application firewalls where appropriate.
- RBAC and MFA for production access.
- separated production/staging/development environments.
- infrastructure logging and security monitoring.

### Likely high-level cloud shape

This is the most defensible reconstruction:

```text
                    ┌─────────────────────────┐
                    │ Google / Microsoft OAuth│
                    └────────────┬────────────┘
                                 │
                                 ▼
┌──────────────┐       ┌───────────────────────┐
│ Web/Desktop  │◄─────►│ Superhuman API layer  │
│ Mobile       │       │ on GCP / GKE          │
└──────┬───────┘       └───────────┬───────────┘
       │                           │
       │                           ├── mail sync/services
       │                           ├── AI services
       │                           ├── reminder/job services
       │                           ├── account/settings services
       │                           ├── collaboration services
       │                           └── telemetry/evaluation
       │
       └── local cache / offline state
```

The exact service boundaries are **not public**.

---

# 4. Publicly visible technology stack

Superhuman publishes third-party software attributions for Mail. Presence on this list proves that a dependency is used somewhere in the Mail product family, but **does not prove exactly which service uses it**.

## Web / desktop signals

Confirmed package presence includes:

- React
- React DOM
- React Router
- TypeScript
- Electron
- Electron Store
- Electron Updater
- Framer Motion
- DOMPurify
- Mousetrap
- Squire editor
- Next.js
- LaunchDarkly
- Bugsnag
- OpenTelemetry

A reasonable reconstruction is:

```text
Web UI
  React + TypeScript
       │
       ├── local cached mailbox state
       ├── command / keyboard action system
       ├── search
       └── network/API clients

Desktop
  Electron shell around web-oriented application code
  + native push/update/storage integrations
```

Do not infer that every current screen is Next.js or that every desktop component is purely Electron. The attribution list does not provide that granularity.

## Backend signals

The attribution list includes:

- Go libraries
- Google Cloud Pub/Sub
- Firestore
- Google Cloud Storage
- BigQuery
- MongoDB driver
- Redis
- FastAPI
- Uvicorn
- Python Requests
- Pydantic
- OpenTelemetry
- gRPC

This strongly suggests a **polyglot service architecture** rather than one monolithic Node application.

A plausible public-source model is:

```text
mail/event services       → Go-heavy services
AI / evaluation services  → Python/FastAPI ecosystem
ephemeral state / cache   → Redis
cloud events              → Pub/Sub
persistent/cloud stores   → one or more GCP-backed databases/storage systems
analytics                 → BigQuery-style workflows
```

That mapping is **inference**, not a disclosed architecture diagram.

## AI signals

The Mail attribution list includes:

- OpenAI client
- Cohere
- Braintrust
- autoevals
- Weaviate client

This establishes that Superhuman has used multiple AI/search/evaluation components. It does **not** establish:

- which model handles which current feature;
- whether OpenAI/Cohere are still used for every AI path;
- exact embedding models;
- exact vector database topology;
- prompts;
- routing logic;
- token budgets.

For Subzero, do not recreate this complexity. BYOK provider abstraction is enough.

---

# 5. Mailbox connection and sync

## 5.1 Authentication

Superhuman delegates authentication to the mailbox provider through OAuth2.

Supported mailbox families:

- Gmail / Google-hosted accounts
- Microsoft 365 / Outlook-hosted accounts

Superhuman does not act as a standalone password-based mail provider.

For Gmail, Superhuman's public dependency list explicitly includes the Gmail API. For Microsoft, its attributions include Microsoft authentication and Graph SDK components.

### Subzero 80/20

Only implement:

```text
Google OAuth
    ↓
Gmail API
```

Do not implement IMAP or Outlook until there is real user demand.

---

# 6. The speed architecture is one of the most important parts

This is easy to underestimate.

Superhuman has repeatedly positioned speed as a product feature, not merely an engineering detail.

Its public engineering material says that it stores email information locally, preloads/prerenders threads users are likely to open, and minimizes animation overhead.

Their performance engineering centers on the idea that **~100 ms is the perceptual boundary for an interaction feeling instantaneous**.

For Subzero, a useful target is:

```text
keyboard input → visible local state change: <100 ms
```

Not:

```text
keyboard input → wait for Gmail API → render
```

That architectural decision explains much of the “Superhuman feeling.”

---

# 7. Local-first cache and offline model

Current Superhuman help documentation says Mail can work offline.

It caches:

- messages opened by the user;
- messages searched for by the user;
- messages received in roughly the last 30 days;
- up to 1,250 emails per Split;
- attachments for offline review.

Users can triage and compose offline; queued work synchronizes when connectivity returns.

This means the visible inbox is **not simply a live Gmail API view**.

It is backed by local state.

## Historical architecture

Superhuman published its offline architecture in 2016. Treat the exact implementation as historical, but the design is extremely useful.

At that time it used:

- Service Workers to make application code available offline.
- browser storage for message/attachment state.
- a local email database.
- **Modifiers** for user actions.
- per-thread **modifier queues**.
- synchronous optimistic local updates.
- asynchronous remote persistence.
- idempotent persistence operations.
- retry and rollback behavior.

Conceptually:

```text
User hits Archive
       │
       ▼
create ArchiveModifier(threadId)
       │
       ├── immediately change local UI
       │
       └── enqueue Gmail mutation
                      │
                 network available?
                 /             \
               yes              no
               │                 │
         persist remotely     wait
               │
         success / failure
           │          │
        commit      retry
                     │
               permanent fail
                     │
                  rollback
```

The exact modern code is unknown, but current offline behavior is consistent with the same broad principle:

> **Local state should respond immediately; remote mailbox state catches up safely.**

### Subzero 80/20

This is more important than fancy AI.

At minimum:

```ts
type PendingMutation = {
  id: string;
  threadId: string;
  type: "archive" | "star" | "mark_read" | "label";
  desiredState: unknown;
  createdAt: number;
  status: "pending" | "committed" | "failed";
};
```

When the user archives:

1. update local cache;
2. render immediately;
3. persist to Gmail;
4. retry safe failures;
5. reconcile on conflict.

You do not need complete offline mode in v1, but you **do** want optimistic interaction.

---

# 8. Superhuman Command: the UX spine

The single most important navigation mechanic is **Superhuman Command**.

Desktop:

```text
Cmd+K / Ctrl+K
```

It acts as a universal command palette for actions and navigation.

Users can discover an action through the command palette, see its direct shortcut, then eventually stop opening the palette at all.

Examples include:

- compose;
- search;
- reply;
- move;
- label;
- navigate;
- account switching;
- settings/actions.

This creates a learning ladder:

```text
new user
  ↓
Cmd+K
  ↓
search action by name
  ↓
notice keyboard shortcut
  ↓
memorize shortcut
  ↓
perform action directly
```

### 80/20 interpretation

**P0. Absolutely replicate this interaction model.**

A Superhuman-style product without an excellent command palette and direct shortcuts is missing the central non-AI value.

Suggested Subzero minimum:

| Action        | Shortcut                       |
| ------------- | ------------------------------ |
| command       | Cmd/Ctrl+K                     |
| compose       | C                              |
| search        | /                              |
| open          | Enter                          |
| next          | J                              |
| previous      | K                              |
| archive/done  | E                              |
| reply         | R                              |
| star          | S or chosen collision-free key |
| snooze/remind | H                              |
| label         | L                              |

Exact parity is less important than consistency.

---

# 9. Inbox state model

Superhuman treats email closer to a work queue than a passive archive.

The three core user states are approximately:

```text
INBOX / ACTIVE
needs attention now

REMINDER / SNOOZED
not now; bring it back later

DONE
no longer needs attention
```

This is a major reason users describe the inbox as a task list.

## Done

“Done” is essentially the active-workflow abstraction over archive/removal from inbox.

## Reminder / Snooze

A conversation disappears until a chosen time and returns when action is needed.

## New reply behavior

If a Done conversation receives a new reply, it naturally becomes active again through provider inbox state.

### 80/20

**P0/P1.**

Subzero does not need an elaborate task system. It needs:

```text
Active → Done
Active → Remind at T
Done → Active when new provider message arrives
Reminder → Active when due
```

---

# 10. Split Inbox

Split Inbox is one of Superhuman's foundational features.

Default behavior separates more important person-to-person mail from automated/noisy mail.

Users can define custom splits using criteria such as:

- From
- To
- Subject
- Bcc
- Cc
- AND / OR combinations
- Auto Labels

Superhuman itself recommends a small number of splits rather than dozens.

## Mental model

```text
Raw provider inbox
       ↓
classification / criteria
       ↓
┌────────────┬───────────────┬──────────────┐
│ Important  │ Needs Reply   │ Other / Noise│
└────────────┴───────────────┴──────────────┘
```

### 80/20

**P0.**

Do not build a full configurable query engine initially.

Start with:

1. Priority
2. Needs Reply
3. Waiting
4. Other

Allow simple deterministic rules later.

---

# 11. Auto Labels

Superhuman uses built-in and custom labels to classify incoming email.

Public behavior:

- built-in labels include categories such as marketing, news, pitches, social, invoices, scheduling, messages needing response, etc.;
- new mail is automatically classified;
- enabling a label can also classify a recent lookback window;
- custom labels can be defined using deterministic conditions or an AI prompt;
- custom label creation can preview matching messages;
- user feedback can refine the result.

## Likely functional architecture

```text
new message
    ↓
cheap deterministic features
(sender, headers, recipients, provider labels, subject)
    ↓
rule checks
    ↓
optional AI classifier
    ↓
structured result
{
  label,
  confidence,
  reason
}
    ↓
local/store label
    ↓
Split Inbox
```

Exact models are unknown.

### 80/20

**P0/P1.**

You can outperform a pure LLM implementation by using deterministic signals first.

Example:

```json
{
  "bucket": "needs_reply",
  "priority": 0.92,
  "reasons": [
    "direct recipient",
    "contains question",
    "human sender",
    "user has previously replied"
  ]
}
```

Only ask the model when deterministic classification is uncertain.

---

# 12. Auto Archive

Auto Archive composes directly with Auto Labels.

The user can tell Superhuman that categories such as marketing, cold pitches, or other repetitive mail should skip the primary inbox automatically.

Flow:

```text
incoming message
      ↓
Auto Label
      ↓
label configured for auto-archive?
      ↓ yes
remove from active inbox
      ↓
still searchable / recoverable
```

It can also apply to sender/domain rules.

### 80/20

**P1.**

Very cheap once classification exists.

Do not let the LLM directly archive arbitrary mail without a clear rule / confidence threshold.

---

# 13. Search

There are two distinct search concepts.

## 13.1 Traditional fast mailbox search

Superhuman historically built local browser search with:

- locally cached messages;
- a full-text search table;
- structured fields such as sender/labels;
- a query tokenizer;
- node parsing;
- an AST;
- generated database queries;
- autocomplete;
- syntax highlighting.

This allowed complex search to remain fast and work offline.

The exact WebSQL implementation is historical.

### Subzero 80/20

Do **not** rebuild their full query compiler.

Use:

```text
search query
   ├── Gmail deterministic search
   └── local cached-text matching
```

This gives most value cheaply.

## 13.2 Ask AI

Ask AI is a separate natural-language knowledge/search layer.

Current public behavior:

- searches email up to five years back;
- can combine inbox, calendar, and web information;
- has chat history;
- can draft/edit emails;
- can create calendar events;
- supports natural-language questions rather than Gmail operators.

When activated, Superhuman says it begins indexing up to five years of email, which may take considerable time.

This strongly implies a separate AI retrieval/indexing pipeline from the ordinary inbox cache.

Superhuman states that with Ask AI enabled, email content is stored through a trusted SOC 2-compliant third-party vendor and encrypted in transit/at rest.

### 80/20

**P1, not P0.**

Subzero's current approach is sufficient:

```text
question
  ↓
Gmail candidate retrieval
  ↓
local reranking
  ↓
small evidence set
  ↓
BYOK LLM
  ↓
answer + source IDs
```

You do not need to index five years on day one.

Evidence chips are actually a good differentiation over a black-box answer.

---

# 14. Auto Summarize

Current user-facing behavior:

- one-line summary under the conversation subject;
- expanded detailed summary on request;
- summary updates as a thread changes;
- some categories are excluded from automatic generation;
- very long threads are not auto-summarized;
- manual summary remains possible;
- cached AI results are retained for a period for reuse.

## Functional model

```text
thread messages
      ↓
eligibility filter
      ↓
thread content normalization
      ↓
summary generation
      ↓
{
  oneLine,
  expandedBullets,
  latestDelta?
}
      ↓
cache keyed by latest message/thread version
```

### 80/20

**P0.**

Do this better with explicit grounding:

```text
SUMMARY
Ayaan confirmed kickoff Friday at 6 PM CST.
Submissions close Sunday at 6 PM CST.

LATEST CHANGE
Winners moved from Sunday → Monday.

ACTION
Join Discord and find a team.

SOURCES
[msg_123] [msg_128]
```

The source IDs are not necessary for Superhuman parity, but they increase trust.

---

# 15. Instant Reply

Superhuman's Instant Reply displays **three suggested replies** for eligible incoming messages.

The user can:

1. preview/cycle suggestions;
2. choose one;
3. insert it into the composer;
4. edit;
5. send.

Important: selecting a suggestion does **not** bypass the composer.

Superhuman excludes many message types, including some automated/financial/calendar categories, threads where the user was last responder, spam/trash, existing drafts, and very long conversations.

## Functional architecture

```text
eligible incoming thread
       ↓
thread + user context
       ↓
generate 3 reply intents
       ↓
display choices
       ↓
selection
       ↓
editable compose draft
       ↓
explicit user send
```

### 80/20

**P0.**

You do not even need three full drafted bodies.

Cheaper implementation:

```text
3 short reply intents
  1. Yes, Friday works.
  2. Ask to move to Monday.
  3. Decline politely.
```

Generate the full body only after selection.

That cuts inference and UI complexity while preserving the perceived magic.

---

# 16. Write with AI

Write with AI supports:

- generating a draft from a user instruction;
- editing selected text;
- shorten/lengthen/simplify;
- grammar improvements;
- translation;
- personalized tone;
- voice input on mobile.

The core interaction is:

```text
user intent
    +
conversation context
    +
personalization
    ↓
editable draft
```

### 80/20

**P0.**

Subzero already has the correct minimum:

> Intent → grounded draft → editable composer → user sends.

Do not add dozens of rewrite buttons until the core draft quality is good.

---

# 17. Personalization / voice

Superhuman AI maintains user-level personalization such as:

- greeting/signoff;
- role/company;
- tone;
- preferred length;
- formatting preferences;
- scheduling preferences;
- event defaults;
- personal background/context.

Some fields are inferred automatically and can be manually edited.

This personalization is reused by Write with AI, Ask AI, Auto Drafts, and scheduling.

## Functional model

```json
{
  "writing": {
    "tone": "...",
    "length": "...",
    "greeting": "...",
    "signoff": "...",
    "rules": []
  },
  "identity": {
    "role": "...",
    "company": "...",
    "context": []
  }
}
```

### 80/20

**P1.**

Do not train a model.

Build a compact voice profile from a small set of sent emails plus manual preferences.

---

# 18. Auto Reminders

Superhuman detects sent messages that have not received a reply.

Users can configure:

- reminder time;
- weekday-only behavior;
- whether reminders apply only when AI believes a follow-up is needed;
- or all external outgoing messages.

Conceptually:

```text
outgoing message
      ↓
follow-up required?
      ↓
create waiting state
      ↓
reply arrives?
   /        \
 yes         no
  │           │
resolve      due time reached
              │
          resurface thread
```

### 80/20

**P0/P1.**

This is one of the highest-value non-generative features.

Subzero's Open Loops model is arguably better because it can represent:

```text
I OWE
THEY OWE
WAITING
RESOLVED
```

Superhuman's reminder system should be treated as the baseline, not the ceiling.

---

# 19. Auto Drafts

Current Superhuman behavior includes two automated draft types:

1. **responses** to messages that need a reply;
2. **follow-ups** for messages still awaiting a response.

Superhuman says Auto Drafts are refreshed roughly daily if context changes. Once a user manually edits an Auto Draft, it becomes a normal draft and is no longer automatically rewritten.

That is an excellent state rule.

## Functional model

```text
thread needs response
       ↓
generate draft
       ↓
store draft provenance/version
       ↓
context changes?
   /          \
 yes           no
  │             │
user edited?    keep
 /      \
yes      no
 │        │
freeze   regenerate
```

### 80/20

**P1.**

Do not generate drafts for every email on initial sync.

Generate:

- on demand;
- for `Needs Reply`;
- or opportunistically in the background for the top N important threads.

---

# 20. Knowledge Base

Business/Enterprise users can add:

- files;
- public URLs;
- private personal knowledge;
- team-shared knowledge.

Write with AI and Ask AI can retrieve this material.

### 80/20

**P2 / CUT for initial Subzero.**

The inbox itself already provides a huge context corpus.

Adding document ingestion creates:

- parsers;
- crawling;
- permissions;
- storage;
- embeddings;
- invalidation;
- team ACLs.

Bad trade for an 80/20 MVP.

---

# 21. Read Statuses

Superhuman can display:

- whether a recipient opened an email;
- how many times;
- device class;
- a Recent Opens feed;
- team-shared read status in some plans.

It also uses recipient activity/time-zone information for Smart Send recommendations.

The precise tracking mechanism is not documented in the public sources reviewed here. Do not claim a specific pixel/protocol as confirmed.

### 80/20

**P2 / CUT initially.**

Read tracking adds privacy concerns and infrastructure while contributing less to the universal email workflow than triage, summaries, drafts, and follow-ups.

---

# 22. Calendar / scheduling

Superhuman integrates calendar directly into the mail experience.

Capabilities include:

- viewing calendar;
- showing schedule while composing;
- sharing availability;
- finding a mutual time;
- turning an email into an event;
- AI-created events;
- conferencing integrations.

### 80/20

**P2.**

Useful, but it is a separate product surface.

Do not build calendar until Subzero's email loop is excellent.

---

# 23. Snippets

Snippets are reusable blocks ranging from short phrases to complete emails and may include more than plain text.

They are valuable because repeated typing is a real bottleneck.

### 80/20

**P2, but cheap.**

A minimal implementation is inexpensive:

```text
shortcut / command
       ↓
choose snippet
       ↓
insert text into composer
```

Consider this before heavier P2 work because implementation cost is tiny.

---

# 24. Shared Conversations / Team Comments

Superhuman can share live email conversations and allow comments inside that context.

This solves collaboration without forwarding/screenshots.

### 80/20

**CUT.**

It requires:

- Superhuman-native identity;
- share ACLs;
- live collaboration state;
- comments;
- notifications;
- external viewer links;
- team management.

It is not needed for a solo-user open-source alternative.

---

# 25. AI privacy and storage

Public Superhuman documentation says:

- AI features are opt-in.
- Mail/vendor AI does not train on customer email data.
- Ask AI causes email data to be stored through a trusted SOC 2-compliant third-party vendor.
- data is encrypted in transit and at rest.
- Write with AI queries/responses have different retention behavior than Auto Summarize / Instant Reply / Ask AI.
- Knowledge Base content has separate privacy controls.

The exact current LLM routing and vendor breakdown is not public.

### Subzero advantage

BYOK can make the system materially simpler:

```text
Subzero backend
    ↓
user-selected OpenAI-compatible provider
    ↓
user pays provider directly
```

Add:

- custom base URL;
- custom model;
- encrypted API key;
- provider test;
- no re-display of key;
- evidence on what email context is sent.

That is a legitimate product difference, not just a pricing difference.

---

# 26. Reliability / network behavior

Historical Superhuman engineering described an unusually strong network model.

Rather than trusting `navigator.onLine`, the app tracked dependency health itself.

Historical behavior included:

- wrapping HTTP/WebSocket operations;
- marking dependencies offline after network failures;
- polling for recovery;
- hysteresis to prevent UI flicker;
- treating many connection failures as one coherent “offline” product state.

The precise modern implementation is unknown.

### 80/20

Do not replicate the full network state machine.

Implement:

```text
online
degraded
offline
```

and ensure:

- cached inbox still renders;
- unsent mutations are visible as pending;
- retries are idempotent;
- users know whether a mutation reached Gmail.

---

# 27. Performance instrumentation

Superhuman's engineering team publicly documented a useful principle:

> Measure what percentage of user interactions complete under a threshold instead of only looking at averages.

They used thresholds around:

- <50 ms
- <100 ms
- slower ranges

Their instrumentation starts timing from the user event timestamp and ends near the rendering frame to better represent perceived latency.

### Subzero 80/20

Track only 5 interactions:

```text
open thread
next/previous thread
archive
search results
open composer
```

Metric:

```text
% completed locally in <100ms
```

This matters more than adding a tenth AI feature.

---

# 28. Observability / evaluation signals

Superhuman's public software attributions include:

- OpenTelemetry
- Bugsnag
- Firebase Crashlytics
- Braintrust
- autoevals
- BigQuery tooling

This indicates mature telemetry/evaluation tooling exists somewhere in the system, but exact pipelines are not public.

### Subzero 80/20

For an OSS project:

```text
structured application logs
+
client error boundary
+
AI request receipt
+
small offline eval fixture
```

is sufficient.

Do not build an enterprise telemetry platform.

---

# 29. What actually creates Superhuman's value?

This is the critical section.

Their enormous feature list can be reduced into five user outcomes.

## Outcome A — “Tell me what matters.”

Mechanisms:

- Split Inbox
- Auto Labels
- Auto Archive
- priority logic

## Outcome B — “Let me process it without touching the mouse.”

Mechanisms:

- Command palette
- direct shortcuts
- local cache
- optimistic mutations
- fast navigation

## Outcome C — “Make me read less.”

Mechanisms:

- Auto Summarize
- Ask AI

## Outcome D — “Make me type less.”

Mechanisms:

- Instant Reply
- Write with AI
- Auto Drafts
- Snippets

## Outcome E — “Don't let me drop anything.”

Mechanisms:

- Remind Me
- Auto Reminders
- follow-up drafts
- waiting state

Everything else is an extension of one of these outcomes or serves a narrower persona.

---

# 30. Clean 80/20 feature map for Subzero

This is the recommended scope if the goal is:

> **“Most of the solo-user Superhuman experience for a fraction of the engineering.”**

## P0 — must be excellent

These define the product.

### P0.1 Gmail OAuth + real mailbox

- connect Gmail;
- sync recent threads;
- thread view;
- labels;
- read/unread;
- star;
- archive;
- compose;
- reply;
- explicit send.

### P0.2 Local cache + optimistic mutations

- inbox renders from cache;
- action feels instant;
- Gmail API persists asynchronously;
- failures reconcile.

### P0.3 Keyboard-first operation

- Cmd/Ctrl+K command palette;
- J/K;
- Enter;
- E archive;
- R reply;
- C compose;
- `/` search.

### P0.4 Focus / Split Inbox

Minimum buckets:

```text
Priority
Needs Reply
Waiting
Other
```

### P0.5 Automatic triage

Use deterministic signals first, AI refinement second.

Output reasons.

### P0.6 Evidence-backed thread summary

- concise summary;
- latest change;
- action;
- deadline;
- source message IDs.

### P0.7 AI drafting

- natural-language intent;
- editable draft;
- explicit send.

### P0.8 Search

- Gmail search syntax;
- fast cached search;
- no giant custom search engine.

### P0.9 BYOK

- OpenAI-compatible provider;
- custom base URL;
- custom model;
- encrypted secret;
- test connection.

---

# 31. P1 — high-value extensions

Build these after P0 is reliable.

## P1.1 Ask Inbox

Natural-language question:

```text
retrieve likely threads
      ↓
rerank
      ↓
small evidence context
      ↓
BYOK model
      ↓
answer + source chips
```

## P1.2 Open Loops

Better version of reminder/follow-up tracking:

```text
I OWE
THEY OWE
WAITING
RESOLVED
```

with due dates and source messages.

## P1.3 Auto Reminders

Automatically resurface unresolved waiting threads.

## P1.4 Auto Drafts

Background draft only for high-priority `Needs Reply` / `Waiting` threads.

Freeze if manually edited.

## P1.5 Personal voice profile

Infer from sent mail + manual preferences.

## P1.6 Auto Archive

Apply only to trusted labels/rules.

## P1.7 Custom Focus rules

Simple deterministic rule builder first.

---

# 32. P2 — opportunistic

Only add if P0/P1 are polished.

| Feature                            | Why P2                                           |
| ---------------------------------- | ------------------------------------------------ |
| Snippets                           | useful and cheap, but not defining               |
| multiple Gmail accounts            | complexity grows quickly                         |
| offline mutation queue persistence | great polish, not required for first release     |
| richer custom labels               | P1 system already covers most value              |
| local embeddings                   | only needed when current retrieval stops working |
| attachments in AI                  | increases privacy/context complexity             |
| calendar peek                      | useful but separate domain                       |
| send later                         | commodity feature                                |
| undo send                          | useful but implementation/persistence edge cases |
| richer composer transforms         | incremental AI polish                            |

---

# 33. CUT — explicitly do not build for the 80/20 version

These are where a clean MVP dies.

- Outlook
- generic IMAP
- native iOS
- native Android
- Electron desktop app
- Shared Conversations
- Team Comments
- Salesforce
- HubSpot
- Pipedrive
- enterprise SSO
- SCIM
- admin console
- team analytics
- read-status tracking
- Recent Opens feed
- Smart Send
- complete calendar product
- meeting scheduling engine
- Knowledge Base ingestion
- five-year up-front semantic indexing
- custom vector database unless proven necessary
- full offline attachment mirror
- Superhuman-equivalent search parser
- arbitrary workflow agents

---

# 34. The real 80/20 architecture

Subzero should be radically smaller.

```text
┌─────────────────────────────────────────────┐
│                Subzero Web                  │
│ React / Next.js                             │
│                                             │
│  keyboard UI ─ focus inbox ─ thread view    │
│       │            │             │           │
│       └──────── local cache ─────┘           │
└──────────────────────┬──────────────────────┘
                       │
                       ▼
             ┌──────────────────┐
             │ Subzero backend  │
             │                  │
             │ OAuth            │
             │ Gmail adapter    │
             │ settings         │
             │ AI provider API  │
             └───────┬──────┬───┘
                     │      │
             Gmail API      └──── BYOK OpenAI-compatible LLM
                     │
                     ▼
              user's mailbox
```

Persistent state:

```text
Gmail
  = canonical email

SQLite
  = accounts
  + encrypted OAuth token
  + settings
  + BYOK secret
  + cached metadata
  + AI artifacts
  + open loops

browser/local app state
  = fast working set
```

No Kafka.
No Kubernetes.
No vector DB by default.
No agent swarm.
No separate AI microservice.
No distributed workflow engine.

That is the entire point of 80/20.

---

# 35. Feature parity scorecard

A useful way to judge Subzero is by _user outcome_, not line-item feature count.

| User outcome              |           Superhuman | Subzero target | Priority |
| ------------------------- | -------------------: | -------------: | -------- |
| real Gmail client         |                   ✅ |             ✅ | P0       |
| fast triage               |                   ✅ |             ✅ | P0       |
| keyboard-first            |                   ✅ |             ✅ | P0       |
| priority/focus splits     |                   ✅ |             ✅ | P0       |
| automatic categorization  |                   ✅ |             ✅ | P0       |
| archive/read/star         |                   ✅ |             ✅ | P0       |
| compose/reply/send        |                   ✅ |             ✅ | P0       |
| summaries                 |                   ✅ |  ✅ + evidence | P0       |
| instant/AI reply          |                   ✅ |             ✅ | P0       |
| mailbox search            |                   ✅ |             ✅ | P0       |
| BYOK                      | not consumer default |             ✅ | P0       |
| follow-up state           |                   ✅ |  ✅ Open Loops | P1       |
| Ask AI                    |                   ✅ |   ✅ Ask Inbox | P1       |
| auto follow-up drafts     |                   ✅ |             ✅ | P1       |
| voice personalization     |                   ✅ |     ✅ minimal | P1       |
| auto archive              |                   ✅ |             ✅ | P1       |
| custom AI labels          |                   ✅ | simple version | P1       |
| snippets                  |                   ✅ |       optional | P2       |
| full offline              |                   ✅ |  partial later | P2       |
| multi-account             |                   ✅ |          later | P2       |
| calendar                  |                   ✅ |     ❌ initial | CUT      |
| read tracking             |                   ✅ |             ❌ | CUT      |
| team collaboration        |                   ✅ |             ❌ | CUT      |
| CRM                       |                   ✅ |             ❌ | CUT      |
| mobile                    |                   ✅ |             ❌ | CUT      |
| Outlook                   |                   ✅ |             ❌ | CUT      |
| enterprise admin/security |                   ✅ |             ❌ | CUT      |

---

# 36. Where Subzero can actually be better

Do not pitch:

> “Superhuman but free.”

That is weaker than what the architecture allows.

Pitch the concrete differences:

## 36.1 BYOK

Use:

- OpenAI;
- Anthropic through compatible proxy if desired;
- Gemini/OpenRouter/OpenCode/etc. through OpenAI-compatible endpoints;
- local providers later.

The user chooses model economics.

## 36.2 Custom base URL

This allows providers such as OpenCode Zen Go and other compatible gateways.

## 36.3 Evidence-first AI

Every important AI conclusion can expose message IDs.

```text
"Submission closes Sunday at 6 PM."
Sources: [msg_a1] [msg_b9]
```

## 36.4 Open Loops > reminders

Instead of only:

> remind me in 3 days

represent why the conversation remains unresolved.

## 36.5 Open source

Users can audit:

- data access;
- provider calls;
- model prompts;
- storage;
- retention.

## 36.6 Zero required AI subscription

Software cost can remain $0.

The user pays only the provider they choose, if any.

---

# 37. What Subzero should copy from Superhuman aggressively

Not visual assets. Not branding. Not exact UI.

Copy the **engineering principles**:

1. **Keyboard is the primary interface.**
2. **The command palette teaches shortcuts.**
3. **Local state changes before the network round-trip finishes.**
4. **Email is treated as a queue of work, not just a chronological list.**
5. **Classification drives focus.**
6. **AI removes reading and writing, not merely adds chat.**
7. **Follow-up state is first-class.**
8. **Performance is measured as a product feature.**
9. **Search remains available outside the AI path.**
10. **AI drafts are editable and sending remains explicit.**

---

# 38. What Subzero should NOT copy

1. Superhuman branding.
2. Exact visual layout/assets.
3. Full enterprise platform.
4. Every supported provider.
5. Native clients.
6. Five years of indexing on onboarding.
7. Huge AI infrastructure.
8. Team collaboration.
9. Read tracking.
10. Calendar.

Those are the 80% of engineering effort that do not create 80% of the solo user's initial “holy shit, this is faster than Gmail” reaction.

---

# 39. Acceptance definition for the true 80/20 release

Subzero is ready when a real Gmail power user can do this:

```text
Connect Gmail
    ↓
Inbox appears
    ↓
Priority / Needs Reply / Waiting / Other are useful
    ↓
J/K through messages without mouse
    ↓
thread opens immediately
    ↓
summary makes reading optional
    ↓
R
    ↓
type 1-line intent
    ↓
usable reply appears
    ↓
send
    ↓
E
    ↓
next thread
```

And later:

```text
"Which hackathons am I registered for,
and what is the next deadline?"
    ↓
Ask Inbox
    ↓
answer
    ↓
source messages
```

And:

```text
Open Loops
    ↓
"I owe"
"They owe"
"Waiting"
    ↓
nothing important disappears
```

If those three loops are fast and trustworthy, the 80/20 thesis is working.

---

# 40. Recommended next engineering changes based on the current Subzero build

Based on the completion report provided with this research, Subzero already has substantial parity:

- real Gmail OAuth/sync;
- 200-thread sync;
- Focus buckets;
- read/star/archive;
- compose/send;
- BYOK;
- custom OpenAI-compatible Base URL;
- real `deepseek-v4-flash` round-trip;
- evidence summary;
- AI drafting;
- Ask Inbox;
- Open Loops;
- 83 tests.

The next work should **not** be “add more AI.”

Recommended order:

### 1. Make the keyboard loop exceptional

Measure:

- open thread latency;
- next/previous latency;
- archive latency;
- reply composer latency.

Aim for perceived <100 ms locally.

### 2. Make mutations optimistic

Do not block archive/read/star on Gmail API.

Show a pending/error state only if persistence fails.

### 3. Implement the command palette as the central interface

Every major action discoverable in Cmd/Ctrl+K.

### 4. Tighten Focus classification

Use transparent rules/reasons.

Build a small correction feedback loop.

### 5. Add reminder resurface logic to Open Loops

This turns the ledger into an active workflow.

### 6. Add background Auto Draft for top Needs Reply threads

Only a few high-priority threads, not the whole mailbox.

### 7. Add lightweight voice profile

Use selected sent messages.

### 8. Stop

Do not start Outlook/mobile/calendar/team collaboration.

Ship the product.

---

# 41. Final 80/20 verdict

If “80% of Superhuman” means **80% of every feature the company has built**, Subzero is nowhere close, and trying would defeat the project.

If it means:

> **80% of the reason an individual power user experiences Superhuman as dramatically better than ordinary Gmail,**

then the target is much smaller:

```text
FAST LOCAL CLIENT
+
KEYBOARD-FIRST TRIAGE
+
SPLIT / PRIORITY INBOX
+
SUMMARIES
+
AI REPLIES
+
SEARCH / ASK
+
FOLLOW-UP STATE
```

That is the 80/20.

Everything else is secondary until these interactions feel exceptional.

---

# Sources

All technical claims above were based primarily on first-party Superhuman sources.

## Product and feature documentation

**[S1] Superhuman Mail — AI-native email**  
https://superhuman.com/products/mail/ai

**[S2] Superhuman Mail product page**  
https://superhuman.com/products/mail

**[S3] Desktop Shortcuts**  
https://help.superhuman.com/hc/en-us/articles/46005701270541-Desktop-Shortcuts

**[S4] Structure Your Inbox**  
https://help.superhuman.com/hc/en-us/articles/46005793275277-Structure-Your-Inbox

**[S5] Create Your Own Split Inbox**  
https://help.superhuman.com/hc/en-us/articles/46005853223309-Create-Your-Own-Split-Inbox

**[S6] Auto Labels**  
https://help.superhuman.com/hc/en-us/articles/46005657758861-Auto-Labels

**[S7] Organize with AI**  
https://help.superhuman.com/hc/en-us/articles/46005852837773-Organize-with-AI

**[S8] Auto Archive**  
https://help.superhuman.com/hc/en-us/articles/46005662460813-Auto-Archive

**[S9] Auto Summarize**  
https://help.superhuman.com/hc/en-us/articles/46005642123917-Auto-Summarize

**[S10] Instant Reply**  
https://help.superhuman.com/hc/en-us/articles/46005583725709-Instant-Reply

**[S11] Write with AI**  
https://help.superhuman.com/hc/en-us/articles/46005557122957-Write-with-AI

**[S12] Ask AI**  
https://help.superhuman.com/hc/en-us/articles/46005676610829-Ask-AI

**[S13] Auto Reminders & Auto Drafts**  
https://help.superhuman.com/hc/en-us/articles/46005658551053-Auto-Reminders-Auto-Drafts

**[S14] Personalization**  
https://help.superhuman.com/hc/en-us/articles/46005802896781-Personalization

**[S15] Knowledge Base**  
https://help.superhuman.com/hc/en-us/articles/46005666866829-Knowledge-Base

**[S16] Offline Access**  
https://help.superhuman.com/hc/en-us/articles/46005499629325-Offline-Access

**[S17] Managing Accounts**  
https://help.superhuman.com/hc/en-us/articles/46185905319821-Managing-Accounts

**[S18] Shared Conversations**  
https://help.superhuman.com/hc/en-us/articles/46005810472717-Collaborate-Without-the-Chaos

**[S19] Pricing Plans**  
https://help.superhuman.com/hc/en-us/articles/46005733349517-Pricing-Plans

**[S20] Download Superhuman Mail**  
https://help.superhuman.com/hc/en-us/articles/46005778798605-Download-Superhuman-Mail

## Engineering / infrastructure

**[S21] Architecting a web app to “just work” offline**  
https://blog.superhuman.com/architecting-a-web-app-to-just-work-offline-part-1/

**[S22] Building reliable apps on unreliable networks**  
https://blog.superhuman.com/building-reliable-apps-on-unreliable-networks/

**[S23] Delightful search: creating search architecture for power and speed**  
https://blog.superhuman.com/delightful-search-more-than-meets-the-eye/

**[S24] Performance metrics for blazingly fast web apps**  
https://blog.superhuman.com/performance-metrics-for-blazingly-fast-web-apps/

**[S25] Why Superhuman Mail is built for speed**  
https://blog.superhuman.com/superhuman-is-built-for-speed/

**[S26] Superhuman Mail third-party attributions**  
https://superhuman.com/products/mail/oss

**[S27] Superhuman Data Privacy Addendum**  
https://superhuman.com/legal/dpa

---

# Confidence legend

| Label             | Meaning                                                                |
| ----------------- | ---------------------------------------------------------------------- |
| CONFIRMED         | directly described by Superhuman                                       |
| STRONGLY INFERRED | several first-party signals support the conclusion                     |
| HISTORICAL        | directly documented old architecture; modern implementation may differ |
| UNKNOWN           | no reliable public evidence                                            |
