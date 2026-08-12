import { defineContentScript } from "wxt/utils/define-content-script";

import { startGmailIntegration } from "../src/gmail-integration/observer";

export default defineContentScript({
  matches: ["https://mail.google.com/*"],
  runAt: "document_idle",
  main() {
    return startGmailIntegration(document);
  },
});
