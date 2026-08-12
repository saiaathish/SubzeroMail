import { defineConfig } from "wxt";

export default defineConfig({
  manifest: {
    name: "Subzero Mail",
    description:
      "A keyboard-first Gmail companion with a local demo inbox and an explicit OAuth boundary.",
    permissions: [
      "identity",
      "storage",
      "alarms",
      "permissions",
      "sidePanel",
      "notifications",
    ],
    host_permissions: ["https://gmail.googleapis.com/*"],
    optional_host_permissions: [
      "https://api.openai.com/*",
      "https://api.anthropic.com/*",
      "https://generativelanguage.googleapis.com/*",
      "https://opencode.ai/*",
      "http://localhost/*",
      "http://127.0.0.1/*",
    ],
    oauth2: {
      client_id:
        "542024114315-24dh9eo654fjs59on3i5dgosfaooulen.apps.googleusercontent.com",
      scopes: [
        "https://www.googleapis.com/auth/gmail.modify",
        "openid",
        "email",
        "profile",
      ],
    },
    side_panel: {
      default_path: "sidepanel.html",
    },
    action: {
      default_title: "Open Subzero Mail",
      default_icon: {
        16: "/icons/icon-16.png",
        32: "/icons/icon-32.png",
        48: "/icons/icon-48.png",
        128: "/icons/icon-128.png",
      },
    },
    icons: {
      16: "/icons/icon-16.png",
      32: "/icons/icon-32.png",
      48: "/icons/icon-48.png",
      128: "/icons/icon-128.png",
    },
  },
});
