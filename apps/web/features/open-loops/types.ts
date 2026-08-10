export type OpenLoopDirection = "i_owe" | "they_owe" | "waiting";
export type OpenLoopStatus = "open" | "resolved";

/** Derived follow-up state. Gmail remains canonical for the linked thread. */
export type OpenLoop = {
  id: string;
  threadId: string;
  sourceMessageId: string | null;
  direction: OpenLoopDirection;
  text: string;
  dueAt: string | null;
  confidence: number;
  status: OpenLoopStatus;
  createdAt: string;
  resolvedAt: string | null;
  /** Low-confidence extraction remains a user-reviewed suggestion. */
  suggestion: boolean;
};

export const openLoopDirectionLabel: Record<OpenLoopDirection, string> = {
  i_owe: "I owe",
  they_owe: "They owe",
  waiting: "Waiting",
};
