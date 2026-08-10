import z from "zod";

/**
 * AI outputs are untrusted. These schemas form the boundary between a model
 * response and mailbox UI/state.
 */
export const ThreadBucketSchema = z.enum([
  "priority",
  "needs_reply",
  "waiting",
  "other",
]);

export const ConfidenceSchema = z.number().finite().min(0).max(1);
export const SourceMessageIdSchema = z.string().trim().min(1);
export const SourceMessageIdsSchema = z.array(SourceMessageIdSchema).min(1);

export const ThreadTriageSchema = z
  .object({
    bucket: ThreadBucketSchema,
    confidence: ConfidenceSchema,
    reasons: z.array(z.string().trim().min(1).max(240)).max(3),
    sourceMessageIds: SourceMessageIdsSchema,
  })
  .strict();

const countSentences = (value: string) => {
  const normalized = value.trim().replace(/\s+/g, " ");

  if (!normalized) {
    return 0;
  }

  return normalized
    .split(/[.!?]+(?:\s+|$)/)
    .map((sentence) => sentence.trim())
    .filter(Boolean).length;
};

export const ThreadSummarySchema = z
  .object({
    summary: z.string().trim().min(1).max(4_000),
    latestDelta: z.string().trim().min(1).max(2_000).nullable(),
    actionRequired: z.string().trim().min(1).max(2_000).nullable(),
    deadline: z.string().trim().min(1).max(200).nullable(),
    sourceMessageIds: SourceMessageIdsSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (countSentences(value.summary) > 3) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["summary"],
        message: "Thread summaries must contain no more than three sentences.",
      });
    }
  });

const notEnoughEvidence = (answer: string) =>
  /\bnot enough evidence\b/i.test(answer.trim());

export const InboxAnswerSchema = z
  .object({
    answer: z.string().trim().min(1).max(8_000),
    confidence: ConfidenceSchema,
    sourceMessageIds: z.array(SourceMessageIdSchema),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.sourceMessageIds.length > 0) {
      return;
    }

    if (!notEnoughEvidence(value.answer) || value.confidence !== 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["sourceMessageIds"],
        message:
          "Factual Inbox answers require source message IDs; no-evidence answers must say 'not enough evidence' with zero confidence.",
      });
    }
  });

export const OpenLoopDirectionSchema = z.enum(["i_owe", "they_owe", "waiting"]);

export const OpenLoopCandidateSchema = z
  .object({
    threadId: z.string().trim().min(1),
    sourceMessageId: SourceMessageIdSchema,
    direction: OpenLoopDirectionSchema,
    text: z.string().trim().min(1).max(2_000),
    dueAt: z.string().trim().min(1).max(200).nullable(),
    confidence: ConfidenceSchema,
  })
  .strict();

export const VoiceProfileSchema = z
  .object({
    formality: z.enum(["casual", "neutral", "formal"]),
    averageLength: z.enum(["short", "medium", "long"]),
    greetingPatterns: z.array(z.string().trim().min(1).max(200)).max(20),
    signoffPatterns: z.array(z.string().trim().min(1).max(200)).max(20),
    directness: z.number().finite().min(0).max(1),
    formattingNotes: z.array(z.string().trim().min(1).max(400)).max(20),
  })
  .strict();

export const MailQuerySchema = z.string().trim().min(1).max(500);

export const MailQueriesSchema = z
  .array(MailQuerySchema)
  .min(1)
  .max(3)
  .superRefine((queries, context) => {
    const unique = new Set(queries.map((query) => query.toLowerCase()));
    if (unique.size !== queries.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Generated mail queries must be unique.",
      });
    }
  });

export type ThreadBucket = z.infer<typeof ThreadBucketSchema>;
export type ThreadTriage = z.infer<typeof ThreadTriageSchema>;
export type ThreadSummary = z.infer<typeof ThreadSummarySchema>;
export type InboxAnswer = z.infer<typeof InboxAnswerSchema>;
export type OpenLoopCandidate = z.infer<typeof OpenLoopCandidateSchema>;
export type VoiceProfile = z.infer<typeof VoiceProfileSchema>;
export type MailQuery = z.infer<typeof MailQuerySchema>;

export const createNotEnoughEvidenceAnswer = (): InboxAnswer => ({
  answer: "Not enough evidence to answer this from the retrieved mail.",
  confidence: 0,
  sourceMessageIds: [],
});
