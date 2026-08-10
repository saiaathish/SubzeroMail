import type { ApiMailThreadLike } from "./runtime-types";
import type { FocusRule } from "./types";

/**
 * Apply inspectable user rules before the default deterministic Focus signals.
 * Rules are intentionally substring based: no hidden model call or regex
 * evaluation is needed to decide where a message belongs.
 */
export function matchFocusRule(
  thread: ApiMailThreadLike,
  rules: readonly FocusRule[],
): FocusRule | null {
  const values: Record<FocusRule["field"], string> = {
    from: thread.participants.map((person) => person.address).join(" "),
    to: thread.messages
      .flatMap((message) => message.to.map((recipient) => recipient.address))
      .join(" "),
    subject: thread.subject,
    body: [
      thread.preview,
      ...thread.messages.map((message) => message.body ?? message.snippet),
    ].join(" "),
    any: [
      thread.subject,
      thread.preview,
      thread.participants.map((person) => person.address).join(" "),
      ...thread.messages.flatMap((message) => [
        message.body ?? message.snippet,
        ...message.to.map((recipient) => recipient.address),
      ]),
    ].join(" "),
  };

  return (
    rules.find((rule) => {
      if (!rule.enabled) return false;
      const pattern = rule.pattern.trim().toLowerCase();
      return (
        Boolean(pattern) && values[rule.field].toLowerCase().includes(pattern)
      );
    }) ?? null
  );
}
