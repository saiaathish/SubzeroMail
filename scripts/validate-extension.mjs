import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const output = join(root, "apps/extension/.output/chrome-mv3");
const manifestPath = join(output, "manifest.json");

if (!existsSync(manifestPath)) {
  throw new Error(`Missing extension build: ${manifestPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const permissions = new Set(manifest.permissions ?? []);
const optionalHostPermissions = new Set(
  manifest.optional_host_permissions ?? [],
);
const forbiddenPermissions = ["<all_urls>", "tabs", "scripting", "history"];
const forbidden = forbiddenPermissions.filter((permission) =>
  permissions.has(permission),
);

if (manifest.manifest_version !== 3) throw new Error("Extension is not MV3.");
if (forbidden.length > 0) {
  throw new Error(`Forbidden permissions: ${forbidden.join(", ")}`);
}
if (manifest.background?.service_worker !== "background.js") {
  throw new Error("MV3 background service worker is missing.");
}
if (manifest.action?.default_popup !== "popup.html") {
  throw new Error("Useful popup is not wired to the action.");
}
if (!manifest.host_permissions?.includes("https://gmail.googleapis.com/*")) {
  throw new Error("Gmail API host permission is missing.");
}
if (!manifest.permissions?.includes("sidePanel")) {
  throw new Error("Side Panel permission is missing.");
}
if (!manifest.permissions?.includes("notifications")) {
  throw new Error("Reminder notification permission is missing.");
}
if (
  !manifest.side_panel ||
  manifest.side_panel.default_path !== "sidepanel.html"
) {
  throw new Error("Gmail side panel entrypoint is missing.");
}
if (
  !manifest.content_scripts?.some(
    (entry) =>
      entry.matches?.includes("https://mail.google.com/*") &&
      entry.js?.some((file) => file.includes("content-scripts/gmail.js")),
  )
) {
  throw new Error("Scoped Gmail content script is missing.");
}
for (const origin of [
  "https://api.openai.com/*",
  "https://api.anthropic.com/*",
  "https://generativelanguage.googleapis.com/*",
  "https://opencode.ai/*",
  "http://localhost/*",
  "http://127.0.0.1/*",
]) {
  if (!optionalHostPermissions.has(origin)) {
    throw new Error(`Optional provider access is missing: ${origin}`);
  }
}

for (const path of [
  "app.html",
  "popup.html",
  "sidepanel.html",
  "background.js",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
]) {
  if (!existsSync(join(output, path)))
    throw new Error(`Missing artifact: ${path}`);
}

const executable = readFileSync(join(output, "background.js"), "utf8");
if (/\beval\s*\(|new\s+Function\s*\(/.test(executable)) {
  throw new Error(
    "Remote/dynamic executable code pattern found in background bundle.",
  );
}

console.log(
  JSON.stringify(
    {
      status: "PASS",
      manifestVersion: manifest.manifest_version,
      permissions: [...permissions],
      hostPermissions: manifest.host_permissions,
      optionalHostPermissions: [...optionalHostPermissions],
      artifacts: 8,
    },
    null,
    2,
  ),
);
