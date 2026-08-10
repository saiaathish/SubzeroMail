import type { FocusBucket } from "@/lib/demo-data";

export type FocusRuleField = "from" | "to" | "subject" | "body" | "any";

export type FocusRule = {
  id: string;
  bucket: FocusBucket;
  field: FocusRuleField;
  pattern: string;
  enabled: boolean;
};

export const focusRuleFields: readonly FocusRuleField[] = [
  "from",
  "to",
  "subject",
  "body",
  "any",
];

export const focusRuleFieldLabel: Record<FocusRuleField, string> = {
  from: "Sender",
  to: "Recipient",
  subject: "Subject",
  body: "Message text",
  any: "Any field",
};

export const focusBucketLabel: Record<FocusBucket, string> = {
  priority: "Priority",
  needs_reply: "Needs Reply",
  waiting: "Waiting",
  other: "Other",
};
