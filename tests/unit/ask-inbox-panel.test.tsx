import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

import { AskInboxPanel } from "@/features/ask-inbox/ask-inbox-panel";
import { demoThreads } from "@/lib/demo-data";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("P1.1 Ask Inbox panel", () => {
  it("renders a source-backed demo answer and opens the exact source thread", async () => {
    const onOpenSource = vi.fn();
    render(
      <AskInboxPanel
        demoMode
        threads={demoThreads()}
        onOpenSource={onOpenSource}
      />,
    );

    fireEvent.change(screen.getByLabelText("Ask Inbox question"), {
      target: { value: "What price did Alex finally agree to?" },
    });
    fireEvent.click(screen.getByTestId("ask-inbox-submit"));

    expect(await screen.findByTestId("ask-inbox-answer")).toHaveTextContent(
      "$4,800 works if onboarding is included.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Source: msg-alex-3" }));
    expect(onOpenSource).toHaveBeenCalledWith({
      messageId: "msg-alex-3",
      threadId: "thread-alex-pricing",
    });
  });

  it("shows the explicit no-evidence state instead of fabricating a source", async () => {
    render(
      <AskInboxPanel demoMode threads={demoThreads()} onOpenSource={vi.fn()} />,
    );

    fireEvent.change(screen.getByLabelText("Ask Inbox question"), {
      target: { value: "Where is the precursor isotope?" },
    });
    fireEvent.click(screen.getByTestId("ask-inbox-submit"));

    expect(await screen.findByTestId("ask-inbox-answer")).toHaveTextContent(
      "Not enough evidence to answer this from the retrieved mail.",
    );
    expect(
      screen.queryByRole("button", { name: /Source:/ }),
    ).not.toBeInTheDocument();
  });

  it("uses the bounded Ask Inbox API response and only renders its returned sources", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          ok: true,
          data: {
            answer: "Sarah said the revised design files will arrive tomorrow.",
            confidence: 0.88,
            sourceMessageIds: ["msg-sarah-4"],
            sources: [
              {
                messageId: "msg-sarah-4",
                threadId: "thread-sarah-design",
              },
            ],
            retrieval: {
              queryCount: 1,
              candidateThreadCount: 1,
              evidenceCount: 1,
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onOpenSource = vi.fn();
    render(
      <AskInboxPanel
        demoMode={false}
        threads={[]}
        onOpenSource={onOpenSource}
      />,
    );

    fireEvent.change(screen.getByLabelText("Ask Inbox question"), {
      target: { value: "When will Sarah send the revised design?" },
    });
    fireEvent.click(screen.getByTestId("ask-inbox-submit"));

    expect(await screen.findByTestId("ask-inbox-answer")).toHaveTextContent(
      "Sarah said the revised design files will arrive tomorrow.",
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/ai/ask-inbox",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          question: "When will Sarah send the revised design?",
        }),
      }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Source: msg-sarah-4" }),
    );
    expect(onOpenSource).toHaveBeenCalledWith({
      messageId: "msg-sarah-4",
      threadId: "thread-sarah-design",
    });
  });
});
