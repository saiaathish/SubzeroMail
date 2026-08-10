import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";

const workspaceRoot = fileURLToPath(new URL("../../", import.meta.url));

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: workspaceRoot,
  transpilePackages: [
    "@subzero/ai",
    "@subzero/mail",
    "@subzero/security",
    "@subzero/storage",
  ],
  // sql.js relies on its CommonJS/WASM loader. Keep it external so the
  // Next.js server does not rewrite the loader's `module.exports` branch.
  serverExternalPackages: ["googleapis", "sql.js"],
  // Playwright exercises the dev server through its loopback address while
  // Next advertises localhost. Allow both origins so RSC and HMR requests do
  // not fall back to a full reload in WebKit.
  allowedDevOrigins: ["127.0.0.1"],
};

export default nextConfig;
