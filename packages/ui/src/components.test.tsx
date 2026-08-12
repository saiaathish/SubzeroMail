import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { describe, expect, it, vi } from "vitest";
import {
  CommandPalette,
  FocusTabs,
  ThemeToggle,
  ThreadRow,
} from "./components";

describe("FocusTabs", () => {
  it("moves through enabled tabs with arrow keys and exposes selection", () => {
    const onValueChange = vi.fn();
    render(
      <FocusTabs
        items={[
          { id: "inbox", label: "Inbox" },
          { id: "priority", label: "Priority", disabled: true },
          { id: "waiting", label: "Waiting" },
        ]}
        value="inbox"
        onValueChange={onValueChange}
      />,
    );

    const tabs = screen.getAllByRole("tab");
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    expect(tabs[1]).toBeDisabled();

    tabs[0]?.focus();
    fireEvent.keyDown(tabs[0]!, { key: "ArrowRight" });

    expect(onValueChange).toHaveBeenCalledWith("waiting");
    expect(tabs[2]).toHaveFocus();
  });
});

describe("CommandPalette", () => {
  it("focuses on open, runs the active command, and restores the opener", () => {
    const opener = document.createElement("button");
    opener.type = "button";
    opener.textContent = "Open commands";
    document.body.append(opener);
    opener.focus();

    const onCommand = vi.fn();
    const onOpenChange = vi.fn();
    const view = render(
      <CommandPalette
        open
        commands={[
          { id: "reply", label: "Reply", shortcut: "R" },
          { id: "archive", label: "Archive", shortcut: "E" },
        ]}
        onCommand={onCommand}
        onOpenChange={onOpenChange}
      />,
    );

    const input = screen.getByRole("combobox");
    expect(input).toHaveFocus();

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onCommand).toHaveBeenCalledWith(
      expect.objectContaining({ id: "archive" }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);

    view.rerender(
      <CommandPalette
        open={false}
        commands={[]}
        onCommand={onCommand}
        onOpenChange={onOpenChange}
      />,
    );
    expect(opener).toHaveFocus();
    opener.remove();
  });
});

describe("ThreadRow and ThemeToggle", () => {
  it("keeps thread selection in one accessible button and toggles the next theme", () => {
    const onSelect = vi.fn();
    const onThemeChange = vi.fn();

    render(
      <>
        <ThreadRow
          thread={{
            id: "thread-1",
            sender: "Maya Chen",
            subject: "Contract notes",
            preview: "Two decisions are ready.",
            unread: true,
          }}
          onSelect={onSelect}
        />
        <ThemeToggle theme="dark" onThemeChange={onThemeChange} />
      </>,
    );

    const row = screen.getByRole("button", {
      name: /Unread\. Maya Chen\. Contract notes/,
    });
    fireEvent.click(row);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({ id: "thread-1" }),
    );

    const themeToggle = screen.getByRole("button", {
      name: "Switch to light theme",
    });
    expect(themeToggle).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(themeToggle);
    expect(onThemeChange).toHaveBeenCalledWith("light");
  });
});
