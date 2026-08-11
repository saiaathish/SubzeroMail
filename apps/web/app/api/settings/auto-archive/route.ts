import { NextResponse } from "next/server";

import { createStorage } from "@subzero/storage";

import { requireMailRouteContext } from "../../mail/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: { message } }, { status });
}

async function trustedAccountId(request: Request): Promise<string | null> {
  try {
    return (await requireMailRouteContext(request)).account.id;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const id = await trustedAccountId(request);
  if (!id)
    return error("Connect Gmail before changing auto-archive settings.", 401);
  const settings = (await createStorage().settings(id)) as {
    autoArchive?: unknown;
  };
  return NextResponse.json({
    ok: true,
    data: { enabled: settings.autoArchive === true },
  });
}

export async function POST(request: Request) {
  const id = await trustedAccountId(request);
  if (!id)
    return error("Connect Gmail before changing auto-archive settings.", 401);

  let input: { enabled?: unknown };
  try {
    input = await request.json();
  } catch {
    return error("Invalid settings payload.", 400);
  }
  if (typeof input.enabled !== "boolean") {
    return error("enabled must be a boolean.", 400);
  }

  const storage = createStorage();
  const current = (await storage.settings(id)) as Record<string, unknown>;
  await storage.saveSettings(id, {
    ...(current && typeof current === "object" ? current : {}),
    autoArchive: input.enabled,
  });
  return NextResponse.json({ ok: true, data: { enabled: input.enabled } });
}
