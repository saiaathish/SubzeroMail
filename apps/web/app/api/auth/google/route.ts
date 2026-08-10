import { NextResponse } from "next/server";

import {
  buildGoogleAuthorizationUrl,
  createGoogleOAuthClient,
  createOAuthState,
  getGoogleOAuthConfig,
  OAuthConfigurationError,
  setOAuthStateCookie,
} from "./oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Start one-account Google OAuth. No token is created or logged here. */
export function GET(): NextResponse {
  try {
    const config = getGoogleOAuthConfig();
    const state = createOAuthState();
    const authorizationUrl = buildGoogleAuthorizationUrl(
      createGoogleOAuthClient(config),
      state,
    );
    const response = NextResponse.redirect(authorizationUrl, 302);

    return setOAuthStateCookie(response, state);
  } catch (error) {
    if (error instanceof OAuthConfigurationError) {
      return NextResponse.json(
        {
          error: "oauth_not_configured",
          message:
            "Google OAuth is not configured. Add the required environment values.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json(
      { error: "oauth_start_failed", message: "Unable to start Google OAuth." },
      { status: 500 },
    );
  }
}
