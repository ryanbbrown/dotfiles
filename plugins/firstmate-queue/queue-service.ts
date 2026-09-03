import type { BbPluginApi } from "@get-bb/plugin-sdk";
import {
  boundedErrorText,
  isMissingThreadError,
  STALE_MANAGER_MESSAGE,
} from "./backend-utils.js";
import type { IdleDisposition, QueueRow } from "./contract.js";
import { projectQueue, type ThreadFacts } from "./projection.js";
import type { AnnotationStore } from "./store.js";

type ThreadListEntry = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["list"]>
>[number];
type ThreadResponse = Awaited<ReturnType<BbPluginApi["sdk"]["threads"]["get"]>>;

const LOOKUP_CONCURRENCY = 8;
const PAGE_SIZE = 100;

type ReviewOutcome =
  | "updated"
  | "not_configured"
  | "writes_disabled"
  | "wrong_caller"
  | "manager_unavailable"
  | "child_lookup_failed"
  | "not_current_child"
  | "user_managed"
  | "runtime_error";

function reviewResult(
  outcome: ReviewOutcome,
  details: Record<string, string | number> = {},
): string {
  return JSON.stringify({ outcome, ...details });
}

export interface QueueSettings {
  managerThreadId: string | undefined;
  agentWritesEnabled: boolean;
}

export interface QueueSnapshot {
  managerThreadId: string;
  agentWritesEnabled: boolean;
  rows: QueueRow[];
}

function requiredManager(settings: QueueSettings): string {
  const managerThreadId = settings.managerThreadId?.trim();
  if (!managerThreadId) {
    throw new Error("Firstmate Queue is not configured. Set managerThreadId.");
  }
  return managerThreadId;
}

export class QueueService {
  constructor(
    private readonly bb: BbPluginApi,
    private readonly store: AnnotationStore,
    private readonly readSettings: () => Promise<QueueSettings>,
  ) {}

  async listCurrentChildren(managerThreadId: string): Promise<ThreadListEntry[]> {
    const children = new Map<string, ThreadListEntry>();
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const page = await this.bb.sdk.threads.list({
        parentThreadId: managerThreadId,
        archived: false,
        includeHidden: true,
        limit: PAGE_SIZE,
        offset,
      });
      for (const thread of page) {
        if (
          thread.parentThreadId === managerThreadId &&
          thread.archivedAt === null &&
          thread.deletedAt === null
        ) {
          children.set(thread.id, thread);
        }
      }
      if (page.length < PAGE_SIZE) break;
    }
    return [...children.values()];
  }

  async latestCompletionSeq(threadId: string): Promise<number> {
    const events = await this.bb.sdk.threads.events.list({
      threadId,
      types: ["turn/completed"],
      order: "desc",
      limit: "1",
    });
    return events[0]?.seq ?? 0;
  }

  async canOpen(surfaceThreadId: string): Promise<{ canOpen: boolean }> {
    const managerThreadId = (await this.readSettings()).managerThreadId?.trim();
    if (!managerThreadId || surfaceThreadId.trim() !== managerThreadId) {
      return { canOpen: false };
    }
    await this.requireLiveManager(managerThreadId);
    return { canOpen: true };
  }

  async snapshot(surfaceThreadId: string): Promise<QueueSnapshot> {
    const settings = await this.readSettings();
    const managerThreadId = requiredManager(settings);
    this.assertSurface(surfaceThreadId, managerThreadId);
    await this.requireLiveManager(managerThreadId);
    const children = await this.listCurrentChildren(managerThreadId);
    const runtimeFacts = await this.childRuntimeFacts(children);
    const activeDescendantChildIds = await this.activeDescendantChildren(
      managerThreadId,
      children,
    );
    const facts: ThreadFacts[] = children.map((thread, index) => ({
      id: thread.id,
      title: thread.title ?? thread.titleFallback ?? "Untitled thread",
      status: thread.status,
      queuedWork: thread.queuedWork,
      archivedAt: thread.archivedAt,
      deletedAt: thread.deletedAt,
      latestCompletionSeq: runtimeFacts[index]?.latestCompletionSeq ?? 0,
      hasActiveNativeTerminal:
        runtimeFacts[index]?.hasActiveNativeTerminal ?? false,
      hasActiveDescendant: activeDescendantChildIds.has(thread.id),
      updatedAt: thread.updatedAt,
    }));
    return {
      managerThreadId,
      agentWritesEnabled: settings.agentWritesEnabled,
      rows: projectQueue(
        facts,
        this.store.list(children.map((thread) => thread.id)),
      ),
    };
  }

  async setUserManaged(input: {
    surfaceThreadId: string;
    childThreadId: string;
    userManaged: boolean;
  }): Promise<{ childThreadId: string; userManaged: boolean }> {
    const managerThreadId = await this.authorizedManager(input.surfaceThreadId);
    await this.requireCurrentChild(managerThreadId, input.childThreadId);
    const annotation = this.store.setUserManaged(
      input.childThreadId,
      input.userManaged,
    );
    this.publish(input.childThreadId, "mode-changed");
    return {
      childThreadId: input.childThreadId,
      userManaged: annotation.userManaged,
    };
  }

  async archiveThread(input: {
    surfaceThreadId: string;
    childThreadId: string;
  }): Promise<{ archived: true }> {
    const managerThreadId = await this.authorizedManager(input.surfaceThreadId);
    await this.requireCurrentChild(managerThreadId, input.childThreadId);
    await this.bb.sdk.threads.archive({ threadId: input.childThreadId });
    return { archived: true };
  }

  async sendReply(input: {
    surfaceThreadId: string;
    childThreadId: string;
    text: string;
  }): Promise<{ accepted: true }> {
    const managerThreadId = await this.authorizedManager(input.surfaceThreadId);
    await this.requireCurrentChild(managerThreadId, input.childThreadId);
    await this.bb.sdk.threads.send({
      threadId: input.childThreadId,
      mode: "auto",
      input: [{ type: "text", text: input.text, mentions: [] }],
    });
    this.publish(input.childThreadId, "reply-sent");
    return { accepted: true };
  }

  async writeReview(input: {
    callerThreadId: string;
    childThreadId: string;
    summaryMarkdown: string;
    disposition: IdleDisposition;
  }): Promise<string> {
    const settings = await this.readSettings();
    const managerThreadId = settings.managerThreadId?.trim();
    if (!managerThreadId) return reviewResult("not_configured");
    if (!settings.agentWritesEnabled) return reviewResult("writes_disabled");
    if (input.callerThreadId !== managerThreadId) {
      return reviewResult("wrong_caller");
    }
    try {
      await this.requireLiveManager(managerThreadId);
    } catch {
      return reviewResult("manager_unavailable");
    }
    let child: ThreadResponse | null;
    try {
      child = await this.findCurrentChild(managerThreadId, input.childThreadId);
    } catch {
      return reviewResult("child_lookup_failed");
    }
    if (child === null) return reviewResult("not_current_child");
    let reviewedThroughSeq: number;
    try {
      reviewedThroughSeq = await this.latestCompletionSeq(input.childThreadId);
    } catch {
      return reviewResult("runtime_error");
    }
    const previous = this.store.get(input.childThreadId);
    const write = this.store.writeReview(
      input.childThreadId,
      input.summaryMarkdown,
      input.disposition,
      reviewedThroughSeq,
    );
    if (write.outcome === "user_managed") {
      return reviewResult("user_managed");
    }

    let stillCurrent: ThreadResponse | null;
    try {
      stillCurrent = await this.findCurrentChild(
        managerThreadId,
        input.childThreadId,
      );
    } catch {
      this.store.restoreReviewIfUnchanged(
        input.childThreadId,
        write.annotation,
        previous,
      );
      return reviewResult("child_lookup_failed");
    }
    if (stillCurrent === null) {
      this.store.restoreReviewIfUnchanged(
        input.childThreadId,
        write.annotation,
        previous,
      );
      return reviewResult("not_current_child");
    }
    this.publish(input.childThreadId, "annotation-changed");
    return reviewResult("updated", {
      childThreadId: input.childThreadId,
      reviewedThroughSeq,
      disposition: input.disposition,
    });
  }

  async isCurrentChildByLookup(threadId: string): Promise<boolean> {
    const managerThreadId = requiredManager(await this.readSettings());
    try {
      return (await this.findCurrentChild(managerThreadId, threadId)) !== null;
    } catch {
      return false;
    }
  }

  async findOwningRowForLifecycle(
    threadId: string,
    parentThreadId: string | null,
  ): Promise<string | null> {
    const managerThreadId = requiredManager(await this.readSettings());
    if (parentThreadId === managerThreadId) return threadId;
    if (parentThreadId === null) return null;
    return this.walkToCurrentChild(
      parentThreadId,
      managerThreadId,
      null,
      (ancestorId) => this.getThreadIfPresent(ancestorId),
    );
  }

  publish(threadId: string, reason: string): void {
    this.bb.realtime.publish("queue-invalidated", { threadId, reason });
  }

  private async authorizedManager(surfaceThreadId: string): Promise<string> {
    const managerThreadId = requiredManager(await this.readSettings());
    this.assertSurface(surfaceThreadId, managerThreadId);
    await this.requireLiveManager(managerThreadId);
    return managerThreadId;
  }

  private async requireLiveManager(managerThreadId: string): Promise<void> {
    try {
      const manager = await this.bb.sdk.threads.get({ threadId: managerThreadId });
      if (manager.archivedAt === null && manager.deletedAt === null) return;
    } catch (error) {
      this.bb.log.warn(
        `Configured manager ${managerThreadId} lookup failed: ${boundedErrorText(error)}`,
      );
      if (!isMissingThreadError(error)) {
        throw new Error("Could not verify the configured Firstmate manager.");
      }
    }
    this.bb.log.warn(`${STALE_MANAGER_MESSAGE} Manager: ${managerThreadId}.`);
    this.bb.status.needsConfiguration(STALE_MANAGER_MESSAGE);
    throw new Error(STALE_MANAGER_MESSAGE);
  }

  private async childRuntimeFacts(
    children: readonly ThreadListEntry[],
  ): Promise<
    Array<{
      latestCompletionSeq: number;
      hasActiveNativeTerminal: boolean;
    }>
  > {
    const results = new Array<{
      latestCompletionSeq: number;
      hasActiveNativeTerminal: boolean;
    }>(children.length);
    let nextIndex = 0;
    const worker = async () => {
      for (;;) {
        const index = nextIndex;
        nextIndex += 1;
        const child = children[index];
        if (child === undefined) return;
        const latestCompletionSeq = await this.latestCompletionSeq(child.id);
        const terminalList = await this.bb.sdk.terminals.list({
          scope: { kind: "thread", threadId: child.id },
        });
        results[index] = {
          latestCompletionSeq,
          hasActiveNativeTerminal: terminalList.sessions.some(
            (session) =>
              session.threadId === child.id &&
              (session.status === "starting" || session.status === "running"),
          ),
        };
      }
    };
    const workerCount = Math.min(LOOKUP_CONCURRENCY, children.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
    return results;
  }

  private async activeDescendantChildren(
    managerThreadId: string,
    children: readonly ThreadListEntry[],
  ): Promise<Set<string>> {
    if (children.length === 0) return new Set();
    const directChildIds = new Set(children.map((child) => child.id));
    const runningThreadIds = [
      ...new Set(
        (await this.bb.sdk.threads.listRunning()).map((thread) => thread.id),
      ),
    ].filter((threadId) => !directChildIds.has(threadId));
    const ancestry = new Map<string, Promise<ThreadResponse | null>>();
    const lookup = (threadId: string): Promise<ThreadResponse | null> => {
      const cached = ancestry.get(threadId);
      if (cached !== undefined) return cached;
      const pending = this.getThreadIfPresent(threadId);
      ancestry.set(threadId, pending);
      return pending;
    };
    const owners = new Set<string>();
    let nextIndex = 0;
    const worker = async () => {
      for (;;) {
        const threadId = runningThreadIds[nextIndex];
        nextIndex += 1;
        if (threadId === undefined) return;
        const owner = await this.walkToCurrentChild(
          threadId,
          managerThreadId,
          directChildIds,
          lookup,
        );
        if (owner !== null) owners.add(owner);
      }
    };
    const workerCount = Math.min(LOOKUP_CONCURRENCY, runningThreadIds.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
    return owners;
  }

  private async walkToCurrentChild(
    startThreadId: string,
    managerThreadId: string,
    directChildIds: ReadonlySet<string> | null,
    lookup: (threadId: string) => Promise<ThreadResponse | null>,
  ): Promise<string | null> {
    const visited = new Set<string>();
    let threadId = startThreadId;
    for (;;) {
      if (threadId === managerThreadId) return null;
      if (directChildIds?.has(threadId)) return threadId;
      if (visited.has(threadId)) return null;
      visited.add(threadId);
      const thread = await lookup(threadId);
      if (thread === null) return null;
      if (thread.parentThreadId === managerThreadId) {
        return thread.archivedAt === null && thread.deletedAt === null
          ? thread.id
          : null;
      }
      if (thread.parentThreadId === null) return null;
      threadId = thread.parentThreadId;
    }
  }

  private async getThreadIfPresent(
    threadId: string,
  ): Promise<ThreadResponse | null> {
    try {
      return await this.bb.sdk.threads.get({ threadId });
    } catch (error) {
      if (isMissingThreadError(error)) return null;
      throw error;
    }
  }

  private assertSurface(surfaceThreadId: string, managerThreadId: string): void {
    if (surfaceThreadId.trim() !== managerThreadId) {
      throw new Error("Firstmate Queue is only available on its configured manager thread.");
    }
  }

  private async findCurrentChild(
    managerThreadId: string,
    childThreadId: string,
  ): Promise<ThreadResponse | null> {
    let child: ThreadResponse;
    try {
      child = await this.bb.sdk.threads.get({ threadId: childThreadId });
    } catch (error) {
      if (isMissingThreadError(error)) return null;
      throw error;
    }
    return child.parentThreadId === managerThreadId &&
      child.archivedAt === null &&
      child.deletedAt === null
      ? child
      : null;
  }

  private async requireCurrentChild(
    managerThreadId: string,
    childThreadId: string,
  ): Promise<ThreadResponse> {
    const child = await this.findCurrentChild(managerThreadId, childThreadId);
    if (child === null) {
      throw new Error("The target is not a current direct child of this manager.");
    }
    return child;
  }
}
