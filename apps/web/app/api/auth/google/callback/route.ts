import { NextResponse } from "next/server";

import {
  appRedirectUrl,
  clearOAuthStateCookie,
  getGoogleOAuthConfig,
  isValidOAuthState,
  OAuthConfigurationError,
  PRIMARY_GMAIL_ACCOUNT_ID,
  persistGoogleOAuthCallback,
  readCookie,
  GOOGLE_OAUTH_STATE_COOKIE,
  setSubzeroAccountCookie,
} from "../oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Complete Google OAuth, encrypt the refresh token, and persist one identity. */
export async function GET(request: Request): Promise<NextResponse> {
  const requestUrl = new URL(request.url);
  const state = requestUrl.searchParams.get("state");
  const expectedState = readCookie(request, GOOGLE_OAUTH_STATE_COOKIE);

  if (!isValidOAuthState(expectedState, state)) {
    return callbackFailure(request, "invalid_state");
  }

  const providerError = requestUrl.searchParams.get("error");
  if (providerError) {
    return callbackFailure(
      request,
      providerError === "access_denied" ? "reconnect" : "oauth_exchange_failed",
    );
  }

  const code = requestUrl.searchParams.get("code");
  if (!code) {
    return callbackFailure(request, "missing_code");
  }

  try {
    const failure = await persistGoogleOAuthCallback({
      code,
      config: getGoogleOAuthConfig(),
    });

    return failure
      ? callbackFailure(request, failure)
      : callbackSuccess(request);
  } catch (error) {
    return callbackFailure(
      request,
      error instanceof OAuthConfigurationError
        ? "oauth_not_configured"
        : "oauth_exchange_failed",
    );
  }
}

function callbackSuccess(request: Request): NextResponse {
  const response = NextResponse.redirect(
    appRedirectUrl(request, { auth: "connected" }),
    302,
  );
  return clearOAuthStateCookie(
    setSubzeroAccountCookie(response, PRIMARY_GMAIL_ACCOUNT_ID),
  );
}

function callbackFailure(request: Request, reason: string): NextResponse {
  const response = NextResponse.redirect(
    appRedirectUrl(request, { auth: "error", reason }),
    302,
  );
  return clearOAuthStateCookie(response);
}
