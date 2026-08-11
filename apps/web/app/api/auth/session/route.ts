import { google } from "googleapis";
import { NextResponse } from "next/server";

import { decryptSecret } from "@subzero/security";
import { createStorage } from "@subzero/storage";

import {
  createGoogleOAuthClient,
  getGoogleOAuthConfig,
  PRIMARY_GMAIL_ACCOUNT_ID,
  readCookie,
  SUBZERO_ACCOUNT_ID_COOKIE,
} from "../google/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type SessionProfile = {
  email: string;
  name: string;
  picture: string | null;
};

export async function GET(request: Request): Promise<NextResponse> {
  if (process.env.SUBZERO_DEMO_MODE === "true") {
    return NextResponse.json({
      authenticated: true,
      profile: {
        email: "you@example.com",
        name: "Subzero Demo",
        picture: null,
      } satisfies SessionProfile,
    });
  }

  const accountId = readCookie(request, SUBZERO_ACCOUNT_ID_COOKIE);
  if (accountId !== PRIMARY_GMAIL_ACCOUNT_ID) {
    return NextResponse.json({ authenticated: false, profile: null });
  }

  try {
    const storedAccount = await createStorage().accountById(accountId);
    if (!storedAccount) {
      return NextResponse.json({ authenticated: false, profile: null });
    }

    const client = createGoogleOAuthClient(getGoogleOAuthConfig());
    client.setCredentials({
      refresh_token: decryptSecret(storedAccount.encryptedRefreshToken),
    });

    try {
      const identity = await google
        .oauth2({ version: "v2", auth: client })
        .userinfo.get();

      const profile: SessionProfile = {
        email: identity.data.email ?? storedAccount.gmailAddress,
        name:
          identity.data.name?.trim() ||
          readableNameFromEmail(storedAccount.gmailAddress),
        picture: identity.data.picture ?? null,
      };

      return NextResponse.json({ authenticated: true, profile });
    } catch {
      // A temporary profile lookup failure must not destroy a valid local
      // remembered session. Gmail routes remain the authority for token health.
      return NextResponse.json({
        authenticated: true,
        profile: {
          email: storedAccount.gmailAddress,
          name: readableNameFromEmail(storedAccount.gmailAddress),
          picture: null,
        } satisfies SessionProfile,
      });
    }
  } catch {
    return NextResponse.json({ authenticated: false, profile: null });
  }
}

function readableNameFromEmail(email: string): string {
  const localPart = email.split("@")[0] ?? email;
  const words = localPart
    .split(/[._+-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1));
  return words.join(" ") || "Google user";
}
