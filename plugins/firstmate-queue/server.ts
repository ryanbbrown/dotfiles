import { z } from "zod";
import type { BbPluginApi, PluginThreadEventName } from "@get-bb/plugin-sdk";
import {
  boundedErrorText,
  isMissingThreadError,
  STALE_MANAGER_MESSAGE,
} from "./backend-utils.js";
import { dispositionSchema, rpcContract } from "./contract.js";
import { QueueService, type QueueSettings } from "./queue-service.js";
import { AnnotationStore, INITIAL_SCHEMA_STATEMENTS } from "./store.js";

const SETUP_MESSAGE = "Set managerThreadId in the Firstmate Queue plugin settings.";

const managerThreadIdSchema = z
  .string()
  .min(1)
  .max(200)
  .refine((value) => value.trim().length > 0, "Manager thread ID is required");

const toolParameters = z
  .object({
    childThreadId: z.string().min(1).max(200),
    summaryMarkdown: z.string().max(8_000).refine(
      (value) => Array.from(value).length <= 4_000,
      "Summary must contain at most 4,000 Unicode characters",
    ),
    disposition: dispositionSchema,
  })
  .strict();

function managerInstructions(): string {
  return [
    "Firstmate Queue annotation writes are active.",
    "After you review a current direct child's result, call firstmate_queue_update with a concise Markdown summary and its idle disposition.",
    "Do not send unsolicited follow-ups to children marked as user-managed. Queue writes to those children return user_managed.",
  ].join("\n");
}

export default async function plugin(bb: BbPluginApi) {
  const settings = bb.settings.define({
    managerThreadId: {
      type: "string",
      label: "Manager thread ID",
      description: "The one Firstmate thread that owns this queue.",
      experimental_schema: managerThreadIdSchema,
    },
    agentWritesEnabled: {
      type: "boolean",
      label: "Enable Firstmate annotation writes",
      description:
        "Expose queue annotation tools and instructions to the configured manager.",
      default: false,
    },
  });
  // The SDK requires synchronous agent configuration, so keep this cache current through onChange.
  let currentSettings: QueueSettings = await settings.get();

  const database = bb.storage.database();
  const store = new AnnotationStore(database);
  bb.storage.migrate(database, INITIAL_SCHEMA_STATEMENTS);
  const service = new QueueService(bb, store, () => settings.get());

  if (!currentSettings.managerThreadId?.trim()) {
    bb.status.needsConfiguration(SETUP_MESSAGE);
  }

  async function inspectManager(next: QueueSettings): Promise<void> {
    const managerThreadId = next.managerThreadId?.trim();
    if (!managerThreadId) {
      bb.status.needsConfiguration(SETUP_MESSAGE);
      return;
    }
    try {
      const thread = await bb.sdk.threads.get({ threadId: managerThreadId });
      if (thread.archivedAt === null && thread.deletedAt === null) return;
    } catch (error) {
      bb.log.warn(
        `Configured manager ${managerThreadId} lookup failed: ${boundedErrorText(error)}`,
      );
      if (!isMissingThreadError(error)) return;
    }
    bb.log.warn(`${STALE_MANAGER_MESSAGE} Manager: ${managerThreadId}.`);
    bb.status.needsConfiguration(STALE_MANAGER_MESSAGE);
  }

  if (currentSettings.managerThreadId?.trim()) {
    await inspectManager(currentSettings);
  }
  settings.onChange((next) => {
    currentSettings = next;
    bb.realtime.publish("queue-invalidated", {
      threadId: next.managerThreadId ?? "",
      reason: "settings-changed",
    });
    void inspectManager(next);
  });

  bb.rpc.register(rpcContract, {
    canOpen: ({ surfaceThreadId }) => service.canOpen(surfaceThreadId),
    queueSnapshot: ({ surfaceThreadId }) => service.snapshot(surfaceThreadId),
    setUserManaged: (input) => service.setUserManaged(input),
    archiveThread: (input) => service.archiveThread(input),
    sendReply: (input) => service.sendReply(input),
  });

  bb.agents.registerTool({
    name: "firstmate_queue_update",
    description:
      "Store a reviewed summary and idle disposition for a current direct child of this Firstmate manager.",
    instructions:
      "Use only after reviewing the child's current result. Summary Markdown is limited to 4,000 Unicode characters. Calls accepted by the parameter schema return a JSON object with outcome updated, not_configured, writes_disabled, wrong_caller, manager_unavailable, child_lookup_failed, not_current_child, user_managed, or runtime_error. Malformed parameters fail tool validation before execution.",
    presentation: {
      label: {
        pending: "Updating Firstmate queue",
        completed: "Updated Firstmate queue",
      },
    },
    parameters: toolParameters,
    async execute(
      { childThreadId, summaryMarkdown, disposition },
      { threadId },
    ) {
      try {
        return await service.writeReview({
          callerThreadId: threadId,
          childThreadId,
          summaryMarkdown,
          disposition,
        });
      } catch {
        return JSON.stringify({ outcome: "runtime_error" });
      }
    },
  });

  bb.agents.configure((context) => {
    if (
      currentSettings.agentWritesEnabled !== true ||
      context.thread.id !== currentSettings.managerThreadId?.trim()
    ) {
      return { tools: [], skills: [] };
    }
    return {
      tools: ["firstmate_queue_update"],
      skills: [],
      instructions: managerInstructions(),
    };
  });

  async function publishIfCurrent(threadId: string, reason: string) {
    try {
      if (await service.isCurrentChildByLookup(threadId)) {
        service.publish(threadId, reason);
      }
    } catch {
      // Missing or stale configuration has no authorized queue to invalidate.
    }
  }

  async function publishOwningRow(
    threadId: string,
    parentThreadId: string | null,
    reason: string,
  ) {
    try {
      const owner = await service.findOwningRowForLifecycle(
        threadId,
        parentThreadId,
      );
      if (owner !== null) service.publish(owner, reason);
    } catch {
      // Missing or stale configuration has no authorized queue to invalidate.
    }
  }

  function configuredManagerId(): string | undefined {
    return currentSettings.managerThreadId?.trim() || undefined;
  }

  bb.background.service("terminal-change-listener", {
    async start(signal) {
      const unsubscribe = bb.sdk.subscribe({
        event: "thread:changed",
        callback: (event) => {
          if (
            event.id !== undefined &&
            event.changes.includes("terminals-changed")
          ) {
            void publishIfCurrent(event.id, "terminals-changed");
          }
        },
      });
      try {
        await new Promise<void>((resolve) => {
          if (signal.aborted) {
            resolve();
          } else {
            signal.addEventListener("abort", () => resolve(), { once: true });
          }
        });
      } finally {
        unsubscribe();
      }
    },
  });

  function registerThreadEvent(
    event: Extract<
      PluginThreadEventName,
      | "thread.created"
      | "thread.active"
      | "thread.idle"
      | "thread.failed"
      | "thread.archived"
      | "thread.deleted"
    >,
  ): void {
    bb.events.on(event, async ({ thread }) => {
      const managerThreadId = configuredManagerId();
      if (
        thread.id === managerThreadId &&
        (thread.archivedAt !== null || thread.deletedAt !== null)
      ) {
        const message = `Configured manager ${thread.id} is archived or deleted.`;
        bb.log.warn(message);
        bb.status.needsConfiguration(message);
      }
      await publishOwningRow(thread.id, thread.parentThreadId, event);
    });
  }

  registerThreadEvent("thread.created");
  registerThreadEvent("thread.active");
  registerThreadEvent("thread.idle");
  registerThreadEvent("thread.failed");
  registerThreadEvent("thread.archived");
  registerThreadEvent("thread.deleted");
  bb.events.on("message.queued", ({ entry }) =>
    publishIfCurrent(entry.threadId, "message.queued"),
  );
  bb.events.on("message.dispatched", ({ entry }) =>
    publishIfCurrent(entry.threadId, "message.dispatched"),
  );
  bb.events.on("turn.failed", ({ threadId }) =>
    publishIfCurrent(threadId, "turn.failed"),
  );
}
