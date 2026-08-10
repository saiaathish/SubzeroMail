import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { VoiceProfileSettings } from "@/features/settings/voice-profile-settings";

const profile = {
  formality: "neutral",
  averageLength: "medium",
  greetingPatterns: ["Hello"],
  signoffPatterns: ["Best,"],
  directness: 0.5,
  formattingNotes: ["Use brief paragraphs."],
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Voice Profile settings", () => {
  it("requires visible opt-in before creating a profile and presents the editable compact result", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({ ok: true, data: { configured: false, profile: null } }),
      )
      .mockResolvedValueOnce(json({ ok: true, data: { profile } }));
    vi.stubGlobal("fetch", fetchMock);

    render(<VoiceProfileSettings />);

    await screen.findByRole("heading", {
      name: "Teach drafts your writing style",
    });
    const create = screen.getByRole("button", { name: "Create Voice Profile" });
    expect(create).toBeDisabled();
    expect(
      screen.getByText(/Raw sampled messages are not stored in Subzero/i),
    ).toBeVisible();

    fireEvent.click(
      screen.getByLabelText(
        /I opt in to sample sent messages once for Voice Profile creation/i,
      ),
    );
    fireEvent.change(
      screen.getByLabelText("Number of sent messages to sample"),
      { target: { value: "30" } },
    );
    expect(create).toBeEnabled();
    fireEvent.click(create);

    await screen.findByRole("heading", { name: "Inspect and edit" });
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/settings/voice-profile",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          action: "create",
          optIn: true,
          sampleCount: 30,
        }),
      }),
    );
    expect(screen.getByLabelText("Formality")).toHaveValue("neutral");
  });

  it("saves edits and resets the profile without showing raw samples", async () => {
    const edited = { ...profile, directness: 0.7 };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        json({ ok: true, data: { configured: true, profile } }),
      )
      .mockResolvedValueOnce(json({ ok: true, data: { profile: edited } }))
      .mockResolvedValueOnce(
        json({
          ok: true,
          data: { configured: false, profile: null },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    render(<VoiceProfileSettings />);

    const directness = await screen.findByLabelText("Directness");
    fireEvent.change(directness, { target: { value: "0.7" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await screen.findByText("Voice Profile changes saved.");
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      "/api/settings/voice-profile",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ action: "save", optIn: true, profile: edited }),
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Reset profile" }));
    await screen.findByRole("heading", {
      name: "Teach drafts your writing style",
    });
    await waitFor(() =>
      expect(
        screen.getByText(/Future drafts will use no profile/i),
      ).toBeVisible(),
    );
  });
});
