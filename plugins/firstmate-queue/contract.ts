import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const queueSectionSchema = z.enum([
  "needs_response",
  "in_progress",
  "done",
]);
export const rowStateSchema = z.enum([
  "error",
  "queued_failed",
  "waiting",
  "running",
  "user_managed",
  "new_result",
  "awaiting_review",
  "needs_response",
  "done",
]);
export const dispositionSchema = z.enum(["needs_response", "done"]);

export const queueRowSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    section: queueSectionSchema,
    state: rowStateSchema,
    statusLabel: z.string(),
    detail: z.string(),
    summaryMarkdown: z.string().nullable(),
    userManaged: z.boolean(),
    latestCompletionSeq: z.number().int().nonnegative(),
    reviewedThroughSeq: z.number().int().nonnegative(),
  })
  .strict();

export type QueueRow = z.infer<typeof queueRowSchema>;
export type QueueSection = z.infer<typeof queueSectionSchema>;
export type IdleDisposition = z.infer<typeof dispositionSchema>;

const threadIdSchema = z.string().min(1).max(200);

const surfaceInput = z
  .object({
    surfaceThreadId: threadIdSchema,
  })
  .strict();

export const rpcContract = defineRpcContract({
  canOpen: {
    input: surfaceInput,
    output: z.object({ canOpen: z.boolean() }).strict(),
  },
  queueSnapshot: {
    input: surfaceInput,
    output: z
      .object({
        managerThreadId: z.string(),
        agentWritesEnabled: z.boolean(),
        rows: z.array(queueRowSchema),
      })
      .strict(),
  },
  setUserManaged: {
    input: surfaceInput
      .extend({
        childThreadId: threadIdSchema,
        userManaged: z.boolean(),
      })
      .strict(),
    output: z
      .object({
        childThreadId: z.string(),
        userManaged: z.boolean(),
      })
      .strict(),
  },
  archiveThread: {
    input: surfaceInput
      .extend({ childThreadId: threadIdSchema })
      .strict(),
    output: z.object({ archived: z.literal(true) }).strict(),
  },
});
