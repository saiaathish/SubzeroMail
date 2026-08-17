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

function rememberTokenResponse(
  response: GoogleTokenResponse,
  existingRefreshToken?: string,
): string {
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

  memoryIdentitySession = {
    accessToken: response.access_token.trim(),
    ...(refreshToken ? { refreshToken } : {}),
    expiresAt: Date.now() + expiresIn * 1000,
  };
  return memoryIdentitySession.accessToken;
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
    return null;
  }
}

export async function getIdentityToken(interactive = false): Promise<string> {
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

/** Clear Chrome's cached identity tokens and the extension's memory-only token. */
export async function clearIdentitySession(): Promise<void> {
  memoryIdentitySession = null;
  const identity = getChrome()?.identity;
  if (!identity) return;

  if (identity.clearAllCachedAuthTokens) {
    await identity.clearAllCachedAuthTokens();
  }
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
  rememberTokenResponse(tokenResponse);

  return {
    status: "completed",
    message:
      "Google authorized Gmail access. Subzero will now load recent mail.",
    redirectUrl: returnedUrl,
  };
}

/**
 * Authenticate the extension directly with Gmail. Chrome's cached identity
 * flow is preferred; PKCE is the browser-signin-independent fallback.
 */
export async function startIdentityOAuth(
  authorizationUrl?: string,
): Promise<OAuthBoundaryResult> {
  const redirectUrl = getIdentityRedirectUrl() ?? undefined;
  const identity = getChrome()?.identity;

  if (!authorizationUrl) {
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

  let parsed: URL;
  try {
    parsed = new URL(authorizationUrl);
  } catch {
    return {
      status: "invalid_url",
      message: "The OAuth URL was not valid.",
    };
  }

  if (parsed.origin !== GOOGLE_AUTH_ORIGIN) {
    return {
      status: "invalid_url",
      message: "Only a Google authorization URL is accepted by this boundary.",
    };
  }

  if (!identity?.launchWebAuthFlow) {
    return {
      status: "unavailable",
      message: "Chrome identity is unavailable in this profile.",
    };
  }

  try {
    const returnedUrl = await identity.launchWebAuthFlow({
      url: parsed.toString(),
      interactive: true,
    });
    return {
      status: "completed",
      message:
        "Chrome returned from the OAuth boundary. Token exchange and Gmail sync are still manual.",
      redirectUrl: returnedUrl,
    };
  } catch (error) {
    return {
      status: "cancelled",
      message: `OAuth was cancelled or rejected by Chrome. ${errorMessage(error)}`,
    };
  }
}
