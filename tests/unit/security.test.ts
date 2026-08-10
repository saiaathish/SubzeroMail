import {
  decryptSecret,
  encryptSecret,
  REDACTED_VALUE,
  redactForLogs,
  redactSensitiveText,
  sanitizeEmailHtmlWithMetadata,
  safeTextFallback,
  SecretDecryptionError,
} from "@subzero/security";
import { describe, expect, it } from "vitest";

const encryptionKey = Buffer.alloc(32, 7).toString("base64");
const wrongEncryptionKey = Buffer.alloc(32, 8).toString("base64");

describe("secret encryption", () => {
  it("uses SUBZERO_ENCRYPTION_KEY when no key is passed", () => {
    const previousKey = process.env.SUBZERO_ENCRYPTION_KEY;
    process.env.SUBZERO_ENCRYPTION_KEY = encryptionKey;

    try {
      const encrypted = encryptSecret("env-backed-provider-key");
      expect(decryptSecret(encrypted)).toBe("env-backed-provider-key");
    } finally {
      if (previousKey === undefined) {
        delete process.env.SUBZERO_ENCRYPTION_KEY;
      } else {
        process.env.SUBZERO_ENCRYPTION_KEY = previousKey;
      }
    }
  });

  it("round-trips secrets without serializing plaintext", () => {
    const plaintext = "provider-key-not-for-logs";
    const encrypted = encryptSecret(plaintext, encryptionKey);

    expect(encrypted).not.toContain(plaintext);
    expect(decryptSecret(encrypted, encryptionKey)).toBe(plaintext);
  });

  it("rejects wrong-key and tampered ciphertexts", () => {
    const encrypted = encryptSecret("oauth-refresh-token", encryptionKey);
    const parts = encrypted.split(".");
    const tag = parts[2] ?? "";
    parts[2] = `${tag.startsWith("A") ? "B" : "A"}${tag.slice(1)}`;

    expect(() => decryptSecret(encrypted, wrongEncryptionKey)).toThrow(
      SecretDecryptionError,
    );
    expect(() => decryptSecret(parts.join("."), encryptionKey)).toThrow(
      SecretDecryptionError,
    );
  });
});

describe("log redaction", () => {
  it("redacts OAuth tokens, provider keys, and authorization headers", () => {
    const accessToken = "access-token-should-not-appear";
    const refreshToken = "refresh-token-should-not-appear";
    const providerKey = "sk-proj-provider-key-should-not-appear";
    const authorization = "header-token-should-not-appear";

    const redacted = redactSensitiveText(
      `access_token=${accessToken}; refresh_token=${refreshToken}; api_key=${providerKey}; Authorization: Bearer ${authorization}`,
    );

    for (const secret of [
      accessToken,
      refreshToken,
      providerKey,
      authorization,
    ]) {
      expect(redacted).not.toContain(secret);
    }
    expect(redacted).toContain(REDACTED_VALUE);
  });

  it("redacts nested credentials and complete email bodies without mutation", () => {
    const source = {
      headers: { authorization: "Bearer hidden-header-token" },
      providerKey: "hidden-provider-key",
      body: "Entire untrusted email body",
      nested: { refresh_token: "hidden-refresh-token" },
    };

    const redacted = redactForLogs(source) as Record<string, unknown>;
    const serialized = JSON.stringify(redacted);

    expect(serialized).not.toContain("hidden-header-token");
    expect(serialized).not.toContain("hidden-provider-key");
    expect(serialized).not.toContain("Entire untrusted email body");
    expect(serialized).not.toContain("hidden-refresh-token");
    expect(source.body).toBe("Entire untrusted email body");
  });
});

describe("email sanitization", () => {
  it("strips active content and blocks remote images by default", () => {
    const result = sanitizeEmailHtmlWithMetadata(`
      <div onclick="steal()">Safe copy<script>alert("xss")</script></div>
      <img src="https://tracker.example/pixel.png" onerror="steal()" alt="tracker" />
      <img src="//tracker.example/pixel-two.png" />
      <a href="javascript:steal()" onclick="steal()">unsafe link</a>
    `);

    expect(result.html).toContain("Safe copy");
    expect(result.html).not.toMatch(
      /script|onclick|onerror|javascript:|tracker\.example/i,
    );
    expect(result.blockedRemoteImages).toBe(2);
  });

  it("returns safe readable text when HTML cannot be rendered", () => {
    const fallback = safeTextFallback(
      "<p>Hello <strong>world</strong><script>stealEverything()</script></p>",
    );

    expect(fallback).toContain("Hello world");
    expect(fallback).not.toContain("stealEverything");
  });
});
