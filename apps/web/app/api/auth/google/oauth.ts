import { randomBytes, timingSafeEqual } from "node:crypto";

import { google } from "googleapis";

import {
  decryptSecret,
  encryptSecret,
  requireEncryptionKey,
  SecretEncryptionError,
} from "@subzero/security";
import {
  assertSingleGmailAccount,
  createGmailApiClient,
  DemoMailProvider,
  GmailMailProvider,
  isOAuthRevokedError,
  OneAccountLimitError,
  toMailProviderError,
  type MailAccount,
  type MailThread,
} from "@subzero/mail";
import { createStorage } from "@subzero/storage";

import { configureMailRouteContextResolver } from "../../mail/runtime";

export const GOOGLE_GMAIL_MODIFY_SCOPE =
  "https://www.googleapis.com/auth/gmail.modify";
export const GOOGLE_OAUTH_STATE_COOKIE = "subzero_oauth_state";
export const SUBZERO_ACCOUNT_ID_COOKIE = "subzero_account_id";
export const PRIMARY_GMAIL_ACCOUNT_ID = "gmail-primary";

const OAUTH_STATE_MAX_AGE_SECONDS = 10 * 60;
const ACCOUNT_SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const GOOGLE_IDENTITY_SCOPES = ["openid", "email", "profile"];
const DEMO_ACCOUNT: MailAccount = {
  id: "demo-account",
  // Keep the server fixture aligned with the explicit client-side demo inbox.
  gmailAddress: "you@example.com",
  googleSubject: "subzero-demo",
};

/**
 * Source-backed server fixture for local product exploration and E2E tests.
 * It is intentionally limited to the one thread needed by server-backed
 * derived-state features; the client demo inbox remains a separate UI fixture.
 */
const DEMO_THREADS: MailThread[] = [
  {
    id: "thread-maya-contract",
    latestMessageId: "msg-maya-2",
    subject: "Contract review before Thursday",
    participants: [
      { address: "maya@atlas.studio", name: "Maya Chen" },
      { address: "legal@atlas.studio", name: "Legal" },
      { address: "you@example.com", name: "You" },
    ],
    preview: "Could you send the revised contract before our Thursday review?",
    unread: true,
    labelIds: ["INBOX", "UNREAD"],
    updatedAt: "2026-08-10T10:42:00.000Z",
    metadataOnly: false,
    messages: [
      {
        id: "msg-maya-1",
        threadId: "thread-maya-contract",
        subject: "Contract review before Thursday",
        from: { address: "you@example.com", name: "You" },
        to: [{ address: "maya@atlas.studio", name: "Maya Chen" }],
        cc: [],
        bcc: [],
        snippet: "Hi Maya, I will send the revised agreement this week.",
        body: "Hi Maya, I will send the revised agreement this week.",
        labelIds: ["SENT"],
        headers: {},
      },
      {
        id: "msg-maya-2",
        threadId: "thread-maya-contract",
        subject: "Contract review before Thursday",
        from: { address: "maya@atlas.studio", name: "Maya Chen" },
        to: [{ address: "you@example.com", name: "You" }],
        cc: [{ address: "legal@atlas.studio", name: "Legal" }],
        bcc: [],
        snippet:
          "Could you send the revised contract before our Thursday review?",
        body: "Could you send the revised contract before our Thursday review? I especially want to confirm the termination clause.",
        labelIds: ["INBOX", "UNREAD"],
        headers: {},
      },
    ],
  },
];
const demoProvider = new DemoMailProvider({
  account: DEMO_ACCOUNT,
  threads: DEMO_THREADS,
});

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export type CallbackFailureReason =
  | "invalid_state"
  | "missing_code"
  | "reconnect"
  | "oauth_exchange_failed"
  | "missing_refresh_token"
  | "insufficient_scope"
  | "identity_unavailable"
  | "one_account_limit"
  | "oauth_not_configured";

export class OAuthConfigurationError extends Error {
  constructor() {
    super("Google OAuth is not configured.");
    this.name = "OAuthConfigurationError";
  }
}

export function getGoogleOAuthConfig(
  environment: NodeJS.ProcessEnv = process.env,
): GoogleOAuthConfig {
  const clientId = requiredEnvironmentValue(environment.GOOGLE_CLIENT_ID);
  const clientSecret = requiredEnvironmentValue(
    environment.GOOGLE_CLIENT_SECRET,
  );
  const redirectUri = requiredEnvironmentValue(environment.GOOGLE_REDIRECT_URI);

  try {
    requireEncryptionKey(environment.SUBZERO_ENCRYPTION_KEY);
  } catch (error) {
    if (error instanceof SecretEncryptionError) {
      throw new OAuthConfigurationError();
    }
    throw error;
  }

  return { clientId, clientSecret, redirectUri };
}

export function createGoogleOAuthClient(config: GoogleOAuthConfig) {
  return new google.auth.OAuth2(
    config.clientId,
    config.clientSecret,
    config.redirectUri,
  );
}

export function createOAuthState(): string {
  return randomBytes(32).toString("base64url");
}

export function buildGoogleAuthorizationUrl(
  client: ReturnType<typeof createGoogleOAuthClient>,
  state: string,
): string {
  return client.generateAuthUrl({
    access_type: "offline",
    include_granted_scopes: true,
    prompt: "consent",
    scope: [GOOGLE_GMAIL_MODIFY_SCOPE, ...GOOGLE_IDENTITY_SCOPES],
    state,
  });
}

export function setOAuthStateCookie<
  T extends {
    cookies: {
      set: (options: {
        name: string;
        value: string;
        httpOnly: boolean;
        sameSite: "lax";
        secure: boolean;
        path: string;
        maxAge: number;
      }) => unknown;
    };
  },
>(response: T, state: string): T {
  response.cookies.set({
    name: GOOGLE_OAUTH_STATE_COOKIE,
    value: state,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google",
    maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
  });
  return response;
}

export function clearOAuthStateCookie<
  T extends {
    cookies: {
      set: (options: {
        name: string;
        value: string;
        httpOnly: boolean;
        sameSite: "lax";
        secure: boolean;
        path: string;
        maxAge: number;
      }) => unknown;
    };
  },
>(response: T): T {
  response.cookies.set({
    name: GOOGLE_OAUTH_STATE_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google",
    maxAge: 0,
  });
  return response;
}

/** Stores only the local account identifier, never Gmail/OAuth credentials. */
export function setSubzeroAccountCookie<
  T extends {
    cookies: {
      set: (options: {
        name: string;
        value: string;
        httpOnly: boolean;
        sameSite: "lax";
        secure: boolean;
        path: string;
        maxAge: number;
      }) => unknown;
    };
  },
>(response: T, accountId: string): T {
  response.cookies.set({
    name: SUBZERO_ACCOUNT_ID_COOKIE,
    value: accountId,
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ACCOUNT_SESSION_MAX_AGE_SECONDS,
  });
  return response;
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get("cookie");
  if (!header) return undefined;

  for (const entry of header.split(";")) {
    const [rawName, ...rawValue] = entry.trim().split("=");
    if (rawName === name) {
      try {
        return decodeURIComponent(rawValue.join("="));
      } catch {
        return undefined;
      }
    }
  }

  return undefined;
}

export function isValidOAuthState(
  expected: string | undefined,
  received: string | null,
): boolean {
  if (!expected || !received) return false;

  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return (
    expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes)
  );
}

export function appRedirectUrl(
  request: Request,
  parameters: Record<string, string>,
): URL {
  const url = new URL("/", request.url);
  for (const [key, value] of Object.entries(parameters)) {
    url.searchParams.set(key, value);
  }
  return url;
}

export async function persistGoogleOAuthCallback(input: {
  code: string;
  config: GoogleOAuthConfig;
}): Promise<CallbackFailureReason | null> {
  try {
    const client = createGoogleOAuthClient(input.config);
    const tokenResponse = await client.getToken(input.code);
    const tokens = tokenResponse.tokens;
    const scopes = parseScopes(tokens.scope);

    if (!scopes.includes(GOOGLE_GMAIL_MODIFY_SCOPE)) {
      return "insufficient_scope";
    }

    if (!tokens.refresh_token) {
      return "missing_refresh_token";
    }

    client.setCredentials(tokens);
    const identity = await google
      .oauth2({ version: "v2", auth: client })
      .userinfo.get();
    const googleSubject = identity.data.id;
    const gmailAddress = identity.data.email;

    if (!googleSubject || !gmailAddress) {
      return "identity_unavailable";
    }

    const storage = createStorage();
    const existing = await storage.accountById(PRIMARY_GMAIL_ACCOUNT_ID);
    assertSingleGmailAccount(existing ? [existing] : [], googleSubject);

    await storage.upsertAccount({
      id: PRIMARY_GMAIL_ACCOUNT_ID,
      gmailAddress,
      googleSubject,
      encryptedRefreshToken: encryptSecret(tokens.refresh_token),
      scopes,
    });

    return null;
  } catch (error) {
    if (error instanceof OneAccountLimitError) {
      return "one_account_limit";
    }

    return isOAuthRevokedError(toMailProviderError(error))
      ? "reconnect"
      : "oauth_exchange_failed";
  }
}

/**
 * Trusted server-side mailbox resolver. It accepts only the HttpOnly session
 * account ID, reloads the encrypted refresh token from storage, then binds the
 * Gmail adapter to that same account. No client request can select another ID.
 */
export async function resolveAuthenticatedMailRouteContext(request: Request) {
  const accountId = readCookie(request, SUBZERO_ACCOUNT_ID_COOKIE);

  if (
    process.env.SUBZERO_DEMO_MODE === "true" &&
    (!accountId || accountId === DEMO_ACCOUNT.id)
  ) {
    return { account: DEMO_ACCOUNT, provider: demoProvider };
  }

  if (accountId !== PRIMARY_GMAIL_ACCOUNT_ID) {
    return null;
  }

  try {
    const storedAccount = await createStorage().accountById(accountId);
    if (
      !storedAccount ||
      !storedAccount.scopes.includes(GOOGLE_GMAIL_MODIFY_SCOPE)
    ) {
      return null;
    }

    const account: MailAccount = {
      id: storedAccount.id,
      gmailAddress: storedAccount.gmailAddress,
      googleSubject: storedAccount.googleSubject,
    };
    const client = createGoogleOAuthClient(getGoogleOAuthConfig());
    client.setCredentials({
      refresh_token: decryptSecret(storedAccount.encryptedRefreshToken),
    });

    return {
      account,
      provider: new GmailMailProvider({
        account,
        client: createGmailApiClient(client),
      }),
    };
  } catch {
    // Keep configuration/decryption failures opaque; unauthenticated routes
    // receive the existing safe reconnect response instead of credentials.
    return null;
  }
}

function requiredEnvironmentValue(value: string | undefined): string {
  const normalized = value?.trim();
  if (
    !normalized ||
    normalized === "..." ||
    /^your(?:[-_]|$)/i.test(normalized)
  ) {
    throw new OAuthConfigurationError();
  }
  return normalized;
}

function parseScopes(value: string | null | undefined): string[] {
  return value?.split(/\s+/).filter(Boolean) ?? [];
}

configureMailRouteContextResolver(resolveAuthenticatedMailRouteContext);
