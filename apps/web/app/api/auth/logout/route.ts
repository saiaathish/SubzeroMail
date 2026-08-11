import { NextResponse } from "next/server";

import { SUBZERO_ACCOUNT_ID_COOKIE } from "../google/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(): Promise<NextResponse> {
  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: SUBZERO_ACCOUNT_ID_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
  return response;
}
