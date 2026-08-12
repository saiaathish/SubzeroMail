import {
  Archive,
  ArrowDown,
  ArrowUp,
  Bot,
  Check,
  CheckCircle2,
  ChevronRight,
  Command,
  Compass,
  CircleHelp,
  Clock3,
  Inbox,
  Keyboard,
  ListChecks,
  LogOut,
  Moon,
  Pencil,
  RefreshCw,
  Reply,
  ReplyAll,
  Search,
  Settings2,
  Send,
  ShieldCheck,
  Sparkles,
  Star,
  Sun,
  WandSparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { InboxAnswer, ThreadSummary } from "@subzero/ai";
import type { OpenLoop } from "@subzero/core";
import { sanitizeEmailHtml } from "@subzero/security/client";
import { SubzeroMark } from "@subzero/ui";

import type { FocusBucket, FixtureThread } from "../fixtures";
import { sendExtensionMessage } from "../runtime";
import { providerDefaults, requestAIOriginPermission } from "../ai";
import {
  DEFAULT_EXTENSION_STATE,
  type AIProviderId,
  type ExtensionAISettings,
  type ExtensionState,
  type Theme,
} from "../types";

type View = "all" | FocusBucket | "loops" | "ask";
type ComposeMode = "new" | "reply" | "reply-all";
type ConnectionStatus = "idle" | "connecting" | "cancelled" | "error";

const VIEW_LABELS: Record<View, string> = {
  all: "All mail",
  priority: "Priority",
  needs_reply: "Needs Reply",
  waiting: "Waiting",
  other: "Other",
  loops: "Open Loops",
  ask: "Ask Inbox",
};

const BUCKET_LABELS: Record<FocusBucket, string> = {
  priority: "Priority",
  needs_reply: "Needs Reply",
  waiting: "Waiting",
  other: "Other",
};

function isTypingTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  return Boolean(
    element &&
    (element.tagName === "INPUT" ||
      element.tagName === "TEXTAREA" ||
      element.isContentEditable),
  );
}

function formatSyncTime(value: string | null): string {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

interface ConnectionGateProps {
  theme: Theme;
  status: ConnectionStatus;
  message: string | null;
  notice: string | null;
  onConnect: () => void;
  onToggleTheme: () => void;
}

function ConnectionGate({
  theme,
  status,
  message,
  notice,
  onConnect,
  onToggleTheme,
}: ConnectionGateProps) {
  const isConnecting = status === "connecting";
  const feedbackTone = status === "cancelled" ? "cancelled" : "error";

  return (
    <main className="connection-gate">
      <header className="connection-gate-header">
        <SubzeroMark showName name="SUBZERO" label="Subzero Mail extension" />
        <button
          className="icon-button"
          aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
          onClick={onToggleTheme}
        >
          {theme === "dark" ? <Sun size={17} /> : <Moon size={17} />}
        </button>
      </header>

      <section className="connection-gate-card" aria-labelledby="gate-title">
        <div className="connection-gate-mark" aria-hidden="true">
          <Inbox size={24} />
          <span />
        </div>
        <span className="eyebrow">GMAIL / LIVE CONNECTION</span>
        <h1 id="gate-title">Your inbox starts with a connection.</h1>
        <p className="connection-gate-intro">
          Bring your live Gmail inbox into Subzero for focused triage, search,
          and follow-up. Google access is required before any mail appears.
        </p>

        <div className="connection-gate-points">
          <div>
            <ShieldCheck size={17} />
            <span>
              <strong>Gmail stays canonical</strong>
              <small>
                Subzero reads and updates your Gmail account through the
                official API.
              </small>
            </span>
          </div>
          <div>
            <Inbox size={17} />
            <span>
              <strong>Only your account, when you choose</strong>
              <small>
                Nothing is loaded until you approve the Google connection.
              </small>
            </span>
          </div>
        </div>

        <div className="connection-gate-actions">
          <p>
            <ShieldCheck size={14} />
            Google authorization opens in a secure Chrome window.
          </p>
          <button
            className="send-button connection-gate-button"
            onClick={onConnect}
            disabled={isConnecting}
            aria-busy={isConnecting}
          >
            {isConnecting ? (
              <>
                <RefreshCw size={15} className="spin" /> Connecting…
              </>
            ) : (
              <>
                <ChevronRight size={15} /> Continue with Google
              </>
            )}
          </button>
        </div>

        {notice ? (
          <p className="connection-gate-feedback success" role="status">
            {notice}
          </p>
        ) : message ? (
          <p
            className={`connection-gate-feedback ${feedbackTone}`}
            role="status"
          >
            {message}
          </p>
        ) : null}
      </section>

      <p className="connection-gate-footer">
        Subzero uses Gmail API access only. Your local cache remains on this
        device.
      </p>
    </main>
  );
}

export function App() {
  const [appState, setAppState] = useState<ExtensionState>(
    DEFAULT_EXTENSION_STATE,
  );
  const [threads, setThreads] = useState<FixtureThread[]>([]);
  const [view, setView] = useState<View>("all");
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [composeMode, setComposeMode] = useState<ComposeMode | null>(null);
  const [composeTo, setComposeTo] = useState("");
  const [composeCc, setComposeCc] = useState("");
  const [composeSubject, setComposeSubject] = useState("");
  const [composeText, setComposeText] = useState("");
  const [draftIntent, setDraftIntent] = useState("");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [connectionStatus, setConnectionStatus] =
    useState<ConnectionStatus>("idle");
  const [connectionMessage, setConnectionMessage] = useState<string | null>(
    null,
  );
  const [isDrafting, setIsDrafting] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [searchingRemote, setSearchingRemote] = useState(false);
  const [summary, setSummary] = useState<
    (ThreadSummary & { provider?: string }) | null
  >(null);
  const [isSummarizing, setIsSummarizing] = useState(false);
  const [isWritingWithAI, setIsWritingWithAI] = useState(false);
  const [aiSettings, setAISettings] = useState<ExtensionAISettings>(
    DEFAULT_EXTENSION_STATE.ai,
  );
  const [aiSettingsOpen, setAISettingsOpen] = useState(false);
  const [aiProvider, setAIProvider] = useState<AIProviderId>(
    DEFAULT_EXTENSION_STATE.ai.provider,
  );
  const [aiModel, setAIModel] = useState(DEFAULT_EXTENSION_STATE.ai.model);
  const [aiBaseUrl, setAIBaseUrl] = useState(
    DEFAULT_EXTENSION_STATE.ai.baseUrl,
  );
  const [aiKey, setAIKey] = useState("");
  const [isTestingAI, setIsTestingAI] = useState(false);
  const [askQuestion, setAskQuestion] = useState("");
  const [askResult, setAskResult] = useState<
    | (InboxAnswer & {
        evidence: Array<{ messageId: string; threadId: string; text: string }>;
        provider?: string;
      })
    | null
  >(null);
  const [isAsking, setIsAsking] = useState(false);
  const [loops, setLoops] = useState<OpenLoop[]>([]);
  const [reminders, setReminders] = useState<
    Array<{
      loopId: string;
      threadId: string;
      text: string;
      dueAt: string;
      kind: "overdue" | "due_soon";
    }>
  >([]);
  const [isDetectingLoops, setIsDetectingLoops] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const paletteRef = useRef<HTMLInputElement>(null);
  const composeRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadApp() {
      try {
        const stateResponse = await sendExtensionMessage<ExtensionState>({
          type: "app/get-state",
        });
        if (cancelled) return;

        if (!stateResponse.ok || !stateResponse.data) {
          setConnectionStatus("error");
          setConnectionMessage(
            "Subzero could not check your Gmail connection. Try again to continue.",
          );
          return;
        }

        const nextState = stateResponse.data;
        setAppState(nextState);

        if (nextState.account.mode !== "connected") return;

        const threadResponse = await sendExtensionMessage<FixtureThread[]>({
          type: "mail/get-threads",
        });
        if (cancelled) return;

        if (threadResponse.ok && threadResponse.data) {
          setThreads(threadResponse.data);
          setSelectedId(threadResponse.data[0]?.id ?? "");
        }
      } catch {
        if (!cancelled) {
          setConnectionStatus("error");
          setConnectionMessage(
            "Subzero could not check your Gmail connection. Try again to continue.",
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    }

    void loadApp();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (appState.account.mode !== "connected") return;

    void sendExtensionMessage<ExtensionAISettings>({ type: "ai/get-settings" })
      .then((response) => {
        if (!response.ok || !response.data) return;
        setAISettings(response.data);
        setAIProvider(response.data.provider);
        setAIModel(response.data.model);
        setAIBaseUrl(response.data.baseUrl);
      })
      .catch(() => undefined);
    void sendExtensionMessage<{
      loops: OpenLoop[];
      reminders: typeof reminders;
    }>({ type: "loops/list" })
      .then((response) => {
        if (!response.ok || !response.data) return;
        setLoops(response.data.loops);
        setReminders(response.data.reminders);
      })
      .catch(() => undefined);
  }, [appState.account.mode]);

  useEffect(() => {
    document.documentElement.dataset.theme = appState.theme;
    document.documentElement.style.colorScheme = appState.theme;
  }, [appState.theme]);

  useEffect(() => {
    if (paletteOpen) paletteRef.current?.focus();
  }, [paletteOpen]);

  useEffect(() => {
    setSummary(null);
  }, [selectedId]);

  useEffect(() => {
    if (composeMode) composeRef.current?.focus();
  }, [composeMode]);

  useEffect(() => {
    const trimmed = query.trim();
    if (appState.account.mode !== "connected" || trimmed.length < 2) return;

    const timer = window.setTimeout(() => {
      setSearchingRemote(true);
      void sendExtensionMessage<{ threads: FixtureThread[] }>({
        type: "mail/search",
        query: trimmed,
      })
        .then((response) => {
          if (!response.ok || !response.data) {
            showNotice(
              response.error?.message ?? "Gmail search is unavailable.",
            );
            return;
          }
          setThreads(response.data.threads);
          setSelectedId(response.data.threads[0]?.id ?? "");
        })
        .finally(() => setSearchingRemote(false));
    }, 260);

    return () => window.clearTimeout(timer);
  }, [appState.account.mode, query]);

  const visibleThreads = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return threads.filter((thread) => {
      if (thread.archived) return false;
      if (
        view !== "all" &&
        view !== "loops" &&
        view !== "ask" &&
        thread.bucket !== view
      )
        return false;
      if (!normalizedQuery) return true;
      if (normalizedQuery === "is:unread") return thread.unread;
      if (normalizedQuery.startsWith("from:")) {
        return thread.senderEmail.includes(normalizedQuery.slice(5));
      }
      return [thread.sender, thread.senderEmail, thread.subject, thread.preview]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [query, threads, view]);

  const selectedThread =
    threads.find((thread) => thread.id === selectedId) ?? visibleThreads[0];
  const counts = useMemo(
    () => ({
      total: threads.filter((thread) => !thread.archived).length,
      needsReply: threads.filter(
        (thread) => !thread.archived && thread.bucket === "needs_reply",
      ).length,
      waiting: threads.filter(
        (thread) => !thread.archived && thread.bucket === "waiting",
      ).length,
    }),
    [threads],
  );
  const openLoopCount = loops.filter((loop) => loop.status === "open").length;

  useEffect(() => {
    if (selectedThread && selectedThread.id !== selectedId) {
      setSelectedId(selectedThread.id);
    }
  }, [selectedId, selectedThread]);

  useEffect(() => {
    if (!selectedThread || selectedThread.source !== "gmail") return;
    if (selectedThread.htmlBody || selectedThread.messages?.length) return;

    let cancelled = false;
    void sendExtensionMessage<FixtureThread>({
      type: "mail/get-thread",
      threadId: selectedThread.id,
    }).then((response) => {
      if (cancelled || !response.ok || !response.data) return;
      setThreads((current) =>
        current.map((thread) =>
          thread.id === response.data?.id ? response.data : thread,
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [selectedThread]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      const typing = isTypingTarget(event.target);

      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        setPaletteOpen(true);
        return;
      }

      if (key === "escape") {
        setPaletteOpen(false);
        setComposeMode(null);
        return;
      }
      if (typing) return;

      if (key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (key === "j" || key === "k") {
        event.preventDefault();
        const currentIndex = Math.max(
          0,
          visibleThreads.findIndex((thread) => thread.id === selectedId),
        );
        const nextIndex = Math.min(
          Math.max(visibleThreads.length - 1, 0),
          currentIndex + (key === "j" ? 1 : -1),
        );
        const nextThread = visibleThreads[nextIndex];
        if (nextThread) setSelectedId(nextThread.id);
        return;
      }
      if (key === "enter") {
        event.preventDefault();
        document
          .getElementById(`thread-${selectedId}`)
          ?.scrollIntoView({ block: "nearest" });
        return;
      }
      if (key === "e") {
        event.preventDefault();
        archiveSelected();
        return;
      }
      if (key === "u") {
        event.preventDefault();
        toggleUnreadSelected();
        return;
      }
      if (key === "s") {
        event.preventDefault();
        toggleStarSelected();
        return;
      }
      if (key === "r") {
        event.preventDefault();
        openCompose("reply");
        return;
      }
      if (key === "c") {
        event.preventDefault();
        openCompose("new");
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  function showNotice(message: string) {
    setNotice(message);
    window.setTimeout(() => setNotice(null), 4200);
  }

  function archiveSelected() {
    if (!selectedThread) return;
    const targetId = selectedThread.id;
    setThreads((current) =>
      current.map((thread) =>
        thread.id === targetId ? { ...thread, archived: true } : thread,
      ),
    );
    if (selectedThread.source === "gmail") {
      void sendExtensionMessage({
        type: "mail/archive",
        threadId: targetId,
      }).then((response) => {
        if (!response.ok) {
          setThreads((current) =>
            current.map((thread) =>
              thread.id === targetId ? { ...thread, archived: false } : thread,
            ),
          );
          showNotice(
            response.error?.message ?? "Archive failed; thread restored.",
          );
        } else {
          showNotice("Archived in Gmail.");
        }
      });
    }
  }

  function toggleUnreadSelected() {
    if (!selectedThread) return;
    const targetId = selectedThread.id;
    const nextUnread = !selectedThread.unread;
    setThreads((current) =>
      current.map((thread) =>
        thread.id === targetId ? { ...thread, unread: nextUnread } : thread,
      ),
    );
    if (selectedThread.source === "gmail") {
      void sendExtensionMessage({
        type: "mail/toggle-read",
        threadId: targetId,
        unread: nextUnread,
      }).then((response) => {
        if (!response.ok) {
          setThreads((current) =>
            current.map((thread) =>
              thread.id === targetId
                ? { ...thread, unread: !nextUnread }
                : thread,
            ),
          );
          showNotice(
            response.error?.message ?? "Read state failed; thread restored.",
          );
        } else {
          showNotice(
            nextUnread ? "Marked unread in Gmail." : "Marked read in Gmail.",
          );
        }
      });
    }
  }

  function toggleStarSelected() {
    if (!selectedThread) return;
    const targetId = selectedThread.id;
    const nextStarred = !selectedThread.starred;
    setThreads((current) =>
      current.map((thread) =>
        thread.id === targetId ? { ...thread, starred: nextStarred } : thread,
      ),
    );

    if (selectedThread.source === "gmail") {
      void sendExtensionMessage({
        type: "mail/toggle-star",
        threadId: targetId,
        starred: nextStarred,
      }).then((response) => {
        if (!response.ok) {
          setThreads((current) =>
            current.map((thread) =>
              thread.id === targetId
                ? { ...thread, starred: !nextStarred }
                : thread,
            ),
          );
          showNotice(
            response.error?.message ?? "Star change failed; restored.",
          );
          return;
        }
        showNotice(
          nextStarred ? "Starred in Gmail." : "Star removed in Gmail.",
        );
      });
      return;
    }
  }

  function openCompose(mode: ComposeMode) {
    setComposeMode(mode);
    setComposeText("");
    setDraftIntent("");
    setDraftId(null);
    setComposeCc("");
    if (mode === "new" || !selectedThread) {
      setComposeTo("");
      setComposeSubject("");
    } else {
      const latest = selectedThread.messages?.at(-1);
      const replyAllRecipients = [
        selectedThread.senderEmail,
        ...(latest?.to ?? []),
        ...(latest?.cc ?? []),
      ]
        .filter(Boolean)
        .filter((value, index, values) => values.indexOf(value) === index);
      setComposeTo(
        mode === "reply-all"
          ? replyAllRecipients.join(", ")
          : selectedThread.senderEmail,
      );
      setComposeSubject(
        /^re:/i.test(selectedThread.subject)
          ? selectedThread.subject
          : `Re: ${selectedThread.subject}`,
      );
    }
    void sendExtensionMessage({
      type: "compose/quick",
      mode,
      ...(mode === "reply" && selectedThread
        ? { threadId: selectedThread.id }
        : {}),
    });
  }

  async function toggleTheme() {
    const nextTheme: Theme = appState.theme === "dark" ? "light" : "dark";
    const response = await sendExtensionMessage<ExtensionState>({
      type: "app/set-theme",
      theme: nextTheme,
    });
    if (response.ok && response.data) setAppState(response.data);
  }

  async function syncGmail() {
    setIsSyncing(true);
    const response = await sendExtensionMessage<{
      threads: FixtureThread[];
      email: string;
    }>({ type: "mail/sync" });
    if (response.ok && response.data) {
      const synced = response.data;
      setThreads(synced.threads);
      setSelectedId(synced.threads[0]?.id ?? "");
      setAppState((current) => ({
        ...current,
        account: {
          ...current.account,
          mode: "connected",
          email: synced.email || current.account.email,
          label: synced.email || current.account.label,
        },
        sync: {
          ...current.sync,
          status: "idle",
          lastSyncedAt: new Date().toISOString(),
          threadCount: synced.threads.length,
          detail: "Gmail inbox refreshed and cached locally.",
        },
      }));
      showNotice("Gmail inbox refreshed.");
    } else {
      showNotice(response.error?.message ?? "Gmail refresh is unavailable.");
    }
    setIsSyncing(false);
  }

  async function beginOAuth() {
    setConnectionStatus("connecting");
    setConnectionMessage(null);
    try {
      const response = await sendExtensionMessage<{
        status: string;
        message: string;
        threads?: FixtureThread[];
        email?: string;
      }>({ type: "oauth/start" });
      if (!response.ok || !response.data) {
        setConnectionStatus("error");
        setConnectionMessage(
          response.error?.message ??
            "Google connection could not start. Try again.",
        );
        return;
      }

      const result = response.data;
      if (
        result.status === "completed" &&
        typeof result.email === "string" &&
        Array.isArray(result.threads)
      ) {
        const email = result.email;
        const threads = result.threads;
        setThreads(threads);
        setSelectedId(threads[0]?.id ?? "");
        setAppState((current) => ({
          ...current,
          account: {
            ...current.account,
            mode: "connected",
            email,
            label: email,
            detail: "Live Gmail API connected with Chrome identity token.",
          },
          sync: {
            ...current.sync,
            status: "idle",
            lastSyncedAt: new Date().toISOString(),
            threadCount: threads.length,
            detail:
              "Gmail inbox refreshed. Full message bodies load on demand.",
          },
        }));
        setConnectionStatus("idle");
        setConnectionMessage(null);
        return;
      }

      const cancelled = result.status === "cancelled";
      setConnectionStatus(cancelled ? "cancelled" : "error");
      setConnectionMessage(
        result.message ||
          "Google authorization completed, but Gmail could not be loaded. Try again.",
      );
    } catch {
      setConnectionStatus("error");
      setConnectionMessage("Google connection could not start. Try again.");
    }
  }

  async function signOut() {
    const response = await sendExtensionMessage<ExtensionState>({
      type: "auth/sign-out",
    });
    if (!response.ok || !response.data) {
      showNotice(response.error?.message ?? "Sign out could not complete.");
      return;
    }

    setAppState(response.data);
    setThreads([]);
    setSelectedId("");
    setQuery("");
    setComposeMode(null);
    setDraftId(null);
    setAccountMenuOpen(false);
    showNotice("Signed out. Local Gmail cache cleared.");
  }

  async function saveDraft() {
    if (!composeMode) return null;
    const to = composeTo
      .split(/[;,\n]/)
      .map((value) => value.trim())
      .filter(Boolean);
    const cc = composeCc
      .split(/[;,\n]/)
      .map((value) => value.trim())
      .filter(Boolean);
    if (!to.length) {
      showNotice("Add at least one recipient before saving the draft.");
      return null;
    }
    if (!composeSubject.trim()) {
      showNotice("Add a subject before saving the draft.");
      return null;
    }

    setIsDrafting(true);
    const response = await sendExtensionMessage<{
      draftId: string;
      threadId?: string;
    }>({
      type: "mail/create-draft",
      ...(selectedThread && composeMode !== "new"
        ? { threadId: selectedThread.id }
        : {}),
      to,
      ...(cc.length ? { cc } : {}),
      subject: composeSubject.trim(),
      body: composeText,
      ...(selectedThread?.latestMessageId && composeMode !== "new"
        ? { replyToMessageId: selectedThread.latestMessageId }
        : {}),
    });
    setIsDrafting(false);

    if (!response.ok || !response.data) {
      showNotice(response.error?.message ?? "Draft could not be saved.");
      return null;
    }

    setDraftId(response.data.draftId);
    showNotice("Draft saved locally. You can keep editing or send it.");
    return response.data.draftId;
  }

  async function sendDraft() {
    const id = draftId ?? (await saveDraft());
    if (!id) return;

    setIsSending(true);
    const response = await sendExtensionMessage({
      type: "mail/send-draft",
      draftId: id,
    });
    setIsSending(false);
    if (!response.ok) {
      showNotice(response.error?.message ?? "Send failed. Draft kept open.");
      return;
    }

    setComposeMode(null);
    setDraftId(null);
    showNotice("Message sent.");
  }

  async function summarizeSelected() {
    if (!selectedThread) return;
    setIsSummarizing(true);
    const response = await sendExtensionMessage<
      ThreadSummary & { provider?: string }
    >({ type: "ai/summarize", threadId: selectedThread.id });
    setIsSummarizing(false);
    if (!response.ok || !response.data) {
      showNotice(response.error?.message ?? "Summary unavailable.");
      return;
    }
    setSummary(response.data);
  }

  async function writeWithAI(intent = draftIntent) {
    if (!selectedThread || !intent.trim()) {
      showNotice("Describe the reply you want Subzero to write.");
      return;
    }
    setIsWritingWithAI(true);
    const response = await sendExtensionMessage<{
      draft: string;
      provider?: string;
    }>({
      type: "ai/draft",
      threadId: selectedThread.id,
      intent: intent.trim(),
    });
    setIsWritingWithAI(false);
    if (!response.ok || !response.data) {
      showNotice(response.error?.message ?? "AI draft unavailable.");
      return;
    }
    setComposeText(response.data.draft);
    setDraftIntent(intent);
    showNotice(
      response.data.provider === "local"
        ? "Draft written locally from the thread context."
        : `Draft written with ${response.data.provider}. Review before sending.`,
    );
  }

  function openInstantReply(intent: string) {
    if (!composeMode) openCompose("reply");
    setDraftIntent(intent);
    void writeWithAI(intent);
  }

  async function askInbox() {
    const question = askQuestion.trim();
    if (!question) {
      showNotice("Ask a specific question about the messages in this inbox.");
      return;
    }
    setIsAsking(true);
    const response = await sendExtensionMessage<
      InboxAnswer & {
        evidence: Array<{
          messageId: string;
          threadId: string;
          text: string;
        }>;
        provider?: string;
      }
    >({ type: "ai/ask-inbox", question });
    setIsAsking(false);
    if (!response.ok || !response.data) {
      showNotice(response.error?.message ?? "Ask Inbox is unavailable.");
      return;
    }
    setAskResult(response.data);
  }

  async function detectLoops() {
    setIsDetectingLoops(true);
    const response = await sendExtensionMessage<{
      loops: OpenLoop[];
      reminders: typeof reminders;
    }>({ type: "loops/detect" });
    setIsDetectingLoops(false);
    if (!response.ok || !response.data) {
      showNotice(response.error?.message ?? "Open Loops is unavailable.");
      return;
    }
    setLoops(response.data.loops);
    setReminders(response.data.reminders);
    showNotice(
      response.data.loops.filter((loop) => loop.status === "open").length
        ? "Open Loops refreshed from message evidence."
        : "No grounded open commitments found.",
    );
  }

  async function resolveLoop(loopId: string) {
    const response = await sendExtensionMessage<{
      loops: OpenLoop[];
      reminders: typeof reminders;
    }>({ type: "loops/resolve", loopId });
    if (!response.ok || !response.data) {
      showNotice(response.error?.message ?? "The loop could not be resolved.");
      return;
    }
    setLoops(response.data.loops);
    setReminders(response.data.reminders);
    showNotice("Loop marked resolved. Gmail was not changed.");
  }

  async function saveAISettings() {
    const baseUrl =
      aiProvider === "openai-compatible"
        ? aiBaseUrl.trim()
        : providerDefaults(aiProvider).baseUrl;
    if (!aiKey.trim()) {
      showNotice("Enter a provider key for this session.");
      return;
    }
    const approved = await requestAIOriginPermission(baseUrl);
    if (!approved) {
      showNotice("Provider origin permission was not approved.");
      return;
    }
    const response = await sendExtensionMessage<ExtensionAISettings>({
      type: "ai/configure",
      provider: aiProvider,
      model: aiModel.trim(),
      apiKey: aiKey,
      ...(aiProvider === "openai-compatible" ? { baseUrl } : {}),
    });
    if (!response.ok || !response.data) {
      showNotice(response.error?.message ?? "Provider configuration failed.");
      return;
    }
    setAISettings(response.data);
    setAIKey("");
    showNotice("Provider configured for this browser session only.");
  }

  async function testConfiguredAI() {
    setIsTestingAI(true);
    const response = await sendExtensionMessage<{ message: string }>({
      type: "ai/test",
    });
    setIsTestingAI(false);
    showNotice(
      response.ok
        ? (response.data?.message ?? "Provider responded.")
        : (response.error?.message ?? "Provider test failed."),
    );
  }

  async function clearConfiguredAI() {
    const response = await sendExtensionMessage<ExtensionAISettings>({
      type: "ai/clear",
    });
    if (response.ok && response.data) {
      setAISettings(response.data);
      setAIProvider(response.data.provider);
      setAIModel(response.data.model);
      setAIBaseUrl(response.data.baseUrl);
      setAIKey("");
      showNotice("Session provider key cleared.");
    }
  }

  function formatLoopDue(value: string | null): string {
    if (!value) return "No due date";
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
    }).format(new Date(value));
  }

  if (isLoading) {
    return <main className="loading-screen">Checking Gmail connection…</main>;
  }

  if (appState.account.mode !== "connected") {
    return (
      <ConnectionGate
        theme={appState.theme}
        status={connectionStatus}
        message={connectionMessage}
        notice={notice}
        onConnect={() => void beginOAuth()}
        onToggleTheme={() => void toggleTheme()}
      />
    );
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-lockup">
          <SubzeroMark showName name="SUBZERO" label="Subzero Mail extension" />
          <small>MAIL / EXTENSION</small>
        </div>

        <button className="compose-button" onClick={() => openCompose("new")}>
          <Pencil size={16} />
          <span>Quick compose</span>
          <kbd>C</kbd>
        </button>

        <nav className="nav-list" aria-label="Inbox views">
          {(Object.keys(VIEW_LABELS) as View[]).map((item) => {
            const count =
              item === "needs_reply"
                ? counts.needsReply
                : item === "waiting"
                  ? counts.waiting
                  : item === "loops"
                    ? openLoopCount
                    : item === "all"
                      ? counts.total
                      : undefined;
            return (
              <button
                className={`nav-item${view === item ? " active" : ""}`}
                key={item}
                onClick={() => setView(item)}
              >
                <span>
                  {item === "all" ? (
                    <Inbox size={16} />
                  ) : item === "loops" ? (
                    <ListChecks size={16} />
                  ) : item === "ask" ? (
                    <CircleHelp size={16} />
                  ) : (
                    <span className={`nav-dot ${item}`} />
                  )}
                  {VIEW_LABELS[item]}
                </span>
                {count !== undefined ? <strong>{count}</strong> : null}
              </button>
            );
          })}
        </nav>

        <div className="sidebar-spacer" />

        <div className="shortcut-card">
          <div className="shortcut-card-title">
            <Keyboard size={15} /> Keyboard shell
          </div>
          <p>Move, triage, reply, and search without leaving the inbox.</p>
          <button onClick={() => setPaletteOpen(true)}>
            <Command size={13} />
            <span>View shortcuts</span>
            <kbd>⌘K</kbd>
          </button>
        </div>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">GMAIL INBOX</span>
            <h1>{VIEW_LABELS[view]}</h1>
          </div>
          <div className="topbar-actions">
            <div className="search-wrap">
              <Search size={15} />
              <input
                ref={searchRef}
                aria-label="Search Gmail"
                placeholder="Search mail"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              {searchingRemote ? (
                <RefreshCw size={13} className="spin" />
              ) : null}
              {query ? (
                <button
                  className="search-clear"
                  aria-label="Clear search"
                  onClick={() => setQuery("")}
                >
                  <X size={13} />
                </button>
              ) : null}
              <kbd>/</kbd>
            </div>
            <button
              className="icon-button"
              aria-label={`Switch to ${appState.theme === "dark" ? "light" : "dark"} theme`}
              onClick={() => void toggleTheme()}
            >
              {appState.theme === "dark" ? (
                <Sun size={17} />
              ) : (
                <Moon size={17} />
              )}
            </button>
            <button
              className={`icon-button${aiSettings.sessionConfigured ? " configured" : ""}`}
              aria-label="Open AI settings"
              title={
                aiSettings.sessionConfigured
                  ? "AI provider configured for this session"
                  : "Configure a BYOK provider"
              }
              onClick={() => setAISettingsOpen(true)}
            >
              <Settings2 size={17} />
            </button>
            <div className="account-actions">
              <button
                className="account-chip"
                onClick={() => setAccountMenuOpen((open) => !open)}
                aria-expanded={accountMenuOpen}
              >
                <span className="account-avatar">
                  {appState.account.mode === "connected" ? "G" : "SZ"}
                </span>
                <span>
                  <strong>{appState.account.label}</strong>
                  <small>{appState.account.email ?? "No account"}</small>
                </span>
                <ChevronRight size={14} />
              </button>
              {accountMenuOpen && appState.account.mode === "connected" ? (
                <div className="account-menu" role="menu">
                  <span>Account session</span>
                  <button role="menuitem" onClick={() => void signOut()}>
                    <LogOut size={14} /> Sign out and clear cache
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <div className="status-strip">
          <span className="status-live">
            <span /> Connected
          </span>
          <span>{appState.sync.detail}</span>
          <span className="status-time">
            Last refresh {formatSyncTime(appState.sync.lastSyncedAt)}
          </span>
          <button
            className="text-button"
            onClick={() => void syncGmail()}
            disabled={isSyncing}
          >
            <RefreshCw size={14} className={isSyncing ? "spin" : ""} />
            {isSyncing ? "Refreshing" : "Refresh Gmail"}
          </button>
        </div>

        {view === "loops" ? (
          <section
            className="utility-panel loops-panel"
            aria-label="Open Loops"
          >
            <div className="utility-panel-head">
              <div>
                <span className="eyebrow">FOLLOW-UPS</span>
                <h2>Open Loops</h2>
                <p>Keep commitments visible without changing Gmail.</p>
              </div>
              <button
                className="secondary-button"
                onClick={() => void detectLoops()}
                disabled={isDetectingLoops}
              >
                <RefreshCw
                  size={14}
                  className={isDetectingLoops ? "spin" : ""}
                />
                {isDetectingLoops ? "Detecting…" : "Detect from inbox"}
              </button>
            </div>
            {reminders.length ? (
              <div className="reminder-banner">
                <Clock3 size={16} />
                <div>
                  <strong>
                    {reminders.length} reminder
                    {reminders.length === 1 ? "" : "s"} need attention
                  </strong>
                  <span>
                    Due dates are derived from message evidence and remain
                    local.
                  </span>
                </div>
              </div>
            ) : null}
            <div className="loop-list">
              {loops
                .filter((loop) => loop.status === "open")
                .map((loop) => (
                  <article className="loop-card" key={loop.id}>
                    <div className="loop-card-main">
                      <span className={`loop-direction ${loop.direction}`}>
                        {loop.direction === "i_owe"
                          ? "I owe"
                          : loop.direction === "they_owe"
                            ? "They owe"
                            : "Waiting"}
                      </span>
                      <h3>{loop.text}</h3>
                      <p>
                        {loop.dueAt
                          ? `Due ${formatLoopDue(loop.dueAt)}`
                          : "No due date extracted"}
                        {loop.suggestion
                          ? " · Review suggestion"
                          : " · Evidence-backed"}
                      </p>
                    </div>
                    <div className="loop-card-actions">
                      <button
                        className="text-button"
                        onClick={() => {
                          setSelectedId(loop.threadId);
                          setView("all");
                        }}
                      >
                        Open thread
                      </button>
                      <button
                        className="icon-button"
                        aria-label={`Resolve ${loop.text}`}
                        onClick={() => void resolveLoop(loop.id)}
                      >
                        <CheckCircle2 size={16} />
                      </button>
                    </div>
                  </article>
                ))}
              {!loops.some((loop) => loop.status === "open") ? (
                <div className="empty-state">
                  <ListChecks size={24} />
                  <p>
                    Detect loops to surface requests, promises, and waiting
                    work.
                  </p>
                </div>
              ) : null}
            </div>
          </section>
        ) : view === "ask" ? (
          <section className="utility-panel ask-panel" aria-label="Ask Inbox">
            <div className="utility-panel-head">
              <div>
                <span className="eyebrow">GROUNDED SEARCH</span>
                <h2>Ask Inbox</h2>
                <p>
                  Ask a question; Subzero retrieves a bounded evidence set
                  first.
                </p>
              </div>
              <Bot size={26} className="utility-mark" />
            </div>
            <form
              className="ask-form"
              onSubmit={(event) => {
                event.preventDefault();
                void askInbox();
              }}
            >
              <input
                aria-label="Ask Inbox question"
                value={askQuestion}
                onChange={(event) => setAskQuestion(event.target.value)}
                placeholder="What did Alex agree to?"
              />
              <button className="send-button" type="submit" disabled={isAsking}>
                <WandSparkles size={14} /> {isAsking ? "Searching…" : "Ask"}
              </button>
            </form>
            {askResult ? (
              <article className="ask-result" aria-live="polite">
                <div className="ask-result-head">
                  <span>
                    <Sparkles size={15} /> Answer
                  </span>
                  <small>
                    {askResult.provider === "local"
                      ? "Local evidence"
                      : askResult.provider}
                  </small>
                </div>
                <p>{askResult.answer}</p>
                <div className="evidence-list">
                  <span className="eyebrow">SOURCE MESSAGES</span>
                  {askResult.evidence.map((evidence) => (
                    <button
                      key={evidence.messageId}
                      className="evidence-chip"
                      onClick={() => {
                        setSelectedId(evidence.threadId);
                        setView("all");
                      }}
                    >
                      <ChevronRight size={13} /> {evidence.text.slice(0, 100)}
                    </button>
                  ))}
                </div>
              </article>
            ) : (
              <div className="ask-empty">
                <CircleHelp size={22} />
                <p>
                  Answers stay tied to source messages. No source, no claim.
                </p>
              </div>
            )}
          </section>
        ) : (
          <div className="inbox-grid">
            <section className="thread-list" aria-label="Gmail threads">
              <div className="list-heading">
                <span>{visibleThreads.length} threads</span>
                <span className="list-hint">
                  <ArrowDown size={13} /> Newest first
                </span>
              </div>
              {visibleThreads.map((thread) => (
                <button
                  className={`thread-row${selectedThread?.id === thread.id ? " selected" : ""}${thread.unread ? " unread" : ""}`}
                  id={`thread-${thread.id}`}
                  key={thread.id}
                  onClick={() => setSelectedId(thread.id)}
                >
                  <span className={`thread-indicator ${thread.bucket}`} />
                  <span className="thread-copy">
                    <span className="thread-meta">
                      <strong>{thread.sender}</strong>
                      <time>{thread.timestamp}</time>
                    </span>
                    <span className="thread-subject">{thread.subject}</span>
                    <span className="thread-preview">{thread.preview}</span>
                  </span>
                  {thread.starred ? (
                    <Star
                      className="thread-starred"
                      size={14}
                      fill="currentColor"
                      aria-label="Starred"
                    />
                  ) : null}
                  {thread.unread ? (
                    <span className="unread-dot" aria-label="Unread" />
                  ) : null}
                </button>
              ))}
              {visibleThreads.length === 0 ? (
                <div className="empty-state">
                  <Compass size={22} />
                  <p>No threads match this view.</p>
                </div>
              ) : null}
            </section>

            <section className="thread-detail" aria-label="Selected thread">
              {selectedThread ? (
                <>
                  <div className="detail-header">
                    <div>
                      <span className={`bucket-label ${selectedThread.bucket}`}>
                        {BUCKET_LABELS[selectedThread.bucket]}
                      </span>
                      <h2>{selectedThread.subject}</h2>
                      <p>
                        {selectedThread.sender} · {selectedThread.senderEmail}
                      </p>
                    </div>
                    <div className="detail-actions">
                      <button
                        className="icon-button"
                        aria-label="Archive selected thread"
                        onClick={archiveSelected}
                      >
                        <Archive size={16} />
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Toggle unread"
                        onClick={toggleUnreadSelected}
                      >
                        {selectedThread.unread ? (
                          <Check size={16} />
                        ) : (
                          <ArrowUp size={16} />
                        )}
                      </button>
                      <button
                        className={`icon-button${selectedThread.starred ? " starred" : ""}`}
                        aria-label={
                          selectedThread.starred
                            ? "Remove star from selected thread"
                            : "Star selected thread"
                        }
                        onClick={toggleStarSelected}
                      >
                        <Star
                          size={16}
                          fill={
                            selectedThread.starred ? "currentColor" : "none"
                          }
                        />
                      </button>
                      <button
                        className="reply-button"
                        onClick={() => openCompose("reply")}
                      >
                        <Reply size={15} /> Reply <kbd>R</kbd>
                      </button>
                      <button
                        className="icon-button"
                        aria-label="Reply all"
                        title="Reply all"
                        onClick={() => openCompose("reply-all")}
                      >
                        <ReplyAll size={16} />
                      </button>
                    </div>
                  </div>
                  <div className="thread-context">
                    <Sparkles size={15} />
                    <span>
                      <strong>Why this is here:</strong> {selectedThread.reason}
                    </span>
                  </div>
                  <section className="summary-card" aria-label="Thread summary">
                    <div className="summary-card-head">
                      <span>
                        <Sparkles size={15} /> Thread summary
                      </span>
                      <button
                        className="text-button"
                        onClick={() => void summarizeSelected()}
                        disabled={isSummarizing}
                      >
                        {isSummarizing
                          ? "Summarizing…"
                          : summary
                            ? "Refresh summary"
                            : "Generate summary"}
                      </button>
                    </div>
                    {summary ? (
                      <>
                        <p>{summary.summary}</p>
                        <div className="summary-facts">
                          {summary.latestDelta ? (
                            <span>
                              <strong>Latest change</strong>
                              {summary.latestDelta}
                            </span>
                          ) : null}
                          {summary.actionRequired ? (
                            <span>
                              <strong>Action</strong>
                              {summary.actionRequired}
                            </span>
                          ) : null}
                          {summary.deadline ? (
                            <span>
                              <strong>Deadline</strong>
                              {summary.deadline}
                            </span>
                          ) : null}
                        </div>
                        <small className="evidence-note">
                          Source: {summary.sourceMessageIds.join(", ")} ·{" "}
                          {summary.provider === "local"
                            ? "local fallback"
                            : summary.provider}
                        </small>
                      </>
                    ) : (
                      <p className="summary-placeholder">
                        A short, evidence-backed summary will appear here
                        without replacing the original message.
                      </p>
                    )}
                  </section>
                  <div
                    className="instant-replies"
                    aria-label="Instant reply options"
                  >
                    <span>
                      <WandSparkles size={14} /> Instant reply
                    </span>
                    <button
                      onClick={() =>
                        openInstantReply(
                          "Confirm receipt and say I will review this today.",
                        )
                      }
                    >
                      Confirm receipt
                    </button>
                    <button
                      onClick={() =>
                        openInstantReply(
                          "Agree to the request and state the next step.",
                        )
                      }
                    >
                      Agree + next step
                    </button>
                    <button
                      onClick={() =>
                        openInstantReply(
                          "Ask for a little more time and propose a clear follow-up.",
                        )
                      }
                    >
                      Ask for time
                    </button>
                  </div>
                  {(selectedThread.messages?.length
                    ? selectedThread.messages
                    : [
                        {
                          id:
                            selectedThread.latestMessageId ?? selectedThread.id,
                          sender: selectedThread.sender,
                          senderEmail: selectedThread.senderEmail,
                          subject: selectedThread.subject,
                          preview: selectedThread.preview,
                          timestamp: selectedThread.timestamp,
                          htmlBody: selectedThread.htmlBody,
                          textBody: undefined,
                        },
                      ]
                  ).map((message) => (
                    <article className="message-card" key={message.id}>
                      <div className="message-card-head">
                        <span className="avatar-pip">
                          {message.sender.slice(0, 1)}
                        </span>
                        <div>
                          <strong>{message.sender}</strong>
                          <small>{message.senderEmail}</small>
                        </div>
                        <time>{message.timestamp}</time>
                      </div>
                      {message.htmlBody ? (
                        <div
                          className="message-body"
                          dangerouslySetInnerHTML={{
                            __html: sanitizeEmailHtml(message.htmlBody),
                          }}
                        />
                      ) : (
                        <p>{message.textBody ?? message.preview}</p>
                      )}
                    </article>
                  ))}
                  {composeMode ? (
                    <div className="composer-card">
                      <div className="composer-head">
                        <span>
                          {composeMode === "reply"
                            ? `Reply to ${selectedThread.sender}`
                            : composeMode === "reply-all"
                              ? `Reply all to ${selectedThread.sender}`
                              : "New message"}
                        </span>
                        <button
                          className="icon-button"
                          aria-label="Close composer"
                          onClick={() => setComposeMode(null)}
                        >
                          <X size={15} />
                        </button>
                      </div>
                      <div className="composer-fields">
                        <label>
                          <span>To</span>
                          <input
                            aria-label="To"
                            value={composeTo}
                            onChange={(event) =>
                              setComposeTo(event.target.value)
                            }
                            placeholder="name@example.com"
                          />
                        </label>
                        <label>
                          <span>Cc</span>
                          <input
                            aria-label="Cc"
                            value={composeCc}
                            onChange={(event) =>
                              setComposeCc(event.target.value)
                            }
                            placeholder="Optional"
                          />
                        </label>
                        <label>
                          <span>Subject</span>
                          <input
                            aria-label="Subject"
                            value={composeSubject}
                            onChange={(event) =>
                              setComposeSubject(event.target.value)
                            }
                            placeholder="Subject"
                          />
                        </label>
                      </div>
                      <div className="composer-ai-row">
                        <label>
                          <span>
                            <WandSparkles size={13} /> Write with AI
                          </span>
                          <input
                            aria-label="Reply intent"
                            value={draftIntent}
                            onChange={(event) =>
                              setDraftIntent(event.target.value)
                            }
                            placeholder="tell Maya Thursday works and ask for the final clause"
                          />
                        </label>
                        <button
                          className="secondary-button"
                          onClick={() => void writeWithAI()}
                          disabled={isWritingWithAI || isDrafting || isSending}
                        >
                          <Sparkles size={14} />{" "}
                          {isWritingWithAI ? "Writing…" : "Generate"}
                        </button>
                      </div>
                      <textarea
                        ref={composeRef}
                        aria-label="Message body"
                        placeholder="Write a message…"
                        value={composeText}
                        onChange={(event) => setComposeText(event.target.value)}
                      />
                      <div className="composer-foot">
                        <span>
                          {isDrafting
                            ? "Saving draft…"
                            : draftId
                              ? "Draft saved locally"
                              : "Draft is not saved yet"}
                        </span>
                        <div className="composer-actions">
                          <button
                            className="secondary-button"
                            onClick={() => void saveDraft()}
                            disabled={isDrafting || isSending}
                          >
                            {isDrafting ? "Saving…" : "Save draft"}
                          </button>
                          <button
                            className="send-button"
                            onClick={() => void sendDraft()}
                            disabled={isDrafting || isSending}
                          >
                            <Send size={14} /> {isSending ? "Sending…" : "Send"}
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : null}
                </>
              ) : (
                <div className="empty-state">
                  <Inbox size={24} />
                  <p>Select a thread to inspect it.</p>
                </div>
              )}
            </section>
          </div>
        )}
      </section>

      {notice ? (
        <div className="toast" role="status">
          {notice}
        </div>
      ) : null}

      {aiSettingsOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setAISettingsOpen(false)}
        >
          <section
            className="settings-dialog"
            role="dialog"
            aria-label="AI provider settings"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="settings-dialog-head">
              <div>
                <span className="eyebrow">BYOK / SESSION ONLY</span>
                <h2>AI provider</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Close AI settings"
                onClick={() => setAISettingsOpen(false)}
              >
                <X size={16} />
              </button>
            </div>
            <p className="settings-copy">
              Subzero sends only the selected, bounded mail context to your
              provider. The key stays in the background worker&apos;s memory and
              is cleared on sign out or worker restart.
            </p>
            <div className="settings-fields">
              <label>
                <span>Provider</span>
                <select
                  aria-label="AI provider"
                  value={aiProvider}
                  onChange={(event) => {
                    const next = event.target.value as AIProviderId;
                    const defaults = providerDefaults(next);
                    setAIProvider(next);
                    setAIModel(defaults.model);
                    setAIBaseUrl(defaults.baseUrl);
                  }}
                >
                  <option value="openai-compatible">OpenAI-compatible</option>
                  <option value="anthropic">Anthropic</option>
                  <option value="gemini">Gemini</option>
                </select>
              </label>
              <label>
                <span>Model</span>
                <input
                  aria-label="AI model"
                  value={aiModel}
                  onChange={(event) => setAIModel(event.target.value)}
                  placeholder="gpt-4o-mini"
                />
              </label>
              {aiProvider === "openai-compatible" ? (
                <label>
                  <span>Base URL</span>
                  <input
                    aria-label="AI base URL"
                    value={aiBaseUrl}
                    onChange={(event) => setAIBaseUrl(event.target.value)}
                    placeholder="https://api.openai.com/v1"
                  />
                </label>
              ) : null}
              <label>
                <span>
                  API key <small>not persisted</small>
                </span>
                <input
                  aria-label="AI API key"
                  type="password"
                  value={aiKey}
                  onChange={(event) => setAIKey(event.target.value)}
                  placeholder={
                    aiSettings.sessionConfigured
                      ? "Configured for this session"
                      : "Paste a key for this session"
                  }
                />
              </label>
            </div>
            <div className="settings-foot">
              <span className="settings-status">
                {aiSettings.sessionConfigured ? (
                  <CheckCircle2 size={14} />
                ) : (
                  <ShieldCheck size={14} />
                )}
                {aiSettings.sessionConfigured
                  ? "Session provider ready"
                  : "No key stored by Subzero"}
              </span>
              <div className="composer-actions">
                {aiSettings.sessionConfigured ? (
                  <>
                    <button
                      className="text-button"
                      onClick={() => void testConfiguredAI()}
                      disabled={isTestingAI}
                    >
                      {isTestingAI ? "Testing…" : "Test provider"}
                    </button>
                    <button
                      className="text-button danger"
                      onClick={() => void clearConfiguredAI()}
                    >
                      Clear key
                    </button>
                  </>
                ) : null}
                <button
                  className="send-button"
                  onClick={() => void saveAISettings()}
                >
                  <Settings2 size={14} /> Save for session
                </button>
              </div>
            </div>
          </section>
        </div>
      ) : null}

      {paletteOpen ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={() => setPaletteOpen(false)}
        >
          <section
            className="command-palette"
            role="dialog"
            aria-label="Keyboard shortcuts"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="palette-search">
              <Search size={16} />
              <input
                ref={paletteRef}
                placeholder="Type a command"
                onKeyDown={(event) => {
                  if (event.key === "Escape") setPaletteOpen(false);
                }}
              />
            </div>
            <div className="palette-list">
              <button
                onClick={() => {
                  setPaletteOpen(false);
                  openCompose("new");
                }}
              >
                <Pencil size={15} />
                <span>Quick compose</span>
                <kbd>C</kbd>
              </button>
              <button
                onClick={() => {
                  setPaletteOpen(false);
                  setView("ask");
                }}
              >
                <CircleHelp size={15} />
                <span>Ask Inbox</span>
                <kbd>AI</kbd>
              </button>
              <button
                onClick={() => {
                  setPaletteOpen(false);
                  setView("loops");
                }}
              >
                <ListChecks size={15} />
                <span>Open Loops</span>
                <kbd>LOOP</kbd>
              </button>
              <button
                onClick={() => {
                  setPaletteOpen(false);
                  archiveSelected();
                }}
              >
                <Archive size={15} />
                <span>Archive selected</span>
                <kbd>E</kbd>
              </button>
              <button
                onClick={() => {
                  setPaletteOpen(false);
                  toggleUnreadSelected();
                }}
              >
                <Check size={15} />
                <span>Toggle unread</span>
                <kbd>U</kbd>
              </button>
              <button
                onClick={() => {
                  setPaletteOpen(false);
                  toggleStarSelected();
                }}
              >
                <Star size={15} />
                <span>Toggle star</span>
                <kbd>S</kbd>
              </button>
              <button
                onClick={() => {
                  setPaletteOpen(false);
                  void syncGmail();
                }}
              >
                <RefreshCw size={15} />
                <span>Refresh Gmail</span>
                <kbd>↵</kbd>
              </button>
            </div>
            <div className="palette-footer">
              <span>Navigate with J / K</span>
              <span>Close with Esc</span>
            </div>
          </section>
        </div>
      ) : null}

      <div className="privacy-footnote">
        <ShieldCheck size={13} /> Gmail API only · no content scripts · local
        cache boundary
      </div>
    </main>
  );
}
