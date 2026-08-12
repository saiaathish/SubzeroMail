import {
  DEFAULT_EXTENSION_STATE,
  type ExtensionPreferences,
  type GmailPageContext,
} from "../types";
import { sendGmailMessage } from "./messaging";
import {
  findComposer,
  findComposerMountParent,
  findThreadRows,
  findThreadSurface,
  findThreadToolbar,
} from "./selectors";

const MOUNT_ATTRIBUTE = "data-subzero-gmail-mount";
const summaryByThread = new Map<
  string,
  { latestMessageId: string | null; data: SummaryData }
>();
const statusByThread = new Map<string, string>();

interface SummaryData {
  summary?: string;
  latestDelta?: string | null;
  actionRequired?: string | null;
  deadline?: string | null;
  sourceMessageIds?: string[];
  provider?: string;
}

const SHADOW_CSS = `
:host { all: initial; font-family: "Instrument Sans", ui-sans-serif, system-ui, -apple-system, sans-serif; color: #eaf7fb; }
* { box-sizing: border-box; }
button, input { font: inherit; }
button { cursor: pointer; }
.sz-shell { position: relative; display: inline-flex; align-items: center; gap: 6px; color: #eaf7fb; }
.sz-button { border: 1px solid rgba(56,189,248,.45); border-radius: 999px; background: #0d1b22; color: #eaf7fb; padding: 5px 10px; font-size: 12px; font-weight: 700; line-height: 1.1; box-shadow: 0 3px 12px rgba(0,0,0,.16); }
.sz-button:hover, .sz-button:focus-visible { border-color: #38bdf8; background: #102c3c; }
.sz-menu { position: absolute; z-index: 2147483646; top: calc(100% + 7px); right: 0; display: grid; min-width: 190px; gap: 3px; padding: 7px; border: 1px solid #285160; border-radius: 10px; background: #09151b; box-shadow: 0 16px 42px rgba(0,0,0,.35); }
.sz-menu[hidden] { display: none; }
.sz-menu button { border: 0; border-radius: 6px; background: transparent; color: #d8ebf2; padding: 8px 9px; text-align: left; font-size: 12px; }
.sz-menu button:hover, .sz-menu button:focus-visible { background: #102c3c; color: #fff; }
.sz-status { max-width: 220px; color: #9dc0cc; font-size: 11px; }
.sz-summary { display: grid; gap: 9px; max-width: min(620px, calc(100vw - 48px)); margin: 10px 0; border-left: 2px solid #38bdf8; border-top: 1px solid rgba(56,189,248,.2); border-right: 1px solid rgba(56,189,248,.2); border-bottom: 1px solid rgba(56,189,248,.2); border-radius: 8px; background: #09151b; padding: 12px 14px; color: #eaf7fb; box-shadow: 0 8px 26px rgba(0,0,0,.12); }
.sz-summary h3 { margin: 0; color: #8ddcff; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; }
.sz-summary p { margin: 0; font-size: 13px; line-height: 1.45; }
.sz-meta { display: grid; grid-template-columns: 64px 1fr; gap: 4px 10px; color: #a7c3cd; font-size: 11px; }
.sz-meta strong { color: #6f9daa; font-size: 10px; letter-spacing: .08em; text-transform: uppercase; }
.sz-composer { display: inline-flex; align-items: center; gap: 5px; margin: 4px 0; }
.sz-composer button { border: 1px solid rgba(56,189,248,.38); border-radius: 6px; background: #e8f5fd; color: #071116; padding: 5px 8px; font-size: 11px; font-weight: 700; }
.sz-quick-replies { display: inline-flex; align-items: center; flex-wrap: wrap; gap: 4px; }
.sz-quick-reply { border-radius: 999px !important; background: #102c3c !important; color: #d8f4ff !important; padding: 4px 7px !important; font-size: 10px !important; }
.sz-quick-reply:hover, .sz-quick-reply:focus-visible { border-color: #38bdf8 !important; background: #163d50 !important; }
.sz-signal { display: inline-flex; align-items: center; margin-left: 7px; color: #38bdf8; font-size: 10px; font-weight: 700; }
@media (prefers-color-scheme: light) { :host { color: #10232d; } .sz-button, .sz-menu, .sz-summary { background: #fff; color: #10232d; } .sz-menu { border-color: #b8cbd4; } .sz-menu button { color: #23424e; } .sz-summary p { color: #193540; } }
`;

const QUICK_REPLY_INTENTS = [
  "Thursday works",
  "Ask for another time",
  "Confirm tomorrow",
] as const;

function ensureHost(
  id: string,
  parent: HTMLElement,
  display: "inline-flex" | "block",
): ShadowRoot {
  let host = document.getElementById(id) as HTMLElement | null;
  if (!host) {
    host = document.createElement("div");
    host.id = id;
    host.setAttribute(MOUNT_ATTRIBUTE, id);
    host.attachShadow({ mode: "open" });
  }
  if (host.parentElement !== parent) parent.append(host);
  host.style.display = display;
  host.style.font = "inherit";
  const shadow = host.shadowRoot;
  if (!shadow) throw new Error("Subzero Gmail shadow root unavailable.");
  if (!shadow.querySelector("style")) {
    const style = document.createElement("style");
    style.textContent = SHADOW_CSS;
    shadow.append(style);
  }
  return shadow;
}

function clearContent(shadow: ShadowRoot): void {
  Array.from(shadow.children)
    .filter((child) => child.tagName !== "STYLE")
    .forEach((child) => child.remove());
}

function button(label: string, action: string): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = label;
  element.dataset.action = action;
  return element;
}

function setStatus(threadId: string, value: string): void {
  statusByThread.set(threadId, value);
  const status = Array.from(
    document.querySelectorAll<HTMLElement>(
      "#subzero-gmail-thread-actions [data-status-for]",
    ),
  ).find((candidate) => candidate.dataset.statusFor === threadId);
  if (status) status.textContent = value;
}

function showSummary(
  threadId: string,
  data: SummaryData,
  latestMessageId: string | null = null,
): void {
  summaryByThread.set(threadId, { latestMessageId, data });
  const parent = findThreadSurface();
  if (!parent) return;
  const shadow = ensureHost("subzero-gmail-summary", parent, "block");
  clearContent(shadow);
  const card = document.createElement("section");
  card.className = "sz-summary";
  card.setAttribute("aria-label", "Subzero thread summary");
  const heading = document.createElement("h3");
  heading.textContent = `✦ Subzero${data.provider ? ` · ${data.provider}` : ""}`;
  const summary = document.createElement("p");
  summary.textContent = data.summary ?? "Summary unavailable.";
  card.append(heading, summary);
  const meta = document.createElement("div");
  meta.className = "sz-meta";
  for (const [label, value] of [
    ["Latest", data.latestDelta],
    ["Action", data.actionRequired],
    ["Due", data.deadline],
  ] as const) {
    if (!value) continue;
    const key = document.createElement("strong");
    key.textContent = label;
    const item = document.createElement("span");
    item.textContent = value;
    meta.append(key, item);
  }
  card.append(meta);
  shadow.append(card);
}

function insertDraftIntoComposer(draft: string): void {
  const composer = findComposer();
  if (!composer) return;
  if (composer.textContent?.trim()) {
    const replace = globalThis.confirm?.(
      "This Gmail draft already has text. Replace it with the Subzero draft?",
    );
    if (!replace) return;
  }
  composer.textContent = draft;
  composer.dispatchEvent(
    new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: draft,
    }),
  );
  composer.dispatchEvent(new Event("change", { bubbles: true }));
}

async function requestDraft(threadId: string, intent: string): Promise<void> {
  setStatus(threadId, "Writing draft…");
  const response = await sendGmailMessage<{
    draft?: string;
    provider?: string;
  }>({
    type: "ai/draft",
    threadId,
    intent,
  });
  if (!response.ok || !response.data?.draft) {
    setStatus(
      threadId,
      response.error?.message ??
        "Draft unavailable. Open Subzero to sync this thread.",
    );
    return;
  }
  insertDraftIntoComposer(response.data.draft);
  setStatus(threadId, "Draft inserted. Review before sending.");
}

async function runThreadAction(
  threadId: string,
  action: string,
  latestMessageId: string | null = null,
): Promise<void> {
  if (action === "summary" || action === "ask") {
    setStatus(
      threadId,
      action === "summary" ? "Reading thread…" : "Preparing thread context…",
    );
    const response = await sendGmailMessage<SummaryData>({
      type: "ai/summarize",
      threadId,
    });
    if (!response.ok || !response.data) {
      setStatus(
        threadId,
        response.error?.message ??
          "Summary unavailable. Gmail remains unchanged.",
      );
      return;
    }
    showSummary(threadId, response.data, latestMessageId);
    setStatus(threadId, "Summary ready.");
    return;
  }
  if (action === "draft") {
    await requestDraft(
      threadId,
      "Write a concise, helpful reply to this thread.",
    );
    return;
  }
  if (action === "loop" || action === "remind") {
    setStatus(
      threadId,
      action === "loop"
        ? "Checking for commitments…"
        : "Scheduling reminder check…",
    );
    const response = await sendGmailMessage<{ reminders?: unknown[] }>({
      type: "loops/detect",
    });
    setStatus(
      threadId,
      response.ok
        ? action === "loop"
          ? "Open Loop scan complete. Review suggestions in the side panel."
          : "Reminder scan scheduled. Review due items in the side panel."
        : (response.error?.message ?? "Open Loops unavailable."),
    );
    return;
  }
  if (action === "open") {
    const response = await sendGmailMessage({
      type: "gmail/open-in-subzero",
      threadId,
    });
    setStatus(
      threadId,
      response.ok ? "Opened in Subzero." : "Could not open Subzero.",
    );
    return;
  }
  if (action === "sidepanel") {
    const response = await sendGmailMessage({
      type: "gmail/open-side-panel",
      threadId,
    });
    setStatus(
      threadId,
      response.ok
        ? "Intelligence rail opened."
        : (response.error?.message ?? "Side panel unavailable."),
    );
  }
}

function renderThreadActions(context: GmailPageContext): void {
  const toolbar = findThreadToolbar();
  if (!toolbar || !context.threadId) return;
  const threadId = context.threadId;
  const shadow = ensureHost(
    "subzero-gmail-thread-actions",
    toolbar,
    "inline-flex",
  );
  clearContent(shadow);
  const shell = document.createElement("div");
  shell.className = "sz-shell";
  const toggle = document.createElement("button");
  toggle.className = "sz-button";
  toggle.type = "button";
  toggle.textContent = "✦ Subzero";
  toggle.setAttribute("aria-expanded", "false");
  toggle.setAttribute("aria-controls", "subzero-gmail-action-menu");
  const menu = document.createElement("div");
  menu.id = "subzero-gmail-action-menu";
  menu.className = "sz-menu";
  menu.hidden = true;
  menu.setAttribute("role", "menu");
  for (const [label, action] of [
    ["Summarize", "summary"],
    ["Draft reply", "draft"],
    ["Add to Open Loops", "loop"],
    ["Remind me", "remind"],
    ["Ask about this thread", "ask"],
    ["Open Intelligence Rail", "sidepanel"],
    ["Open in Subzero", "open"],
  ] as const) {
    const item = button(label, action);
    item.setAttribute("role", "menuitem");
    item.addEventListener("click", () => {
      menu.hidden = true;
      toggle.setAttribute("aria-expanded", "false");
      void runThreadAction(threadId, action, context.latestMessageId);
    });
    menu.append(item);
  }
  toggle.addEventListener("click", () => {
    menu.hidden = !menu.hidden;
    toggle.setAttribute("aria-expanded", String(!menu.hidden));
  });
  shell.append(toggle, menu);
  const status = document.createElement("span");
  status.className = "sz-status";
  status.dataset.statusFor = threadId;
  status.setAttribute("role", "status");
  status.textContent = statusByThread.get(threadId) ?? "";
  shell.append(status);
  shadow.append(shell);
}

function renderComposerAction(context: GmailPageContext): void {
  const parent = findComposerMountParent();
  if (!parent || !context.threadId) return;
  const shadow = ensureHost("subzero-gmail-composer", parent, "block");
  clearContent(shadow);
  const shell = document.createElement("div");
  shell.className = "sz-composer";
  const action = document.createElement("button");
  action.type = "button";
  action.textContent = "✦ Draft with Subzero";
  action.setAttribute("aria-label", "Draft a Gmail reply with Subzero");
  action.addEventListener("click", () => {
    const intent = globalThis.prompt?.(
      "Tell Subzero what this reply should say:",
      "Write a concise, helpful reply.",
    );
    if (intent?.trim())
      void requestDraft(context.threadId as string, intent.trim());
  });
  shell.append(action);
  const quickReplies = document.createElement("div");
  quickReplies.className = "sz-quick-replies";
  quickReplies.setAttribute("role", "group");
  quickReplies.setAttribute("aria-label", "Quick reply intents");
  for (const intent of QUICK_REPLY_INTENTS) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "sz-quick-reply";
    chip.textContent = intent;
    chip.setAttribute("aria-label", `Draft reply: ${intent}`);
    chip.addEventListener("click", () => {
      void requestDraft(context.threadId as string, intent);
    });
    quickReplies.append(chip);
  }
  shell.append(quickReplies);
  shadow.append(shell);
}

export function openGmailCommandPalette(context: GmailPageContext): void {
  if (!context.threadId) return;
  const shadow = ensureHost(
    "subzero-gmail-command-palette",
    document.body,
    "block",
  );
  const host = document.getElementById("subzero-gmail-command-palette");
  if (host) {
    host.style.position = "fixed";
    host.style.top = "18vh";
    host.style.left = "50%";
    host.style.transform = "translateX(-50%)";
    host.style.zIndex = "2147483647";
  }
  clearContent(shadow);
  const panel = document.createElement("section");
  panel.className = "sz-summary";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Subzero Gmail command palette");
  const title = document.createElement("h3");
  title.textContent = "Subzero commands · Esc to close";
  panel.append(title);
  for (const [label, action] of [
    ["Summarize current thread", "summary"],
    ["Draft reply", "draft"],
    ["Track commitment", "loop"],
    ["Open Intelligence Rail", "sidepanel"],
    ["Open in Subzero", "open"],
  ] as const) {
    const item = button(label, action);
    item.className = "sz-button";
    item.style.display = "block";
    item.style.width = "100%";
    item.style.marginTop = "5px";
    item.addEventListener("click", () => {
      panel.remove();
      document.getElementById("subzero-gmail-command-palette")?.remove();
      void runThreadAction(
        context.threadId as string,
        action,
        context.latestMessageId,
      );
    });
    panel.append(item);
  }
  shadow.append(panel);
}

export function closeGmailCommandPalette(): void {
  document.getElementById("subzero-gmail-command-palette")?.remove();
}

function renderFocusSignals(): void {
  for (const row of findThreadRows()) {
    const label = `${row.getAttribute("aria-label") ?? ""} ${row.textContent ?? ""}`;
    const hasSignal = /unread|important|follow up|needs reply/i.test(label);
    const old = row.querySelector<HTMLElement>("[data-subzero-focus-signal]");
    if (!hasSignal) {
      old?.remove();
      continue;
    }
    if (old) continue;
    const signal = document.createElement("span");
    signal.dataset.subzeroFocusSignal = "true";
    signal.className = "subzero-focus-signal";
    signal.setAttribute("aria-label", "Subzero focus signal");
    signal.title = "Subzero focus signal";
    signal.textContent = "●";
    signal.style.cssText =
      "display:inline-block;margin-left:6px;color:#38bdf8;font-size:9px;line-height:1;";
    row.append(signal);
  }
}

function clearFocusSignals(): void {
  document
    .querySelectorAll("[data-subzero-focus-signal]")
    .forEach((node) => node.remove());
}

export function renderGmailSurface(
  context: GmailPageContext,
  preferences: ExtensionPreferences = DEFAULT_EXTENSION_STATE.preferences,
): void {
  const embeddedEnabled = preferences.experience !== "standalone-only";
  const focusSignalsEnabled = embeddedEnabled && preferences.showFocusSignals;
  if (!focusSignalsEnabled) clearFocusSignals();
  if (!context.threadId) {
    document
      .querySelectorAll(`[${MOUNT_ATTRIBUTE}]`)
      .forEach((node) => node.remove());
    if (focusSignalsEnabled) renderFocusSignals();
    return;
  }
  if (embeddedEnabled && preferences.showThreadActions) {
    renderThreadActions(context);
  } else {
    document.getElementById("subzero-gmail-thread-actions")?.remove();
  }
  if (embeddedEnabled && context.composeOpen && preferences.showComposeAI) {
    renderComposerAction(context);
  } else {
    document.getElementById("subzero-gmail-composer")?.remove();
  }
  if (focusSignalsEnabled) renderFocusSignals();
  const summary = summaryByThread.get(context.threadId);
  if (
    embeddedEnabled &&
    summary &&
    summary.latestMessageId === context.latestMessageId
  ) {
    showSummary(context.threadId, summary.data, summary.latestMessageId);
  } else if (summary) {
    document.getElementById("subzero-gmail-summary")?.remove();
  }
}

export function unmountGmailSurface(): void {
  document
    .querySelectorAll(`[${MOUNT_ATTRIBUTE}]`)
    .forEach((node) => node.remove());
  document
    .querySelectorAll("[data-subzero-focus-signal]")
    .forEach((node) => node.remove());
}
