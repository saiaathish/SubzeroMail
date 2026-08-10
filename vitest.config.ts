import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@subzero/ai": `${root}packages/ai/src/index.ts`,
      "@subzero/mail": `${root}packages/mail/src/index.ts`,
      "@subzero/security/client": `${root}packages/security/src/client.ts`,
      "@subzero/security": `${root}packages/security/src/index.ts`,
      "@subzero/storage": `${root}packages/storage/src/index.ts`,
      "@": `${root}apps/web`,
    },
  },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "jsdom",
    setupFiles: ["./tests/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
    },
  },
});
