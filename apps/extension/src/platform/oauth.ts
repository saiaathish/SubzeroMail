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
const GMAIL_MODIFY_SCOPE = "https://www.googleapis.com/auth/gmail.modify";

export async function getIdentityToken(interactive = false): Promise<string> {
  const identity = getChrome()?.identity;
  if (!identity?.getAuthToken) {
    throw new Error("Chrome identity token API is unavailable.");
  }

  const result = await identity.getAuthToken({
    interactive,
    scopes: [GMAIL_MODIFY_SCOPE],
  });
  const token = result?.token;
  if (!token) throw new Error("Chrome did not return a Gmail access token.");
  return token;
}

/** Clear Chrome's cached identity tokens without persisting a token in Subzero. */
export async function clearIdentitySession(): Promise<void> {
  const identity = getChrome()?.identity;
  if (!identity) return;

  if (identity.clearAllCachedAuthTokens) {
    await identity.clearAllCachedAuthTokens();
    return;
  }

  // Older Chrome implementations may not expose the bulk clear API. The
  // extension cannot recover a token non-interactively, so there is nothing
  // safe to remove through the fallback boundary.
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

/**
 * Boundary only. A future server-owned OAuth flow may provide a short-lived
 * Google authorization URL. This extension never stores a client secret or
 * exchanges a code for tokens.
 */
export async function startIdentityOAuth(
  authorizationUrl?: string,
): Promise<OAuthBoundaryResult> {
  const redirectUrl = getIdentityRedirectUrl() ?? undefined;
  const identity = getChrome()?.identity;

  if (!authorizationUrl && identity?.getAuthToken) {
    try {
      await getIdentityToken(true);
      return {
        status: "completed",
        message:
          "Google authorized Gmail access. Subzero will now load recent mail.",
        ...(redirectUrl ? { redirectUrl } : {}),
      };
    } catch {
      return {
        status: "cancelled",
        message:
          "Google authorization did not complete. No token was stored by Subzero.",
        ...(redirectUrl ? { redirectUrl } : {}),
      };
    }
  }

  if (!authorizationUrl) {
    return {
      status: "manual_required",
      message:
        "Manual OAuth setup required. Provide a server-generated Google authorization URL before connecting Gmail.",
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
      message: "Chrome identity is unavailable in this demo environment.",
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
  } catch {
    return {
      status: "cancelled",
      message: "OAuth was cancelled or rejected by Chrome.",
    };
  }
}
