import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import {
  requireMailRouteContext,
  resetMailRouteContextResolverForTests,
} from "@/app/api/mail/runtime";

import { GET as beginGoogleOAuth } from "@/app/api/auth/google/route";
import { GET as completeGoogleOAuth } from "@/app/api/auth/google/callback/route";
import {
  GOOGLE_GMAIL_MODIFY_SCOPE,
  GOOGLE_OAUTH_STATE_COOKIE,
  PRIMARY_GMAIL_ACCOUNT_ID,
  resolveAuthenticatedMailRouteContext,
  setSubzeroAccountCookie,
  SUBZERO_ACCOUNT_ID_COOKIE,
} from "@/app/api/auth/google/oauth";

const requiredEnvironment = {
  GOOGLE_CLIENT_ID: "test-client-id.apps.googleusercontent.com",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  GOOGLE_REDIRECT_URI: "http://localhost:3000/api/auth/google/callback",
  SUBZERO_ENCRYPTION_KEY: Buffer.alloc(32, 9).toString("base64"),
};

afterEach(() => {
  vi.unstubAllEnvs();
});

function configureGoogleOAuth(): void {
  for (const [name, value] of Object.entries(requiredEnvironment)) {
    vi.stubEnv(name, value);
  }
}

function oauthStateCookie(response: Response): string {
  const setCookie = response.headers.get("set-cookie") ?? "";
  const match = setCookie.match(
    new RegExp(`(${GOOGLE_OAUTH_STATE_COOKIE}=[^;]+)`),
  );
  if (!match) throw new Error("OAuth state cookie was not set");
  return match[1];
}

describe("Google OAuth routes", () => {
  it("returns a safe configuration error when credentials are missing", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "");
    vi.stubEnv("GOOGLE_REDIRECT_URI", "");
    vi.stubEnv("SUBZERO_ENCRYPTION_KEY", "");

    const response = beginGoogleOAuth();

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "oauth_not_configured",
      message:
        "Google OAuth is not configured. Add the required environment values.",
    });
  });

  it("requests gmail.modify with an opaque state and an HttpOnly state cookie", () => {
    configureGoogleOAuth();

    const response = beginGoogleOAuth();
    const authorizationUrl = new URL(response.headers.get("location") ?? "");
    const scopes = authorizationUrl.searchParams.get("scope")?.split(" ") ?? [];
    const state = authorizationUrl.searchParams.get("state");
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(302);
    expect(authorizationUrl.origin).toBe("https://accounts.google.com");
    expect(authorizationUrl.searchParams.get("redirect_uri")).toBe(
      requiredEnvironment.GOOGLE_REDIRECT_URI,
    );
    expect(authorizationUrl.searchParams.get("access_type")).toBe("offline");
    expect(authorizationUrl.searchParams.get("prompt")).toBe("consent");
    expect(scopes).toContain(GOOGLE_GMAIL_MODIFY_SCOPE);
    expect(state).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(setCookie).toContain(`${GOOGLE_OAUTH_STATE_COOKIE}=${state}`);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  it("handles denied callbacks as a reconnect-safe redirect without exchanging tokens", async () => {
    configureGoogleOAuth();
    const startResponse = beginGoogleOAuth();
    const authorizationUrl = new URL(
      startResponse.headers.get("location") ?? "",
    );
    const state = authorizationUrl.searchParams.get("state") ?? "";

    const response = await completeGoogleOAuth(
      new Request(
        `http://localhost:3000/api/auth/google/callback?error=access_denied&state=${encodeURIComponent(state)}`,
        { headers: { cookie: oauthStateCookie(startResponse) } },
      ),
    );
    const redirectUrl = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(302);
    expect(redirectUrl.pathname).toBe("/");
    expect(redirectUrl.searchParams.get("auth")).toBe("error");
    expect(redirectUrl.searchParams.get("reason")).toBe("reconnect");
    expect(redirectUrl.toString()).not.toContain("access_denied");
    expect(response.headers.get("set-cookie")).toMatch(/Max-Age=0/i);
  });

  it("rejects callbacks with an invalid state before token exchange", async () => {
    configureGoogleOAuth();
    const response = await completeGoogleOAuth(
      new Request(
        "http://localhost:3000/api/auth/google/callback?code=fixture-code&state=wrong-state",
        { headers: { cookie: `${GOOGLE_OAUTH_STATE_COOKIE}=different-state` } },
      ),
    );
    const redirectUrl = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(302);
    expect(redirectUrl.searchParams.get("reason")).toBe("invalid_state");
  });

  it("treats a malformed state cookie as an invalid callback", async () => {
    configureGoogleOAuth();
    const response = await completeGoogleOAuth(
      new Request(
        "http://localhost:3000/api/auth/google/callback?code=fixture-code&state=valid-state",
        { headers: { cookie: `${GOOGLE_OAUTH_STATE_COOKIE}=%` } },
      ),
    );
    const redirectUrl = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(302);
    expect(redirectUrl.searchParams.get("reason")).toBe("invalid_state");
  });

  it("sets a secure server-only local account cookie after a successful callback", () => {
    const response = setSubzeroAccountCookie(
      NextResponse.json({ ok: true }),
      PRIMARY_GMAIL_ACCOUNT_ID,
    );
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(setCookie).toContain(
      `${SUBZERO_ACCOUNT_ID_COOKIE}=${PRIMARY_GMAIL_ACCOUNT_ID}`,
    );
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toMatch(/Path=\//i);
  });

  it("uses only the demo account in demo mode and rejects arbitrary account cookies", async () => {
    vi.stubEnv("SUBZERO_DEMO_MODE", "true");
    const demoContext = await resolveAuthenticatedMailRouteContext(
      new Request("http://localhost:3000/api/mail/threads"),
    );

    expect(demoContext?.account.id).toBe("demo-account");
    expect(demoContext?.provider.account.id).toBe("demo-account");

    vi.stubEnv("SUBZERO_DEMO_MODE", "false");
    const untrustedContext = await resolveAuthenticatedMailRouteContext(
      new Request("http://localhost:3000/api/mail/threads", {
        headers: { cookie: `${SUBZERO_ACCOUNT_ID_COOKIE}=another-account` },
      }),
    );

    expect(untrustedContext).toBeNull();
  });

  it("lazily resolves the trusted OAuth context after a fresh mail-runtime reset", async () => {
    vi.stubEnv("SUBZERO_DEMO_MODE", "true");
    resetMailRouteContextResolverForTests();

    const context = await requireMailRouteContext(
      new Request("http://localhost:3000/api/mail/threads"),
    );

    expect(context.account.id).toBe("demo-account");
    expect(context.provider.account.googleSubject).toBe("subzero-demo");
  });
});
