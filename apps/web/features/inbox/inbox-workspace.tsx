"use client";

import {
  Archive,
  ChevronLeft,
  ChevronRight,
  Command,
  FileText,
  Inbox,
  Keyboard,
  ListChecks,
  Mail,
  PencilLine,
  Plus,
  RefreshCw,
  Reply,
  ReplyAll,
  Search,
  Send,
  Settings,
  Sparkles,
  Star,
  Tag,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { sanitizeEmailHtml } from "@subzero/security/client";
import { cacheThreads, loadCachedThreads } from "@/lib/cache";
import { AskInboxPanel } from "@/features/ask-inbox/ask-inbox-panel";
import { matchFocusRule } from "@/features/focus-rules/matcher";
import type { FocusRule } from "@/features/focus-rules/types";
import { OpenLoopsPanel } from "@/features/open-loops/open-loops-panel";
import {
  demoThreads,
  type FocusBucket,
  type InboxThread,
  type MailMessage,
} from "@/lib/demo-data";

type View = "all" | FocusBucket;
type ComposerMode = "new" | "reply" | "reply-all";
type Modal = "connect" | "settings" | "palette" | "help" | null;

type ApiMailAddress = { address: string; name?: string };
type ApiMailMessage = {
  id: string;
  from?: ApiMailAddress;
  to: ApiMailAddress[];
  cc?: ApiMailAddress[];
  headers?: Record<string, string>;
  sentAt?: string;
  body?: string;
  htmlBody?: string;
  snippet: string;
};
type ApiMailThread = {
  id: string;
  latestMessageId: string;
  subject: string;
  participants: ApiMailAddress[];
  preview: string;
  unread: boolean;
  labelIds: string[];
  updatedAt?: string;
  messages: ApiMailMessage[];
  bucket?: FocusBucket;
  triage?: {
    bucket: FocusBucket;
    confidence: number;
    reasons: string[];
    sourceMessageIds: string[];
  };
  summary?: {
    summary: string;
    latestDelta: string | null;
    actionRequired: string | null;
    deadline: string | null;
    sourceMessageIds: string[];
  };
  mailboxAddress?: string;
};
type ApiMailThreadPage = {
  threads: ApiMailThread[];
  nextPageToken?: string;
  totalEstimate?: number;
  mailboxAddress?: string;
};
type ApiResult<T> = {
  ok: boolean;
  data?: T;
  error?: { code?: string; message?: string };
};

const viewLabels: Record<View, string> = {
  all: "Inbox",
  priority: "Priority",
  needs_reply: "Needs Reply",
  waiting: "Waiting",
  other: "Other",
};

const today = () =>
  new Intl.DateTimeFormat("en", { month: "short", day: "numeric" }).format(
    new Date(),
  );

function buildSummary(thread: InboxThread) {
  const newest = thread.messages.at(-1)!;
  const sentences = [
    `${thread.sender} is discussing “${thread.subject}”.`,
    newest.text.length > 155 ? `${newest.text.slice(0, 152)}…` : newest.text,
    thread.bucket === "needs_reply"
      ? "A reply from you is likely needed."
      : "The original messages remain available below.",
  ];
  return {
    summary: sentences.join(" "),
    latestDelta: newest.text,
    actionRequired:
      thread.bucket === "needs_reply" ? "Reply to the latest request" : null,
    deadline: /thursday/i.test(newest.text) ? "Thursday" : null,
    sourceMessageIds: [newest.id],
    cachedForMessageId: thread.latestMessageId,
  };
}

function matchesSearch(thread: InboxThread, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  const from = normalized.match(/^from:([^\s]+)/)?.[1];
  if (from) return thread.sender.toLowerCase().includes(from);
  if (normalized === "is:unread") return thread.unread;
  return [thread.sender, thread.subject, thread.preview, ...thread.labels]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

function isTypingTarget(target: EventTarget | null) {
  const element = target as HTMLElement | null;
  return Boolean(
    element &&
    (element.tagName === "INPUT" ||
      element.tagName === "TEXTAREA" ||
      element.tagName === "SELECT" ||
      element.isContentEditable),
  );
}

function displayAddress(address: ApiMailAddress) {
  return address.name
    ? `${address.name} <${address.address}>`
    : address.address;
}

function emailFromDisplay(value: string): string {
  return value.match(/<([^>]+)>/)?.[1]?.trim() ?? value.trim();
}

function deterministicFocus(
  thread: Pick<
    ApiMailThread,
    "unread" | "labelIds" | "participants" | "preview"
  >,
): { bucket: FocusBucket; reasons: string[] } {
  const compact =
    `${thread.preview} ${thread.participants.map((person) => person.address).join(" ")}`.toLowerCase();
  if (
    thread.labelIds.includes("CATEGORY_PROMOTIONS") ||
    /newsletter|unsubscribe|no-reply/.test(compact)
  )
    return { bucket: "other", reasons: ["Newsletter or automated sender"] };
  if (/waiting|i will|i'll|will send|no action needed/.test(compact))
    return {
      bucket: "waiting",
      reasons: ["Follow-up expected from the other party"],
    };
  if (thread.unread && /\?|please|could you|can you|need/.test(compact))
    return { bucket: "needs_reply", reasons: ["Unread direct request"] };
  return {
    bucket: thread.unread ? "priority" : "other",
    reasons: [
      thread.unread
        ? "Unread active thread"
        : "No deterministic priority signal",
    ],
  };
}

export function inboxThreadFromApi(
  thread: ApiMailThread,
  mailboxAddress?: string,
  focusRules: readonly FocusRule[] = [],
): InboxThread {
  const customRule = matchFocusRule(thread, focusRules);
  const focus = customRule
    ? {
        bucket: customRule.bucket,
        reasons: [
          `Custom rule: ${customRule.field} contains “${customRule.pattern}”`,
        ],
      }
    : thread.bucket
      ? {
          bucket: thread.bucket,
          reasons: thread.triage?.reasons ?? ["Stored Focus classification"],
        }
      : deterministicFocus(thread);
  const messages = thread.messages.map((message) => ({
    id: message.id,
    from: message.from ? displayAddress(message.from) : "Unknown sender",
    to: message.to.map(displayAddress),
    cc: message.cc?.map(displayAddress),
    headers: message.headers,
    sentAt: message.sentAt ?? "",
    html: message.htmlBody ?? `<p>${message.body ?? message.snippet}</p>`,
    text: message.body ?? message.snippet,
  }));
  const sender =
    messages.at(-1)?.from ??
    (thread.participants[0]
      ? displayAddress(thread.participants[0])
      : "Unknown sender");
  return {
    id: thread.id,
    latestMessageId: thread.latestMessageId,
    sender,
    participants: thread.participants.map(displayAddress),
    subject: thread.subject,
    preview: thread.preview,
    date: thread.updatedAt
      ? new Date(thread.updatedAt).toLocaleDateString()
      : "",
    unread: thread.unread,
    archived: false,
    labels: thread.labelIds,
    bucket: focus.bucket,
    reasons: focus.reasons,
    followUp: false,
    messages,
    mailboxAddress: thread.mailboxAddress ?? mailboxAddress,
    summary: thread.summary
      ? { ...thread.summary, cachedForMessageId: thread.latestMessageId }
      : undefined,
  };
}

function applyFocusRuleToDemoThread(
  thread: InboxThread,
  focusRules: readonly FocusRule[],
): InboxThread {
  const matched = matchFocusRule(
    {
      subject: thread.subject,
      preview: thread.preview,
      participants: thread.participants.map((participant) => ({
        address: emailFromDisplay(participant),
      })),
      messages: thread.messages.map((message) => ({
        to: message.to.map((recipient) => ({
          address: emailFromDisplay(recipient),
        })),
        body: message.text,
        snippet: message.text,
      })),
    },
    focusRules,
  );
  return matched
    ? {
        ...thread,
        bucket: matched.bucket,
        reasons: [
          `Custom rule: ${matched.field} contains “${matched.pattern}”`,
        ],
      }
    : thread;
}

function SafeMessage({ message }: { message: MailMessage }) {
  const [loadImages, setLoadImages] = useState(false);
  const html = useMemo(
    () => sanitizeEmailHtml(message.html, { allowRemoteImages: loadImages }),
    [loadImages, message.html],
  );
  const hadRemoteImage =
    /<img\b/i.test(message.html) && /https?:\/\//i.test(message.html);

  return (
    <article
      className="message"
      id={`message-${message.id}`}
      data-testid={`message-${message.id}`}
    >
      <header className="message-head">
        <span>{message.from}</span>
        <time>{message.sentAt}</time>
      </header>
      <div
        className="message-body"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      {hadRemoteImage && !loadImages ? (
        <div className="message-body" style={{ paddingTop: 0 }}>
          <button
            className="secondary-button"
            onClick={() => setLoadImages(true)}
          >
            Load images
          </button>
        </div>
      ) : null}
    </article>
  );
}

export function InboxWorkspace() {
  const demoMode = process.env.NEXT_PUBLIC_SUBZERO_DEMO_MODE === "true";
  const [threads, setThreads] = useState<InboxThread[]>([]);
  const [view, setView] = useState<View>("all");
  const [openLoopsView, setOpenLoopsView] = useState(false);
  const [focusRules, setFocusRules] = useState<FocusRule[]>([]);
  const focusRulesRef = useRef<readonly FocusRule[]>(focusRules);
  focusRulesRef.current = focusRules;
  const [selectedId, setSelectedId] = useState<string>("thread-maya-contract");
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [connected, setConnected] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const [composerMode, setComposerMode] = useState<ComposerMode | null>(null);
  const [composerText, setComposerText] = useState("");
  const [draftIntent, setDraftIntent] = useState("");
  const [draftUndo, setDraftUndo] = useState<string | null>(null);
  const [isDrafting, setIsDrafting] = useState(false);
  const [sendState, setSendState] = useState<"idle" | "sent" | "failed">(
    "idle",
  );
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [aiError, setAiError] = useState<string | null>(null);
  const [forceMutationFailure, setForceMutationFailure] = useState(false);
  const [forceProviderDown, setForceProviderDown] = useState(false);
  const [provider, setProvider] = useState("openai-compatible");
  const [model, setModel] = useState("gpt-4.1-mini");
  const [keyInput, setKeyInput] = useState("");
  const [keyConfigured, setKeyConfigured] = useState(false);
  const [settingsNotice, setSettingsNotice] = useState<string | null>(null);
  const [authNotice, setAuthNotice] = useState<string | null>(null);
  const [composerRecipients, setComposerRecipients] = useState("");
  const [composerSubject, setComposerSubject] = useState("");
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftAbort = useRef<AbortController | null>(null);

  const loadLiveThreads = useCallback(
    async (gmailQuery?: string, pageToken?: string) => {
      const appending = Boolean(pageToken);
      if (appending) setIsLoadingMore(true);
      else setIsLoading(true);
      setMutationError(null);
      try {
        const endpoint = gmailQuery?.trim()
          ? `/api/mail/search?q=${encodeURIComponent(gmailQuery)}&limit=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`
          : `/api/mail/threads?limit=200${pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ""}`;
        const response = await fetch(endpoint, { credentials: "same-origin" });
        const result = (await response.json()) as ApiResult<
          ApiMailThreadPage | Array<{ thread: ApiMailThread }>
        >;
        if (!response.ok || !result.ok || !result.data) {
          const code = result.error?.code;
          setConnected(false);
          if (code === "ACCOUNT_REQUIRED" || code === "OAUTH_REVOKED") {
            setThreads([]);
          }
          setAuthNotice(
            code === "OAUTH_REVOKED"
              ? "Gmail access was revoked. Reconnect to continue."
              : (result.error?.message ?? "Connect Gmail to load your inbox."),
          );
          return;
        }
        const rawThreads = Array.isArray(result.data)
          ? result.data.map((entry) => entry.thread)
          : result.data.threads;
        const mailboxAddress = Array.isArray(result.data)
          ? undefined
          : result.data.mailboxAddress;
        const normalized = rawThreads.map((thread) =>
          inboxThreadFromApi(thread, mailboxAddress, focusRulesRef.current),
        );
        setThreads((current) =>
          appending
            ? [
                ...current,
                ...normalized.filter(
                  (thread) =>
                    !current.some((existing) => existing.id === thread.id),
                ),
              ]
            : normalized,
        );
        if (!appending) setSelectedId(normalized[0]?.id ?? "");
        setNextPageToken(
          Array.isArray(result.data)
            ? null
            : (result.data.nextPageToken ?? null),
        );
        setConnected(true);
        setAuthNotice(null);
      } catch {
        setAuthNotice(
          "Network error while loading Gmail. Retry when the connection returns.",
        );
      } finally {
        setIsLoading(false);
        setIsLoadingMore(false);
      }
    },
    [],
  );

  useEffect(() => {
    let active = true;
    void (async () => {
      const demoConnected =
        demoMode &&
        window.localStorage.getItem("subzero-demo-connected") === "true";
      if (demoMode && !demoConnected) {
        setConnected(false);
        setIsLoading(false);
        return;
      }
      try {
        const cached = await loadCachedThreads();
        const usableCached = demoMode
          ? cached
          : cached.filter((thread) => Boolean(thread.mailboxAddress));
        if (active && usableCached.length) {
          setThreads(
            usableCached.map((thread) =>
              applyFocusRuleToDemoThread(thread, focusRulesRef.current),
            ),
          );
          setSelectedId((current) =>
            usableCached.some((thread) => thread.id === current)
              ? current
              : usableCached[0].id,
          );
          setIsLoading(false);
        } else if (active && demoMode) {
          setThreads(
            demoThreads().map((thread) =>
              applyFocusRuleToDemoThread(thread, focusRulesRef.current),
            ),
          );
        }
      } finally {
        if (!active) return;
        if (!demoMode) {
          const params = new URLSearchParams(window.location.search);
          if (params.get("auth") === "error") {
            setAuthNotice(
              params.get("reason") === "reconnect"
                ? "Gmail access was revoked. Reconnect to continue."
                : "Gmail connection could not be completed.",
            );
          }
          void loadLiveThreads();
        } else {
          setConnected(demoConnected);
          setIsLoading(false);
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [demoMode, loadLiveThreads]);

  useEffect(() => {
    if (!connected) return;
    let active = true;
    void fetch("/api/settings/focus-rules", { credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as ApiResult<{
          rules?: FocusRule[];
        }>;
        if (active && result.ok && result.data?.rules)
          setFocusRules(result.data.rules);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [connected]);

  useEffect(() => {
    if (!focusRules.length) return;
    setThreads((current) =>
      current.map((thread) => applyFocusRuleToDemoThread(thread, focusRules)),
    );
  }, [focusRules]);

  useEffect(() => {
    if (!isLoading) void cacheThreads(threads).catch(() => undefined);
  }, [isLoading, threads]);

  useEffect(() => {
    if (demoMode || !connected) return;
    const timer = window.setInterval(() => void loadLiveThreads(), 5 * 60_000);
    return () => window.clearInterval(timer);
  }, [connected, demoMode, loadLiveThreads]);

  useEffect(() => {
    if (demoMode || !connected) return;
    const timer = window.setTimeout(() => void loadLiveThreads(query), 250);
    return () => window.clearTimeout(timer);
  }, [connected, demoMode, loadLiveThreads, query]);

  useEffect(() => {
    if (modal !== "settings") return;
    void fetch(
      `/api/settings/provider-key?provider=${encodeURIComponent(provider)}`,
      { credentials: "same-origin" },
    )
      .then(async (response) => {
        if (!response.ok) return;
        const result = (await response.json()) as { configured?: boolean };
        setKeyConfigured(Boolean(result.configured));
      })
      .catch(() => undefined);
  }, [modal, provider]);

  useEffect(
    () => () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
      draftAbort.current?.abort();
    },
    [],
  );

  const visibleThreads = useMemo(
    () =>
      threads.filter(
        (thread) =>
          !thread.archived &&
          (view === "all" || thread.bucket === view) &&
          (!demoMode || matchesSearch(thread, query)),
      ),
    [demoMode, query, threads, view],
  );
  const selectedThread =
    threads.find((thread) => thread.id === selectedId && !thread.archived) ??
    visibleThreads[0] ??
    null;

  useEffect(() => {
    if (selectedThread && selectedThread.id !== selectedId)
      setSelectedId(selectedThread.id);
  }, [selectedId, selectedThread]);

  const updateThread = useCallback(
    (id: string, updater: (thread: InboxThread) => InboxThread) => {
      setThreads((current) =>
        current.map((thread) => (thread.id === id ? updater(thread) : thread)),
      );
    },
    [],
  );

  const applyOptimistic = useCallback(
    (
      label: string,
      updater: (thread: InboxThread) => InboxThread,
      request?: {
        path: string;
        method?: "POST" | "DELETE";
        body?: Record<string, unknown>;
      },
    ) => {
      if (!selectedThread) return;
      const before = selectedThread;
      updateThread(before.id, updater);
      setMutationError(null);
      if (demoMode && forceMutationFailure) {
        window.setTimeout(() => {
          updateThread(before.id, () => before);
          setMutationError(
            `${label} could not reach Gmail. Local state was restored; Gmail remains canonical.`,
          );
        }, 180);
      }
      if (!demoMode && request) {
        void (async () => {
          try {
            const response = await fetch(
              `/api/mail/threads/${encodeURIComponent(before.id)}/${request.path}`,
              {
                method: request.method ?? "POST",
                headers: request.body
                  ? { "Content-Type": "application/json" }
                  : undefined,
                body: request.body ? JSON.stringify(request.body) : undefined,
                credentials: "same-origin",
              },
            );
            const result = (await response.json()) as ApiResult<unknown>;
            if (!response.ok || !result.ok) {
              updateThread(before.id, () => before);
              setMutationError(
                `${label} could not reach Gmail. Local state was restored; Gmail remains canonical.`,
              );
            }
          } catch {
            updateThread(before.id, () => before);
            setMutationError(
              `${label} could not reach Gmail. Local state was restored; Gmail remains canonical.`,
            );
          }
        })();
      }
    },
    [demoMode, forceMutationFailure, selectedThread, updateThread],
  );

  const selectRelative = useCallback(
    (delta: number) => {
      if (!visibleThreads.length) return;
      const currentIndex = Math.max(
        0,
        visibleThreads.findIndex((thread) => thread.id === selectedId),
      );
      const nextIndex = Math.min(
        visibleThreads.length - 1,
        Math.max(0, currentIndex + delta),
      );
      setSelectedId(visibleThreads[nextIndex].id);
    },
    [selectedId, visibleThreads],
  );

  const selectThread = useCallback(
    async (id: string) => {
      setSelectedId(id);
      if (demoMode) return;
      try {
        const response = await fetch(
          `/api/mail/threads/${encodeURIComponent(id)}`,
          { credentials: "same-origin" },
        );
        const result = (await response.json()) as ApiResult<ApiMailThread>;
        if (!response.ok || !result.ok || !result.data) {
          setMutationError(
            result.error?.message ?? "Could not open the latest Gmail thread.",
          );
          return;
        }
        const fullThread = inboxThreadFromApi(result.data);
        setThreads((current) => {
          const existing = current.find((thread) => thread.id === id);
          const nextThread = {
            ...fullThread,
            bucket: fullThread.bucket,
            reasons: fullThread.reasons,
            followUp: existing?.followUp ?? false,
            summary: fullThread.summary ?? existing?.summary,
          };
          return existing
            ? current.map((thread) => (thread.id === id ? nextThread : thread))
            : [...current, nextThread];
        });
      } catch {
        setMutationError("Network error while opening this Gmail thread.");
      }
    },
    [demoMode],
  );

  const openLoopSource = useCallback(
    async (threadId: string, sourceMessageId: string | null) => {
      setOpenLoopsView(false);
      setView("all");
      await selectThread(threadId);
      if (sourceMessageId) {
        window.setTimeout(() => {
          document
            .getElementById(`message-${sourceMessageId}`)
            ?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 0);
      }
    },
    [selectThread],
  );

  const openComposer = useCallback(
    (mode: ComposerMode) => {
      if (!selectedThread && mode !== "new") return;
      setComposerMode(mode);
      setComposerText("");
      setDraftIntent("");
      setDraftUndo(null);
      setSendState("idle");
      setAiError(null);
      if (mode === "new" || !selectedThread) {
        setComposerRecipients("");
      } else {
        const newest = selectedThread.messages.at(-1);
        const selfAddress = selectedThread.mailboxAddress?.toLowerCase();
        const candidates =
          mode === "reply"
            ? newest?.from
              ? [newest.from]
              : selectedThread.participants
            : [
                newest?.from,
                ...(newest?.to ?? []),
                ...(newest?.cc ?? []),
                ...selectedThread.participants,
              ].filter((value): value is string => Boolean(value));
        const recipients = Array.from(
          new Map(
            candidates
              .filter((recipient) => {
                const address = emailFromDisplay(recipient).toLowerCase();
                return (
                  !recipient.startsWith("You ") &&
                  (!selfAddress || address !== selfAddress)
                );
              })
              .map((recipient) => [
                emailFromDisplay(recipient).toLowerCase(),
                recipient,
              ]),
          ).values(),
        );
        setComposerRecipients(recipients.join(", "));
      }
      setComposerSubject(mode === "new" ? "" : (selectedThread?.subject ?? ""));
    },
    [selectedThread],
  );

  const toggleFollowUp = useCallback(() => {
    if (!selectedThread) return;
    updateThread(selectedThread.id, (thread) => ({
      ...thread,
      followUp: !thread.followUp,
    }));
  }, [selectedThread, updateThread]);

  const generateDraft = useCallback(() => {
    if (!selectedThread) return;
    if (
      demoMode &&
      (forceProviderDown || keyInput.toLowerCase().includes("invalid"))
    ) {
      setAiError(
        "AI provider unavailable. Your manual composer remains editable.",
      );
      return;
    }
    if (!demoMode) {
      draftAbort.current?.abort();
      const controller = new AbortController();
      draftAbort.current = controller;
      setDraftUndo(composerText);
      setIsDrafting(true);
      setAiError(null);
      void (async () => {
        try {
          const response = await fetch("/api/ai/draft", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              threadId: selectedThread.id,
              intent: draftIntent,
            }),
            credentials: "same-origin",
            signal: controller.signal,
          });
          if (!response.ok) {
            const result = (await response.json()) as ApiResult<{
              draft: string;
            }>;
            throw new Error(
              result.error?.message ?? "AI provider unavailable.",
            );
          }
          if (response.headers.get("content-type")?.includes("text/plain")) {
            const reader = response.body?.getReader();
            if (!reader) throw new Error("AI draft stream was unavailable.");
            const decoder = new TextDecoder();
            let streamedDraft = "";
            setComposerText("");
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              streamedDraft += decoder.decode(value, { stream: true });
              setComposerText(streamedDraft);
            }
          } else {
            const result = (await response.json()) as ApiResult<{
              draft: string;
            }>;
            if (!result.ok || !result.data)
              throw new Error(
                result.error?.message ?? "AI provider unavailable.",
              );
            setComposerText(result.data.draft);
          }
        } catch (cause) {
          if (!controller.signal.aborted)
            setAiError(
              cause instanceof Error
                ? cause.message
                : "AI provider unavailable. Your manual composer remains editable.",
            );
        } finally {
          if (!controller.signal.aborted) setIsDrafting(false);
        }
      })();
      return;
    }
    if (draftTimer.current) clearTimeout(draftTimer.current);
    setDraftUndo(composerText);
    setIsDrafting(true);
    setAiError(null);
    draftTimer.current = setTimeout(() => {
      const greeting = selectedThread.sender.split(" ")[0];
      const intent =
        draftIntent.trim() ||
        "Thanks for the update. I will follow up shortly.";
      setComposerText(`Hi ${greeting},\n\n${intent}\n\nBest,\nYou`);
      setIsDrafting(false);
      draftTimer.current = null;
    }, 260);
  }, [
    composerText,
    demoMode,
    draftIntent,
    forceProviderDown,
    keyInput,
    selectedThread,
  ]);

  const cancelDraft = () => {
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = null;
    draftAbort.current?.abort();
    draftAbort.current = null;
    setIsDrafting(false);
  };

  const sendDraft = () => {
    if (!composerText.trim()) {
      setSendState("failed");
      return;
    }
    if (demoMode && forceMutationFailure) {
      setSendState("failed");
      return;
    }
    if (!demoMode) {
      const recipients = composerRecipients
        .split(",")
        .map(
          (recipient) =>
            recipient.trim().match(/<([^>]+)>/)?.[1] ?? recipient.trim(),
        )
        .filter(Boolean);
      if (!recipients.length || !composerSubject.trim()) {
        setSendState("failed");
        return;
      }
      void (async () => {
        try {
          const draftResponse = await fetch("/api/mail/drafts", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({
              to: recipients,
              subject: composerSubject,
              body: composerText,
              ...(composerMode !== "new" && selectedThread
                ? {
                    threadId: selectedThread.id,
                    replyToMessageId:
                      selectedThread.messages.at(-1)?.headers?.["message-id"] ??
                      selectedThread.latestMessageId,
                    references: selectedThread.messages
                      .at(-1)
                      ?.headers?.references?.split(/\s+/)
                      .filter(Boolean),
                  }
                : {}),
            }),
          });
          const draftResult = (await draftResponse.json()) as ApiResult<{
            id: string;
          }>;
          if (!draftResponse.ok || !draftResult.ok || !draftResult.data)
            throw new Error(
              draftResult.error?.message ?? "Draft could not be created.",
            );
          const sendResponse = await fetch(
            `/api/mail/drafts/${encodeURIComponent(draftResult.data.id)}/send`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({ confirm: true }),
            },
          );
          const sendResult = (await sendResponse.json()) as ApiResult<unknown>;
          if (!sendResponse.ok || !sendResult.ok)
            throw new Error(
              sendResult.error?.message ??
                "Draft remains recoverable after send failure.",
            );
          setSendState("sent");
        } catch {
          setSendState("failed");
        }
      })();
      return;
    }
    setSendState("sent");
  };

  const makeSummary = () => {
    if (!selectedThread) return;
    if (
      demoMode &&
      (forceProviderDown || keyInput.toLowerCase().includes("invalid"))
    ) {
      setAiError(
        "Summary unavailable because the configured provider key was rejected. Read the original thread below or update your key.",
      );
      return;
    }
    if (!demoMode) {
      void (async () => {
        try {
          const response = await fetch("/api/ai/summary", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            credentials: "same-origin",
            body: JSON.stringify({ threadId: selectedThread.id }),
          });
          const result = (await response.json()) as ApiResult<
            Omit<NonNullable<InboxThread["summary"]>, "cachedForMessageId">
          >;
          if (!response.ok || !result.ok || !result.data)
            throw new Error(result.error?.message ?? "Summary unavailable.");
          updateThread(selectedThread.id, (thread) => ({
            ...thread,
            summary: {
              ...result.data!,
              cachedForMessageId: thread.latestMessageId,
            },
          }));
          setAiError(null);
        } catch (cause) {
          setAiError(
            cause instanceof Error
              ? cause.message
              : "Summary unavailable. Read the original thread below.",
          );
        }
      })();
      return;
    }
    updateThread(selectedThread.id, (thread) => ({
      ...thread,
      summary: buildSummary(thread),
    }));
    setAiError(null);
  };

  const refineTriage = () => {
    if (!selectedThread) return;
    if (demoMode) return;
    void (async () => {
      try {
        const response = await fetch("/api/ai/triage", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "same-origin",
          body: JSON.stringify({ threadId: selectedThread.id }),
        });
        const result = (await response.json()) as ApiResult<{
          triage: { bucket: FocusBucket; reasons: string[] };
        }>;
        if (!response.ok || !result.ok || !result.data)
          throw new Error(result.error?.message ?? "AI triage unavailable.");
        updateThread(selectedThread.id, (thread) => ({
          ...thread,
          bucket: result.data!.triage.bucket,
          reasons: result.data!.triage.reasons,
        }));
      } catch (cause) {
        setAiError(
          cause instanceof Error
            ? cause.message
            : "AI triage unavailable. Focus Views remain usable.",
        );
      }
    })();
  };

  const setManualBucket = (bucket: FocusBucket) => {
    if (!selectedThread) return;
    const threadId = selectedThread.id;
    updateThread(threadId, (thread) => ({
      ...thread,
      bucket,
      reasons: ["Manual correction"],
    }));
    if (demoMode) return;
    void fetch("/api/ai/triage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ threadId, bucket }),
    })
      .then(async (response) => {
        if (!response.ok) {
          const result = (await response.json()) as ApiResult<unknown>;
          throw new Error(
            result.error?.message ?? "Could not save Focus correction.",
          );
        }
      })
      .catch((cause) =>
        setAiError(
          cause instanceof Error
            ? cause.message
            : "Could not save Focus correction.",
        ),
      );
  };

  const startConnect = () => {
    if (demoMode) {
      window.localStorage.setItem("subzero-demo-connected", "true");
      setConnected(true);
      setThreads(demoThreads());
      setSelectedId("thread-maya-contract");
      setModal(null);
      return;
    }
    window.location.assign("/api/auth/google");
  };

  const providerKeyAction = async (action: "save" | "test" | "remove") => {
    if (action === "save" && !keyInput.trim()) {
      setSettingsNotice("Enter a provider key to save.");
      return;
    }
    try {
      const response = await fetch("/api/settings/provider-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, provider, model, key: keyInput }),
      });
      const body = (await response.json()) as {
        error?: string;
        configured?: boolean;
        ok?: boolean;
      };
      if (!response.ok) {
        setSettingsNotice(body.error ?? "Provider settings request failed.");
        return;
      }
      if (action === "save") {
        setKeyConfigured(Boolean(body.configured));
        setKeyInput("");
        setSettingsNotice(
          "Key stored encrypted. It will not be displayed again.",
        );
      } else if (action === "remove") {
        setKeyConfigured(false);
        setKeyInput("");
        setSettingsNotice("Provider key removed.");
      } else {
        setSettingsNotice("Connection test succeeded.");
      }
    } catch {
      setSettingsNotice("Could not reach the Subzero settings service.");
    }
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (event.key === "Escape") {
        event.preventDefault();
        cancelDraft();
        setModal(null);
        setComposerMode(null);
        return;
      }
      if (isTypingTarget(event.target)) return;
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        setModal("palette");
        return;
      }
      if (!selectedThread && key !== "c" && key !== "/") return;
      if (key === "j") {
        event.preventDefault();
        selectRelative(1);
      }
      if (key === "k") {
        event.preventDefault();
        selectRelative(-1);
      }
      if (event.key === "Enter") {
        event.preventDefault();
        selectedThread && void selectThread(selectedThread.id);
      }
      if (key === "e") {
        event.preventDefault();
        applyOptimistic(
          "Archive",
          (thread) => ({ ...thread, archived: true }),
          { path: "archive" },
        );
      }
      if (key === "u") {
        event.preventDefault();
        applyOptimistic(
          "Read state",
          (thread) => ({ ...thread, unread: !thread.unread }),
          { path: selectedThread?.unread ? "read" : "unread" },
        );
      }
      if (key === "r") {
        event.preventDefault();
        openComposer("reply");
      }
      if (key === "c") {
        event.preventDefault();
        openComposer("new");
      }
      if (key === "f") {
        event.preventDefault();
        toggleFollowUp();
      }
      if (key === "/") {
        event.preventDefault();
        searchInput.current?.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    applyOptimistic,
    openComposer,
    selectRelative,
    selectThread,
    selectedThread,
    toggleFollowUp,
  ]);

  const navCount = (bucket?: FocusBucket) =>
    threads.filter(
      (thread) => !thread.archived && (!bucket || thread.bucket === bucket),
    ).length;
  return (
    <main className="app-shell" aria-label="Subzero Mail inbox">
      <aside className="sidebar" aria-label="Mailbox views">
        <div className="brand">
          <span className="brand-mark">✦</span>
          <span>
            SUBZERO<small>MAIL / BYOK</small>
          </span>
        </div>
        <button className="primary-button" onClick={() => openComposer("new")}>
          <Plus size={15} /> Compose <span className="shortcut">C</span>
        </button>
        <nav>
          <p className="nav-label">Focus views</p>
          {(
            ["all", "priority", "needs_reply", "waiting", "other"] as View[]
          ).map((item) => (
            <button
              key={item}
              className={`nav-button ${view === item ? "active" : ""}`}
              onClick={() => {
                setView(item);
                setOpenLoopsView(false);
              }}
            >
              <span>{viewLabels[item]}</span>
              <span className="shortcut">
                {navCount(item === "all" ? undefined : item)}
              </span>
            </button>
          ))}
        </nav>
        <div>
          <p className="nav-label">Follow-up</p>
          <button
            className={`nav-button ${openLoopsView ? "active" : ""}`}
            data-testid="open-loops-nav"
            onClick={() => setOpenLoopsView(true)}
          >
            <span>
              <ListChecks size={14} /> Open Loops
            </span>
          </button>
        </div>
        <div>
          <p className="nav-label">Tools</p>
          <button className="nav-button" onClick={() => setModal("palette")}>
            <span>
              <Command size={14} /> Command palette
            </span>
            <span className="shortcut">⌘K</span>
          </button>
          <button className="nav-button" onClick={() => setModal("settings")}>
            <span>
              <Settings size={14} /> BYOK settings
            </span>
          </button>
          <button className="nav-button" onClick={() => setModal("help")}>
            <span>
              <Keyboard size={14} /> Keyboard guide
            </span>
          </button>
        </div>
        <div className="sidebar-footer">
          <button
            className="text-button"
            data-testid="connect-gmail"
            onClick={() => setModal("connect")}
          >
            <span>
              <Mail size={14} />{" "}
              {connected ? "Gmail connected" : "Connect Gmail"}
            </span>
            <span className={`status-dot ${connected ? "" : "warn"}`} />
          </button>
          <span className="progress">
            {demoMode
              ? "Demo fixture • no mailbox data sent"
              : "Gmail API mode"}
          </span>
        </div>
      </aside>

      <section
        className="list-panel"
        aria-label={openLoopsView ? "Open Loops" : "Thread list"}
      >
        {openLoopsView ? (
          <OpenLoopsPanel
            selectedThread={selectedThread}
            onOpenSource={(threadId, sourceMessageId) =>
              void openLoopSource(threadId, sourceMessageId)
            }
          />
        ) : (
          <>
            <div className="list-toolbar">
              <div className="list-header">
                <div>
                  <h1>{viewLabels[view]}</h1>
                  <p>
                    {visibleThreads.length} active threads • {today()}
                  </p>
                </div>
                <button
                  className="icon-button"
                  aria-label="Refresh inbox"
                  onClick={() =>
                    demoMode
                      ? (setIsLoading(true),
                        window.setTimeout(() => setIsLoading(false), 160))
                      : void loadLiveThreads(query)
                  }
                >
                  <RefreshCw size={16} />
                </button>
              </div>
              <div className="search-wrap">
                <Search
                  size={15}
                  style={{
                    position: "absolute",
                    left: 10,
                    top: 10,
                    color: "var(--muted)",
                  }}
                />
                <input
                  ref={searchInput}
                  className="field"
                  style={{ paddingLeft: 32 }}
                  aria-label="Search Gmail"
                  placeholder="Search Gmail: from:sarah invoice"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                />
                <span className="shortcut">/</span>
              </div>
            </div>
            <div className="thread-list" aria-live="polite">
              {isLoading ? (
                <div className="empty-state">
                  Syncing recent thread metadata…
                </div>
              ) : null}
              {!isLoading && !visibleThreads.length ? (
                <div className="empty-state">
                  {query
                    ? "No Gmail search results."
                    : "No threads in this Focus View."}
                </div>
              ) : null}
              {!isLoading &&
                visibleThreads.map((thread) => (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    selected={thread.id === selectedThread?.id}
                    onSelect={() => void selectThread(thread.id)}
                  />
                ))}
              {!demoMode && nextPageToken ? (
                <div className="empty-state">
                  <button
                    className="secondary-button"
                    disabled={isLoadingMore}
                    onClick={() => void loadLiveThreads(query, nextPageToken)}
                  >
                    {isLoadingMore
                      ? "Loading older mail…"
                      : "Load more Gmail threads"}
                  </button>
                </div>
              ) : null}
            </div>
          </>
        )}
      </section>

      <section className="detail-panel" aria-label="Thread detail">
        <div className="detail-toolbar">
          <div className="toolbar-group">
            <button
              className="icon-button"
              aria-label="Previous thread"
              onClick={() => selectRelative(-1)}
            >
              <ChevronLeft size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Next thread"
              onClick={() => selectRelative(1)}
            >
              <ChevronRight size={17} />
            </button>
          </div>
          <div className="toolbar-group">
            <button
              className="icon-button"
              aria-label="Archive thread"
              data-testid="archive-thread"
              onClick={() =>
                applyOptimistic(
                  "Archive",
                  (thread) => ({ ...thread, archived: true }),
                  { path: "archive" },
                )
              }
            >
              <Archive size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="Toggle read state"
              onClick={() =>
                applyOptimistic(
                  "Read state",
                  (thread) => ({ ...thread, unread: !thread.unread }),
                  { path: selectedThread?.unread ? "read" : "unread" },
                )
              }
            >
              <Mail size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="Toggle Gmail STARRED label"
              onClick={() => {
                const hasLabel =
                  selectedThread?.labels.includes("STARRED") ?? false;
                applyOptimistic(
                  "Label",
                  (thread) => ({
                    ...thread,
                    labels: thread.labels.includes("STARRED")
                      ? thread.labels.filter((label) => label !== "STARRED")
                      : [...thread.labels, "STARRED"],
                  }),
                  {
                    path: "labels",
                    method: hasLabel ? "DELETE" : "POST",
                    body: { labelId: "STARRED" },
                  },
                );
              }}
            >
              <Tag size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="Reply"
              onClick={() => openComposer("reply")}
            >
              <Reply size={16} />
            </button>
            <button
              className="icon-button"
              aria-label="Reply all"
              onClick={() => openComposer("reply-all")}
            >
              <ReplyAll size={16} />
            </button>
          </div>
        </div>
        {mutationError ? (
          <div className="ai-error" role="alert">
            {mutationError}
          </div>
        ) : null}
        {authNotice ? (
          <div className="ai-error" role="alert">
            <b>Gmail disconnected.</b> {authNotice}{" "}
            <button
              className="secondary-button"
              onClick={() => setModal("connect")}
            >
              Reconnect Gmail
            </button>
          </div>
        ) : null}
        <AskInboxPanel
          demoMode={demoMode}
          threads={threads.filter((thread) => !thread.archived)}
          onOpenSource={({ threadId, messageId }) =>
            void openLoopSource(threadId, messageId)
          }
        />
        {selectedThread ? (
          <div className="thread-detail">
            <ThreadDetail
              thread={selectedThread}
              demoMode={demoMode}
              onSummary={makeSummary}
              onRefineTriage={refineTriage}
              onSetBucket={setManualBucket}
              onOpenMessage={(id) =>
                document
                  .getElementById(`message-${id}`)
                  ?.scrollIntoView({ behavior: "smooth", block: "center" })
              }
            />
          </div>
        ) : (
          <div className="empty-state">
            Choose a thread to read its original Gmail content.
          </div>
        )}
        {aiError ? (
          <div className="composer">
            <div className="ai-error" role="alert">
              {aiError}
            </div>
          </div>
        ) : null}
        {composerMode ? (
          <Composer
            mode={composerMode}
            recipientText={composerRecipients}
            subject={composerSubject}
            text={composerText}
            intent={draftIntent}
            drafting={isDrafting}
            sendState={sendState}
            undoAvailable={draftUndo !== null}
            onClose={() => {
              cancelDraft();
              setComposerMode(null);
            }}
            onRecipients={setComposerRecipients}
            onSubject={setComposerSubject}
            onText={setComposerText}
            onIntent={setDraftIntent}
            onGenerate={generateDraft}
            onCancel={cancelDraft}
            onUndo={() => {
              if (draftUndo !== null) setComposerText(draftUndo);
              setDraftUndo(null);
            }}
            onSend={sendDraft}
          />
        ) : null}
      </section>

      {modal === "connect" ? (
        <ConnectModal
          demoMode={demoMode}
          onConnect={startConnect}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal === "settings" ? (
        <SettingsModal
          provider={provider}
          model={model}
          keyInput={keyInput}
          configured={keyConfigured}
          notice={settingsNotice}
          onProvider={setProvider}
          onModel={setModel}
          onKey={setKeyInput}
          onSave={() => void providerKeyAction("save")}
          onTest={() => void providerKeyAction("test")}
          onRemove={() => void providerKeyAction("remove")}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal === "palette" ? (
        <Palette
          onAction={(action) => {
            setModal(null);
            if (action === "archive")
              applyOptimistic(
                "Archive",
                (thread) => ({ ...thread, archived: true }),
                { path: "archive" },
              );
            if (action === "summary") makeSummary();
            if (action === "reply") openComposer("reply");
            if (action === "search") searchInput.current?.focus();
            if (action === "priority") setView("priority");
            if (action === "failure")
              setForceMutationFailure((current) => !current);
            if (action === "provider")
              setForceProviderDown((current) => !current);
          }}
          mutationFailure={forceMutationFailure}
          providerDown={forceProviderDown}
          onClose={() => setModal(null)}
        />
      ) : null}
      {modal === "help" ? <HelpModal onClose={() => setModal(null)} /> : null}
    </main>
  );
}

function ThreadRow({
  thread,
  selected,
  onSelect,
}: {
  thread: InboxThread;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      className={`thread-row ${selected ? "selected" : ""} ${thread.unread ? "unread" : ""}`}
      data-testid={`thread-${thread.id}`}
      onClick={onSelect}
    >
      <span className="thread-meta">
        <span>
          <i className={`bucket-dot bucket-${thread.bucket}`} />
          {thread.sender}
        </span>
        <time>{thread.date}</time>
      </span>
      <span className="thread-subject">{thread.subject}</span>
      <span className="thread-preview">{thread.preview}</span>
    </button>
  );
}

function ThreadDetail({
  thread,
  demoMode,
  onSummary,
  onRefineTriage,
  onSetBucket,
  onOpenMessage,
}: {
  thread: InboxThread;
  demoMode: boolean;
  onSummary: () => void;
  onRefineTriage: () => void;
  onSetBucket: (bucket: FocusBucket) => void;
  onOpenMessage: (id: string) => void;
}) {
  const summary =
    thread.summary &&
    thread.summary.cachedForMessageId === thread.latestMessageId
      ? thread.summary
      : undefined;
  return (
    <>
      <h1 className="subject">{thread.subject}</h1>
      <p className="participants">{thread.participants.join(" • ")}</p>
      <div className="summary-card">
        <div className="summary-top">
          <h2>Focus classification</h2>
          <select
            aria-label="Manual Focus classification"
            className="field"
            style={{ width: 160, padding: 5 }}
            value={thread.bucket}
            onChange={(event) => onSetBucket(event.target.value as FocusBucket)}
          >
            {(
              ["priority", "needs_reply", "waiting", "other"] as FocusBucket[]
            ).map((bucket) => (
              <option key={bucket} value={bucket}>
                {viewLabels[bucket]}
              </option>
            ))}
          </select>
        </div>
        <p>
          {thread.reasons.length
            ? thread.reasons.join(" • ")
            : "Manual classification"}
        </p>
        <div className="chips">
          {thread.reasons.map((reason) => (
            <span className="chip" key={reason}>
              Why: {reason}
            </span>
          ))}
          {thread.followUp ? (
            <span className="chip">Follow-up marked</span>
          ) : null}
          {!demoMode ? (
            <button className="chip" onClick={onRefineTriage}>
              Refine with AI
            </button>
          ) : null}
        </div>
      </div>
      {summary ? (
        <div className="summary-card" data-testid="thread-summary">
          <div className="summary-top">
            <h2>Evidence-backed summary</h2>
            <span className="progress">cached by latest message</span>
          </div>
          <p>{summary.summary}</p>
          {summary.latestDelta ? (
            <div className="summary-key">
              <span>Latest change</span>
              <b>{summary.latestDelta}</b>
            </div>
          ) : null}
          {summary.actionRequired ? (
            <div className="summary-key">
              <span>Action</span>
              <b>{summary.actionRequired}</b>
            </div>
          ) : null}
          {summary.deadline ? (
            <div className="summary-key">
              <span>Deadline</span>
              <b>{summary.deadline}</b>
            </div>
          ) : null}
          <div className="chips">
            {summary.sourceMessageIds.map((id) => (
              <button
                key={id}
                className="chip"
                onClick={() => onOpenMessage(id)}
              >
                Source: {id}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <button
          className="secondary-button"
          data-testid="summarize-thread"
          onClick={onSummary}
        >
          <Sparkles size={14} /> Summarize with sources
        </button>
      )}
      <div style={{ marginTop: 18 }}>
        {thread.messages.map((message) => (
          <SafeMessage key={message.id} message={message} />
        ))}
      </div>
    </>
  );
}

function Composer({
  mode,
  recipientText,
  subject,
  text,
  intent,
  drafting,
  sendState,
  undoAvailable,
  onClose,
  onRecipients,
  onSubject,
  onText,
  onIntent,
  onGenerate,
  onCancel,
  onUndo,
  onSend,
}: {
  mode: ComposerMode;
  recipientText: string;
  subject: string;
  text: string;
  intent: string;
  drafting: boolean;
  sendState: "idle" | "sent" | "failed";
  undoAvailable: boolean;
  onClose: () => void;
  onRecipients: (value: string) => void;
  onSubject: (value: string) => void;
  onText: (value: string) => void;
  onIntent: (value: string) => void;
  onGenerate: () => void;
  onCancel: () => void;
  onUndo: () => void;
  onSend: () => void;
}) {
  return (
    <section
      className="composer"
      aria-label="Email composer"
      data-testid="composer"
    >
      <div className="composer-grid">
        <div className="composer-row">
          <span className="composer-label">To</span>
          <input
            className="field"
            aria-label="Recipients"
            value={recipientText}
            onChange={(event) => onRecipients(event.target.value)}
          />
        </div>
        <div className="composer-row">
          <span className="composer-label">Subject</span>
          <input
            className="field"
            aria-label="Subject"
            value={subject}
            onChange={(event) => onSubject(event.target.value)}
          />
        </div>
        <textarea
          className="field"
          aria-label="Email body"
          placeholder="Write a reply, or describe your intent below."
          value={text}
          onChange={(event) => onText(event.target.value)}
        />
        <input
          className="field"
          aria-label="Draft intent"
          placeholder="AI intent: Tell her Thursday works…"
          value={intent}
          onChange={(event) => onIntent(event.target.value)}
        />
      </div>
      {sendState === "sent" ? (
        <div className="banner success-banner" role="status">
          Sent after your explicit confirmation.
        </div>
      ) : null}
      {sendState === "failed" ? (
        <div className="ai-error" role="alert">
          Send failed. This draft remains open and recoverable.
        </div>
      ) : null}
      <div className="composer-actions">
        <div className="button-row">
          <button className="secondary-button" onClick={onClose}>
            <X size={14} /> Close
          </button>
          {drafting ? (
            <button className="secondary-button" onClick={onCancel}>
              Cancel draft
            </button>
          ) : (
            <button className="secondary-button" onClick={onGenerate}>
              <Sparkles size={14} /> Draft with AI
            </button>
          )}
          {undoAvailable ? (
            <button className="secondary-button" onClick={onUndo}>
              Undo overwrite
            </button>
          ) : null}
        </div>
        <button
          className="primary-button"
          data-testid="explicit-send"
          onClick={onSend}
        >
          <Send size={15} /> Explicit Send
        </button>
      </div>
    </section>
  );
}

function ConnectModal({
  demoMode,
  onConnect,
  onClose,
}: {
  demoMode: boolean;
  onConnect: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connect-title"
      >
        <h2 id="connect-title">Connect one Gmail account</h2>
        <p>
          Subzero uses the official Gmail API and requests only the practical
          read/modify scope. Tokens are encrypted; no token is logged.
        </p>
        <div className="banner">
          Public Gmail OAuth verification is not required for
          self-hosted/configured test users. Your Google OAuth client must list
          this callback URL.
        </div>
        <code className="field">/api/auth/google/callback</code>
        <div className="modal-footer">
          <button className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button className="primary-button" onClick={onConnect}>
            {demoMode ? "Connect demo Gmail" : "Continue with Google"}
          </button>
        </div>
      </section>
    </div>
  );
}

function SettingsModal({
  provider,
  model,
  keyInput,
  configured,
  notice,
  onProvider,
  onModel,
  onKey,
  onSave,
  onTest,
  onRemove,
  onClose,
}: {
  provider: string;
  model: string;
  keyInput: string;
  configured: boolean;
  notice: string | null;
  onProvider: (value: string) => void;
  onModel: (value: string) => void;
  onKey: (value: string) => void;
  onSave: () => void;
  onTest: () => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <h2 id="settings-title">BYOK settings</h2>
        <p>
          You pay your provider directly. Subzero never displays a saved key
          again.
        </p>
        <div className="modal-grid">
          <label>
            Provider
            <select
              className="field"
              value={provider}
              onChange={(event) => onProvider(event.target.value)}
            >
              <option value="openai-compatible">OpenAI-compatible</option>
              <option value="anthropic">Anthropic</option>
              <option value="gemini">Google Gemini</option>
            </select>
          </label>
          <label>
            Model
            <input
              className="field"
              value={model}
              onChange={(event) => onModel(event.target.value)}
            />
          </label>
          <label>
            API key
            <input
              className="field"
              aria-label="Provider API key"
              type="password"
              autoComplete="off"
              placeholder={
                configured ? "Configured — enter a replacement" : "Paste a key"
              }
              value={keyInput}
              onChange={(event) => onKey(event.target.value)}
            />
          </label>
          <div className="progress">
            Status: <b>{configured ? "configured" : "not configured"}</b>
          </div>
          {notice ? (
            <div className="banner" role="status">
              {notice}
            </div>
          ) : null}
        </div>
        <div className="modal-footer">
          <a className="secondary-button" href="/settings/voice">
            Voice Profile
          </a>
          <a className="secondary-button" href="/settings/focus">
            Custom Focus rules
          </a>
          <button className="danger-button" onClick={onRemove}>
            Remove key
          </button>
          <button className="secondary-button" onClick={onTest}>
            Test connection
          </button>
          <button className="primary-button" onClick={onSave}>
            Save encrypted key
          </button>
          <button className="secondary-button" onClick={onClose}>
            Done
          </button>
        </div>
      </section>
    </div>
  );
}

function Palette({
  mutationFailure,
  providerDown,
  onAction,
  onClose,
}: {
  mutationFailure: boolean;
  providerDown: boolean;
  onAction: (action: string) => void;
  onClose: () => void;
}) {
  const actions = [
    ["priority", "Go to Priority", Star],
    ["archive", "Archive thread", Archive],
    ["summary", "Summarize thread", FileText],
    ["reply", "Draft reply", PencilLine],
    ["search", "Search Gmail", Search],
    [
      "failure",
      `${mutationFailure ? "Disable" : "Simulate"} Gmail mutation failure`,
      RefreshCw,
    ],
    [
      "provider",
      `${providerDown ? "Restore" : "Simulate"} AI provider outage`,
      Sparkles,
    ],
  ] as const;
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="palette-title"
        data-testid="command-palette"
      >
        <div className="summary-top">
          <h2 id="palette-title">Command palette</h2>
          <button
            className="icon-button"
            aria-label="Close command palette"
            onClick={onClose}
          >
            <X size={16} />
          </button>
        </div>
        <p>
          Keyboard-accessible actions. Ask Inbox appears after the P0 release
          gate.
        </p>
        <div className="modal-grid">
          {actions.map(([id, label, Icon]) => (
            <button
              className="nav-button"
              key={id}
              onClick={() => onAction(id)}
            >
              <span>
                <Icon size={15} /> {label}
              </span>
              <span className="shortcut">↵</span>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  const shortcuts = [
    ["J / K", "Next / previous thread"],
    ["Enter", "Open thread"],
    ["E", "Archive"],
    ["U", "Read / unread"],
    ["R", "Reply"],
    ["C", "Compose"],
    ["F", "Toggle follow-up"],
    ["/", "Search Gmail"],
    ["⌘ / Ctrl K", "Command palette"],
    ["Esc", "Close composer or modal"],
  ];
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-title"
      >
        <h2 id="help-title">Keyboard-first loop</h2>
        <p>Shortcuts do not run while typing in an editor, input, or select.</p>
        <div className="help-grid">
          {shortcuts.map(([key, label]) => (
            <div key={key}>
              <kbd>{key}</kbd> — {label}
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="primary-button" onClick={onClose}>
            Done
          </button>
        </div>
      </section>
    </div>
  );
}
