import { describe, expect, it } from "vitest";

import { matchFocusRule } from "@/features/focus-rules/matcher";

const thread = {
  subject: "Build status",
  preview: "The deployment passed.",
  participants: [{ address: "ci@github.com" }],
  messages: [
    {
      to: [{ address: "owner@example.com" }],
      snippet: "Production deployment passed.",
    },
  ],
};

describe("custom Focus rules", () => {
  it("matches enabled rules deterministically and preserves order", () => {
    expect(
      matchFocusRule(thread, [
        {
          id: "disabled",
          bucket: "priority",
          field: "from",
          pattern: "github",
          enabled: false,
        },
        {
          id: "other",
          bucket: "other",
          field: "any",
          pattern: "github",
          enabled: true,
        },
      ]),
    ).toMatchObject({ id: "other", bucket: "other" });
  });

  it("supports recipient, subject, and body fields", () => {
    expect(
      matchFocusRule(thread, [
        {
          id: "1",
          bucket: "priority",
          field: "to",
          pattern: "owner@",
          enabled: true,
        },
      ])?.id,
    ).toBe("1");
    expect(
      matchFocusRule(thread, [
        {
          id: "2",
          bucket: "priority",
          field: "subject",
          pattern: "status",
          enabled: true,
        },
      ])?.id,
    ).toBe("2");
    expect(
      matchFocusRule(thread, [
        {
          id: "3",
          bucket: "priority",
          field: "body",
          pattern: "production",
          enabled: true,
        },
      ])?.id,
    ).toBe("3");
  });
});
