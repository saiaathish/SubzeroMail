import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";

import { createStorage } from "@subzero/storage";
import { requireMailRouteContext } from "../../mail/runtime";
import {
  focusRuleFields,
  type FocusRule,
  type FocusRuleField,
} from "@/features/focus-rules/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const buckets = ["priority", "needs_reply", "waiting", "other"] as const;

function error(message: string, status: number) {
  return NextResponse.json({ ok: false, error: { message } }, { status });
}

function isBucket(value: unknown): value is FocusRule["bucket"] {
  return (
    typeof value === "string" &&
    buckets.includes(value as (typeof buckets)[number])
  );
}

function isField(value: unknown): value is FocusRuleField {
  return (
    typeof value === "string" &&
    focusRuleFields.includes(value as FocusRuleField)
  );
}

function parseRule(value: unknown, existingId?: string): FocusRule {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Each Focus rule must be an object.");
  }
  const input = value as Record<string, unknown>;
  if (!isBucket(input.bucket)) throw new Error("Focus rule bucket is invalid.");
  if (!isField(input.field)) throw new Error("Focus rule field is invalid.");
  if (typeof input.pattern !== "string" || !input.pattern.trim()) {
    throw new Error("Focus rule pattern is required.");
  }
  if (input.pattern.trim().length > 200) {
    throw new Error("Focus rule pattern must be 200 characters or fewer.");
  }
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") {
    throw new Error("Focus rule enabled must be a boolean.");
  }
  return {
    id:
      typeof input.id === "string" && input.id.trim()
        ? input.id
        : (existingId ?? randomUUID()),
    bucket: input.bucket,
    field: input.field,
    pattern: input.pattern.trim(),
    enabled: input.enabled ?? true,
  };
}

async function accountAndSettings(request: Request) {
  const { account } = await requireMailRouteContext(request);
  const storage = createStorage();
  const settings = (await storage.settings(account.id)) as Record<
    string,
    unknown
  >;
  const rules = Array.isArray(settings.focusRules) ? settings.focusRules : [];
  return { account, storage, settings, rules: rules as FocusRule[] };
}

export async function GET(request: Request) {
  try {
    const { rules } = await accountAndSettings(request);
    return NextResponse.json({ ok: true, data: { rules } });
  } catch {
    return error("Connect Gmail before configuring Focus rules.", 401);
  }
}

export async function PUT(request: Request) {
  try {
    const { account, storage, settings } = await accountAndSettings(request);
    const body: unknown = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return error("Request body must be an object.", 400);
    }
    const rawRules = (body as Record<string, unknown>).rules;
    if (!Array.isArray(rawRules) || rawRules.length > 50) {
      return error("rules must be an array of at most 50 items.", 400);
    }
    const rules = rawRules.map((rule) => parseRule(rule));
    const uniquePatterns = new Set<string>();
    for (const rule of rules) {
      const key = `${rule.bucket}|${rule.field}|${rule.pattern.toLowerCase()}`;
      if (uniquePatterns.has(key))
        return error("Duplicate Focus rules are not allowed.", 400);
      uniquePatterns.add(key);
    }
    await storage.saveSettings(account.id, { ...settings, focusRules: rules });
    return NextResponse.json({ ok: true, data: { rules } });
  } catch (cause) {
    return error(
      cause instanceof Error ? cause.message : "Could not save Focus rules.",
      400,
    );
  }
}
