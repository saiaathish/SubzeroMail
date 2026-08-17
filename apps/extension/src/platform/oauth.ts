import { getChrome } from "./chrome";

export type OAuthBoundaryStatus =
  "manual_required" | "unavailable" | "invalid_url" | "completed" | "cancelled";

export interface OAuthBoundaryResult {
  status: OAuthBoundaryStatus;
  message: string;
  redirectUrl?: string;
  accountEmail?: string;
}

const GOOGLE_AUTH_ORIGIN = "https://accounts.google.com";
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";
const GOOGLE_SCOPES = [GMAIL_MODIFY_SCOPE, "openid", "email", "profile"];
const TOKEN_EXPIRY_SKEW_MS = 60_000;
const OAUTH_SESSION_KEY = "subzero.oauth.session";

interface MemoryIdentitySession {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
}

interface GoogleTokenResponse {
  access_token?: unknown;
  expires_in?: unknown;
  refresh_token?: unknown;
  error?: unknown;
  error_description?: unknown;
}

let memoryIdentitySession: MemoryIdentitySession | null = null;
let sessionLoadPromise: Promise<void> | null = null;
let sessionEpoch = 0;

function errorMessage(error: unknown): string {
  const raw =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "Chrome rejected the Google authorization request.";
  const message = raw.replace(/\s+/g, " ").trim();
  return message
    ? message.slice(0, 240)
    : "Chrome rejected the Google authorization request.";
}

function isCancellation(error: unknown): boolean {
  return /cancel|denied|abort|closed/i.test(errorMessage(error));
}

function parseIdentitySession(value: unknown): MemoryIdentitySession | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.accessToken !== "string" ||
    candidate.accessToken.trim().length === 0 ||
    typeof candidate.expiresAt !== "number" ||
    !Number.isFinite(candidate.expiresAt)
  ) {
    return null;
  }

  const refreshToken =
    typeof candidate.refreshToken === "string" &&
    candidate.refreshToken.trim().length > 0
      ? candidate.refreshToken.trim()
      : undefined;
  return {
    accessToken: candidate.accessToken.trim(),
    ...(refreshToken ? { refreshToken } : {}),
    expiresAt: candidate.expiresAt,
  };
}

async function loadSessionIdentity(): Promise<void> {
  if (memoryIdentitySession) return;
  if (sessionLoadPromise) return sessionLoadPromise;

  const storage = getChrome()?.storage?.session;
  if (!storage?.get) return;

  const epoch = sessionEpoch;
  sessionLoadPromise = Promise.resolve()
    .then(() => storage.get(OAUTH_SESSION_KEY))
    .then((items) => {
      if (epoch !== sessionEpoch || memoryIdentitySession) return;
      memoryIdentitySession = parseIdentitySession(items[OAUTH_SESSION_KEY]);
    })
    .catch(() => undefined)
    .finally(() => {
      if (epoch === sessionEpoch) sessionLoadPromise = null;
    });
  return sessionLoadPromise;
}

async function persistSessionIdentity(
  session: MemoryIdentitySession,
): Promise<void> {
  const storage = getChrome()?.storage?.session;
  if (!storage?.set) return;
  try {
    await storage.set({ [OAUTH_SESSION_KEY]: session });
  } catch {
    // Session storage is a resilience layer. Keep the live token usable even
    // when a browser profile refuses the best-effort persistence write.
  }
}

async function removeSessionIdentity(): Promise<void> {
  const storage = getChrome()?.storage?.session;
  if (!storage?.remove) return;
  try {
    await storage.remove(OAUTH_SESSION_KEY);
  } catch {
    // Sign-out still clears the in-memory session when storage is unavailable.
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomBase64Url(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function createPkcePair(): Promise<{
  verifier: string;
  challenge: string;
}> {
  const verifier = randomBase64Url(32);
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(verifier),
  );
  return { verifier, challenge: toBase64Url(new Uint8Array(digest)) };
}

function extensionClientId(): string | null {
  const manifest = getChrome()?.runtime?.getManifest?.();
  const value = manifest?.oauth2?.client_id;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}

async function rememberTokenResponse(
  response: GoogleTokenResponse,
  existingRefreshToken?: string,
): Promise<string> {
  if (
    typeof response.access_token !== "string" ||
    response.access_token.trim().length === 0
  ) {
    throw new Error(
      typeof response.error_description === "string"
        ? response.error_description
        : "Google did not return an access token.",
    );
  }

  const expiresIn =
    typeof response.expires_in === "number" &&
    Number.isFinite(response.expires_in)
      ? Math.max(60, response.expires_in)
      : 3600;
  const refreshToken =
    typeof response.refresh_token === "string" &&
    response.refresh_token.trim().length > 0
      ? response.refresh_token.trim()
      : existingRefreshToken;

  const session: MemoryIdentitySession = {
    accessToken: response.access_token.trim(),
    ...(refreshToken ? { refreshToken } : {}),
    expiresAt: Date.now() + expiresIn * 1000,
  };
  memoryIdentitySession = session;
  await persistSessionIdentity(session);
  return session.accessToken;
}

async function postGoogleTokenRequest(
  parameters: Record<string, string>,
): Promise<GoogleTokenResponse> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(parameters),
  });

  const payload = (await response
    .json()
    .catch(() => ({}))) as GoogleTokenResponse;
  if (!response.ok) {
    throw new Error(
      typeof payload.error_description === "string"
        ? payload.error_description
        : typeof payload.error === "string"
          ? payload.error
          : "Google token exchange failed.",
    );
  }
  return payload;
}

async function refreshMemoryToken(): Promise<string | null> {
  const session = memoryIdentitySession;
  const clientId = extensionClientId();
  if (!session?.refreshToken || !clientId) return null;

  try {
    const response = await postGoogleTokenRequest({
      client_id: clientId,
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
    });
    return rememberTokenResponse(response, session.refreshToken);
  } catch {
    memoryIdentitySession = null;
    await removeSessionIdentity();
    return null;
  }
}

export async function getIdentityToken(interactive = false): Promise<string> {
  await loadSessionIdentity();
  if (
    memoryIdentitySession &&
    memoryIdentitySession.expiresAt > Date.now() + TOKEN_EXPIRY_SKEW_MS
  ) {
    return memoryIdentitySession.accessToken;
  }

  if (memoryIdentitySession?.refreshToken) {
    const refreshed = await refreshMemoryToken();
    if (refreshed) return refreshed;
  } else if (memoryIdentitySession) {
    memoryIdentitySession = null;
    await removeSessionIdentity();
  }

  const identity = getChrome()?.identity;
  if (!identity?.getAuthToken) {
    throw new Error("Chrome identity token API is unavailable.");
  }

  const result = await identity.getAuthToken({
    interactive,
    scopes: [GMAIL_MODIFY_SCOPE],
  });
  const token = result?.token;
  if (typeof token !== "string" || token.trim().length === 0) {
    throw new Error("Chrome did not return a Gmail access token.");
  }
  return token.trim();
}

/** Clear Chrome's cached identity tokens and the extension's session token. */
export async function clearIdentitySession(): Promise<void> {
  memoryIdentitySession = null;
  sessionEpoch += 1;
  sessionLoadPromise = null;

  const chrome = getChrome();
  const identity = chrome?.identity;
  const storage = chrome?.storage?.session;
  const operations: Promise<unknown>[] = [];
  if (storage?.remove) {
    operations.push(
      Promise.resolve().then(() => storage.remove?.(OAUTH_SESSION_KEY)),
    );
  }
  if (identity?.clearAllCachedAuthTokens) {
    operations.push(
      Promise.resolve().then(() => identity.clearAllCachedAuthTokens?.()),
    );
  }
  await Promise.allSettled(operations);
}

export function getIdentityRedirectUrl(): string | null {
  const identity = getChrome()?.identity;
  if (!identity?.getRedirectURL) return null;

  try {
    return identity.getRedirectURL("subzero-mail");
  } catch {
    return null;
  }
}

async function startPkceOAuth(): Promise<OAuthBoundaryResult> {
  const identity = getChrome()?.identity;
  const redirectUrl = getIdentityRedirectUrl();
  const clientId = extensionClientId();
  if (!identity?.launchWebAuthFlow || !redirectUrl || !clientId) {
    return {
      status: "unavailable",
      message:
        "Chrome cannot start Google authorization in this profile. Check the extension OAuth client configuration.",
    };
  }

  const { verifier, challenge } = await createPkcePair();
  const state = randomBase64Url();
  const authorizationUrl = new URL(GOOGLE_AUTH_ENDPOINT);
  authorizationUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUrl,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  }).toString();

  const returnedUrl = await identity.launchWebAuthFlow({
    url: authorizationUrl.toString(),
    interactive: true,
  });
  const callbackUrl = new URL(returnedUrl);
  const expectedRedirect = new URL(redirectUrl);
  if (
    callbackUrl.origin !== expectedRedirect.origin ||
    callbackUrl.pathname !== expectedRedirect.pathname
  ) {
    throw new Error("Google returned to an unexpected OAuth redirect.");
  }
  if (callbackUrl.searchParams.get("state") !== state) {
    throw new Error("Google returned an invalid OAuth state.");
  }

  const providerError = callbackUrl.searchParams.get("error");
  if (providerError) {
    throw new Error(
      providerError === "access_denied"
        ? "Google authorization was denied."
        : "Google authorization was not completed.",
    );
  }

  const code = callbackUrl.searchParams.get("code");
  if (!code) throw new Error("Google did not return an authorization code.");

  const tokenResponse = await postGoogleTokenRequest({
    client_id: clientId,
    code,
    code_verifier: verifier,
    grant_type: "authorization_code",
    redirect_uri: redirectUrl,
  });
  await rememberTokenResponse(tokenResponse);

  return {
    status: "completed",
    message:
      "Google authorized Gmail access. Subzero will now load recent mail.",
  };
}

/**
 * Authenticate the extension directly with Gmail. Chrome's cached identity
 * flow is preferred; PKCE is the browser-signin-independent fallback.
 */
export async function startIdentityOAuth(): Promise<OAuthBoundaryResult> {
  const redirectUrl = getIdentityRedirectUrl() ?? undefined;
  const identity = getChrome()?.identity;

  let identityFailure: unknown;
  if (identity?.getAuthToken) {
    try {
      await getIdentityToken(true);
      return {
        status: "completed",
        message:
          "Google authorized Gmail access. Subzero will now load recent mail.",
        ...(redirectUrl ? { redirectUrl } : {}),
      };
    } catch (error) {
      identityFailure = error;
      if (isCancellation(error) || !identity.launchWebAuthFlow) {
        return {
          status: "cancelled",
          message: `Google authorization did not complete. ${errorMessage(error)} No token was stored by Subzero.`,
          ...(redirectUrl ? { redirectUrl } : {}),
        };
      }
    }
  }

  if (identity?.launchWebAuthFlow) {
    try {
      return await startPkceOAuth();
    } catch (error) {
      return {
        status: "cancelled",
        message: `Google authorization did not complete. ${errorMessage(error)} No token was stored by Subzero.`,
        ...(redirectUrl ? { redirectUrl } : {}),
      };
    }
  }

  if (!identity) {
    return {
      status: "unavailable",
      message: "Chrome identity is unavailable in this profile.",
    };
  }
  if (!identity.getAuthToken && !identity.launchWebAuthFlow) {
    return {
      status: "unavailable",
      message: "Chrome identity token API is unavailable in this profile.",
    };
  }
  return {
    status: "cancelled",
    message: `Google authorization did not complete. ${errorMessage(identityFailure)} No token was stored by Subzero.`,
    ...(redirectUrl ? { redirectUrl } : {}),
  };
}
