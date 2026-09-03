import { describe, expect, it, vi } from "vitest";
import type {
  BbPluginApi,
  PluginAgentConfigurationContext,
} from "@get-bb/plugin-sdk";
import {
  createFakePluginHost,
  makeQueueEntry,
  makeThreadResponse,
  makeTurnFailedEvent,
} from "@get-bb/plugin-sdk/testing";
import plugin from "./server.js";

type ThreadListEntry = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["list"]>
>[number];
type ThreadEventRow = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["events"]["list"]>
>[number];
type TerminalSession = Awaited<
  ReturnType<BbPluginApi["sdk"]["terminals"]["list"]>
>["sessions"][number];
type RunningThread = Awaited<
  ReturnType<BbPluginApi["sdk"]["threads"]["listRunning"]>
>[number];
type SdkSubscription = Parameters<BbPluginApi["sdk"]["subscribe"]>[0];
type ThreadChangedSubscription = Extract<
  SdkSubscription,
  { event: "thread:changed" }
>;

function isThreadChangedSubscription(
  subscription: SdkSubscription,
): subscription is ThreadChangedSubscription {
  return subscription.event === "thread:changed";
}

function listEntry(
  id: string,
  overrides: Partial<ThreadListEntry> = {},
): ThreadListEntry {
  const response = makeThreadResponse({
    id,
    title: `Title ${id}`,
    parentThreadId: "manager-1",
  });
  const {
    activeBackgroundAgentCount: _activeBackgroundAgentCount,
    canSpawnChild: _canSpawnChild,
    queuedMessageCount: _queuedMessageCount,
    ...thread
  } = response;
  return {
    ...thread,
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    queuedWork: "none",
    pinSortKey: null,
    hasPendingInteraction: false,
    environmentHostId: null,
    environmentName: null,
    environmentBranchName: null,
    environmentWorkspaceDisplayKind: "other",
    ...overrides,
  };
}

function completion(threadId: string, seq: number): ThreadEventRow {
  return {
    id: `event-${seq}`,
    scope: { kind: "turn", turnId: `turn-${seq}` },
    threadId,
    seq,
    type: "turn/completed",
    data: {
      providerThreadId: "provider-thread",
      status: "completed",
    },
    createdAt: seq,
  };
}

function runningThread(id: string): RunningThread {
  return { id, hostId: "host-1" };
}

function terminalSession(
  id: string,
  threadId: string,
  status: TerminalSession["status"],
): TerminalSession {
  return {
    id,
    title: `Terminal ${id}`,
    threadId,
    environmentId: null,
    hostId: "host-1",
    initialCwd: "/work",
    status,
    exitCode: status === "exited" ? 0 : null,
    closeReason: status === "exited" ? "process-exit" : null,
    rows: 24,
    cols: 80,
    createdAt: 100,
    updatedAt: 200,
    lastUserInputAt: null,
  };
}

function terminalChanges(): {
  emit(threadId: string): void;
  subscribe: BbPluginApi["sdk"]["subscribe"];
} {
  let callback: ThreadChangedSubscription["callback"] | null = null;
  return {
    emit(threadId) {
      callback?.({
        type: "changed",
        entity: "thread",
        id: threadId,
        changes: ["terminals-changed"],
      });
    },
    subscribe(subscription) {
      if (isThreadChangedSubscription(subscription)) {
        callback = subscription.callback;
      }
      return () => {
        if (isThreadChangedSubscription(subscription)) callback = null;
      };
    },
  };
}

function toolResult(output: unknown): Record<string, unknown> {
  return JSON.parse(String(output)) as Record<string, unknown>;
}

function agentContext(threadId: string): PluginAgentConfigurationContext {
  return {
    thread: {
      id: threadId,
      title: "Manager",
      parentThreadId: null,
      sourceThreadId: null,
    },
    project: {
      id: "project-1",
      kind: "standard",
      name: "Project",
      gitRemoteUrl: null,
    },
    environment: {
      id: "environment-1",
      name: "Environment",
      path: "/work",
      workspaceProvisionType: "unmanaged",
      branchName: "main",
    },
    host: { id: "host-1", name: "Host" },
    provider: {
      id: "pi",
      model: "test-model",
      capabilities: { supportsNativeUserQuestion: false },
    },
    origin: { kind: null, pluginId: null },
  };
}

async function configuredHost(options: {
  writes?: boolean;
  managerThreadId?: string;
  get?: BbPluginApi["sdk"]["threads"]["get"];
  list?: (args: Parameters<BbPluginApi["sdk"]["threads"]["list"]>[0]) => Promise<ThreadListEntry[]>;
  running?: BbPluginApi["sdk"]["threads"]["listRunning"];
  send?: BbPluginApi["sdk"]["threads"]["send"];
  events?: (args: Parameters<BbPluginApi["sdk"]["threads"]["events"]["list"]>[0]) => Promise<ThreadEventRow[]>;
  terminals?: BbPluginApi["sdk"]["terminals"]["list"];
  subscribe?: BbPluginApi["sdk"]["subscribe"];
  archive?: BbPluginApi["sdk"]["threads"]["archive"];
} = {}) {
  const host = createFakePluginHost({
    pluginId: "firstmate-queue",
    settings: {
      managerThreadId: options.managerThreadId ?? "manager-1",
      agentWritesEnabled: options.writes ?? false,
    },
    sdk: {
      subscribe: options.subscribe ?? (() => () => {}),
      threads: {
        get:
          options.get ??
          (async ({ threadId }) =>
            makeThreadResponse({
              id: threadId,
              title: threadId === "manager-1" ? "Manager" : `Title ${threadId}`,
              parentThreadId: threadId === "manager-1" ? null : "manager-1",
            })),
        list:
          options.list ??
          (async () => [listEntry("child-1")]),
        listRunning: options.running ?? (async () => []),
        send:
          options.send ??
          (async () => ({ ok: true, delivery: "sent" })),
        events: {
          list: options.events ?? (async () => []),
        },
        archive:
          options.archive ??
          (async ({ threadId }) => ({ archivedThreadIds: [threadId], ok: true })),
      },
      terminals: {
        list: options.terminals ?? (async () => ({ sessions: [] })),
      },
    },
  });
  await plugin(host.bb);
  return host;
}

describe("queue discovery and snapshots", () => {
  it("invalidates the queue for public native-terminal change signals", async () => {
    const changes = terminalChanges();
    const host = await configuredHost({ subscribe: changes.subscribe });
    const service = host.harness.behavior.runService(
      "terminal-change-listener",
    );
    await vi.waitFor(() => {
      expect(host.harness.inspection.sdk.callsTo("subscribe")).toHaveLength(1);
    });

    changes.emit("child-1");

    await vi.waitFor(() => {
      expect(host.harness.inspection.realtimeSignals).toContainEqual({
        channel: "queue-invalidated",
        payload: { threadId: "child-1", reason: "terminals-changed" },
      });
    });
    service.controller.abort();
    await service.done;
  });

  it("pages hidden cross-project direct children without a project filter and excludes grandchildren", async () => {
    const direct = Array.from({ length: 101 }, (_, index) =>
      listEntry(`child-${index}`, {
        projectId: index % 2 === 0 ? "project-a" : "project-b",
        visibility: index === 3 ? "hidden" : "visible",
      }),
    );
    const grandchild = listEntry("grandchild", {
      parentThreadId: "child-1",
    });
    const host = await configuredHost({
      list: async (args) => {
        const { offset = 0, limit = 100, parentThreadId } = args ?? {};
        return [...direct, grandchild]
          .filter((thread) => thread.parentThreadId === parentThreadId)
          .slice(offset, offset + limit);
      },
    });

    const snapshot = (await host.harness.behavior.callRpc("queueSnapshot", {
      surfaceThreadId: "manager-1",
    })) as { rows: Array<{ id: string }> };

    expect(snapshot.rows).toHaveLength(101);
    expect(snapshot.rows.some((row) => row.id === "child-3")).toBe(true);
    expect(snapshot.rows.some((row) => row.id === "grandchild")).toBe(false);
    expect(host.harness.inspection.sdk.callsTo("threads.list")).toEqual([
      [
        {
          parentThreadId: "manager-1",
          archived: false,
          includeHidden: true,
          limit: 100,
          offset: 0,
        },
      ],
      [
        {
          parentThreadId: "manager-1",
          archived: false,
          includeHidden: true,
          limit: 100,
          offset: 100,
        },
      ],
    ]);
  });

  it.each(["starting", "running"] as const)(
    "projects an idle child with a %s scoped native terminal as In progress",
    async (terminalStatus) => {
      const host = await configuredHost({
        list: async () => [listEntry("terminal-child", { status: "idle" })],
        terminals: async () => ({
          sessions: [
            terminalSession("terminal-1", "terminal-child", terminalStatus),
          ],
        }),
      });

      const snapshot = (await host.harness.behavior.callRpc("queueSnapshot", {
        surfaceThreadId: "manager-1",
      })) as {
        rows: Array<{
          id: string;
          section: string;
          state: string;
          statusLabel: string;
          detail: string;
        }>;
      };

      expect(snapshot.rows).toEqual([
        expect.objectContaining({
          id: "terminal-child",
          section: "in_progress",
          state: "running",
          statusLabel: "Active",
          detail: "Native terminal is active",
        }),
      ]);
      expect(host.harness.inspection.sdk.callsTo("terminals.list")).toEqual([
        [{ scope: { kind: "thread", threadId: "terminal-child" } }],
      ]);
    },
  );

  it("does not treat disconnected or exited native terminals as active", async () => {
    const host = await configuredHost({
      list: async () => [
        listEntry("disconnected-child", { status: "idle" }),
        listEntry("exited-child", { status: "idle" }),
      ],
      terminals: async ({ scope }) => {
        if (scope.kind !== "thread") throw new Error("Expected thread scope");
        return {
          sessions: [
            terminalSession(
              `terminal-${scope.threadId}`,
              scope.threadId,
              scope.threadId === "disconnected-child"
                ? "disconnected"
                : "exited",
            ),
          ],
        };
      },
    });

    const snapshot = (await host.harness.behavior.callRpc("queueSnapshot", {
      surfaceThreadId: "manager-1",
    })) as {
      rows: Array<{
        id: string;
        section: string;
        statusLabel: string;
      }>;
    };

    expect(
      snapshot.rows.map((row) => [row.id, row.section, row.statusLabel]),
    ).toEqual([
      ["disconnected-child", "needs_response", "Idle"],
      ["exited-child", "needs_response", "Idle"],
    ]);
  });

  it("projects idle owners as active for shallow and deep descendants", async () => {
    const parents = new Map([
      ["active-child", "owner-shallow"],
      ["depth-3", "depth-2"],
      ["depth-2", "depth-1"],
      ["depth-1", "owner-deep"],
    ]);
    const host = await configuredHost({
      list: async () => [listEntry("owner-shallow"), listEntry("owner-deep")],
      running: async () => [
        runningThread("active-child"),
        runningThread("depth-3"),
      ],
      get: async ({ threadId }) =>
        makeThreadResponse({
          id: threadId,
          parentThreadId:
            threadId === "manager-1" ? null : (parents.get(threadId) ?? null),
        }),
    });

    const snapshot = (await host.harness.behavior.callRpc("queueSnapshot", {
      surfaceThreadId: "manager-1",
    })) as {
      rows: Array<{
        id: string;
        section: string;
        state: string;
        statusLabel: string;
        detail: string;
      }>;
    };

    expect(
      snapshot.rows.map((row) => [
        row.id,
        row.section,
        row.state,
        row.statusLabel,
        row.detail,
      ]),
    ).toEqual([
      [
        "owner-deep",
        "in_progress",
        "running",
        "Active",
        "A descendant thread is active",
      ],
      [
        "owner-shallow",
        "in_progress",
        "running",
        "Active",
        "A descendant thread is active",
      ],
    ]);
    expect(host.harness.inspection.sdk.callsTo("threads.listRunning")).toEqual([
      [],
    ]);
  });

  it("bounds and caches ancestry lookups and stops on cycles", async () => {
    const runningLeaves = Array.from({ length: 20 }, (_, index) =>
      runningThread(`leaf-${index}`),
    );
    let activeLeafLookups = 0;
    let maximumActiveLeafLookups = 0;
    let startedLeafLookups = 0;
    let sharedParentLookups = 0;
    let release!: () => void;
    let workersStarted!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstWave = new Promise<void>((resolve) => {
      workersStarted = resolve;
    });
    const host = await configuredHost({
      list: async () => [listEntry("owner")],
      running: async () => [...runningLeaves, runningThread("cycle-a")],
      get: async ({ threadId }) => {
        if (threadId === "manager-1") {
          return makeThreadResponse({ id: threadId, parentThreadId: null });
        }
        if (threadId.startsWith("leaf-")) {
          activeLeafLookups += 1;
          startedLeafLookups += 1;
          maximumActiveLeafLookups = Math.max(
            maximumActiveLeafLookups,
            activeLeafLookups,
          );
          if (startedLeafLookups === 8) workersStarted();
          await gate;
          activeLeafLookups -= 1;
          return makeThreadResponse({
            id: threadId,
            parentThreadId: "shared-parent",
          });
        }
        if (threadId === "shared-parent") {
          sharedParentLookups += 1;
          return makeThreadResponse({ id: threadId, parentThreadId: "owner" });
        }
        return makeThreadResponse({
          id: threadId,
          parentThreadId: threadId === "cycle-a" ? "cycle-b" : "cycle-a",
        });
      },
    });

    const loading = host.harness.behavior.callRpc("queueSnapshot", {
      surfaceThreadId: "manager-1",
    });
    await firstWave;
    const firstWaveSize = startedLeafLookups;
    release();
    const snapshot = (await loading) as {
      rows: Array<{ id: string; section: string }>;
    };

    expect(firstWaveSize).toBe(8);
    expect(maximumActiveLeafLookups).toBeLessThanOrEqual(8);
    expect(sharedParentLookups).toBe(1);
    expect(
      host.harness.inspection.sdk
        .callsTo("threads.get")
        .filter(([input]) =>
          ["cycle-a", "cycle-b"].includes(
            (input as { threadId: string }).threadId,
          ),
        ),
    ).toHaveLength(2);
    expect(snapshot.rows).toEqual([
      expect.objectContaining({ id: "owner", section: "in_progress" }),
    ]);
  });

  it("places a newer Terminal Plugin Launch above older Needs rows", async () => {
    const host = await configuredHost({
      list: async () => [
        listEntry("older-child", {
          title: "Older queue review",
          updatedAt: 1_700_000_000_000,
        }),
        listEntry("terminal-plugin-launch", {
          title: "Terminal Plugin Launch",
          updatedAt: 1_800_000_000_000,
        }),
      ],
    });

    const snapshot = (await host.harness.behavior.callRpc("queueSnapshot", {
      surfaceThreadId: "manager-1",
    })) as {
      rows: Array<{ section: string; title: string; updatedAt: number }>;
    };

    expect(
      snapshot.rows
        .filter((row) => row.section === "needs_response")
        .map((row) => [row.title, row.updatedAt]),
    ).toEqual([
      ["Terminal Plugin Launch", 1_800_000_000_000],
      ["Older queue review", 1_700_000_000_000],
    ]);
  });

  it("deduplicates changing pages and keeps the latest row for each thread ID", async () => {
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      listEntry(`child-${index}`, {
        title: index === 0 ? "Old title" : `Title child-${index}`,
      }),
    );
    const host = await configuredHost({
      list: async (args) =>
        (args?.offset ?? 0) === 0
          ? firstPage
          : [listEntry("child-0", { title: "Latest title" })],
    });

    const snapshot = (await host.harness.behavior.callRpc("queueSnapshot", {
      surfaceThreadId: "manager-1",
    })) as { rows: Array<{ id: string; title: string }> };

    expect(snapshot.rows).toHaveLength(100);
    expect(snapshot.rows.filter((row) => row.id === "child-0")).toEqual([
      expect.objectContaining({ title: "Latest title" }),
    ]);
  });

  it("bounds per-child completion and terminal lookups while preserving results", async () => {
    const children = Array.from({ length: 20 }, (_, index) =>
      listEntry(`child-${index}`),
    );
    let activeTerminalLookups = 0;
    let maximumActiveTerminalLookups = 0;
    let startedTerminalLookups = 0;
    let release!: () => void;
    let workersStarted!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const firstWave = new Promise<void>((resolve) => {
      workersStarted = resolve;
    });
    const host = await configuredHost({
      list: async () => children,
      events: async ({ threadId }) => [
        completion(threadId, Number(threadId.split("-")[1]) + 1),
      ],
      terminals: async () => {
        activeTerminalLookups += 1;
        startedTerminalLookups += 1;
        maximumActiveTerminalLookups = Math.max(
          maximumActiveTerminalLookups,
          activeTerminalLookups,
        );
        if (startedTerminalLookups === 8) workersStarted();
        await gate;
        activeTerminalLookups -= 1;
        return { sessions: [] };
      },
    });

    const loading = host.harness.behavior.callRpc("queueSnapshot", {
      surfaceThreadId: "manager-1",
    });
    await firstWave;
    const firstWaveSize = startedTerminalLookups;
    release();
    const snapshot = (await loading) as {
      rows: Array<{ id: string; latestCompletionSeq: number }>;
    };

    expect(firstWaveSize).toBe(8);
    expect(maximumActiveTerminalLookups).toBeLessThanOrEqual(8);
    expect(
      host.harness.inspection.sdk.callsTo("threads.events.list"),
    ).toHaveLength(20);
    expect(host.harness.inspection.sdk.callsTo("terminals.list")).toHaveLength(
      20,
    );
    expect(snapshot.rows).toHaveLength(20);
    expect(snapshot.rows.find((row) => row.id === "child-0")).toMatchObject({
      latestCompletionSeq: 1,
    });
    expect(snapshot.rows.find((row) => row.id === "child-19")).toMatchObject({
      latestCompletionSeq: 20,
    });
  });

  it("uses the cheap trimmed-manager guard without loading the queue", async () => {
    const host = await configuredHost({ managerThreadId: "  manager-1  " });
    const initialGetCalls = host.harness.inspection.sdk.callsTo("threads.get").length;

    await expect(
      host.harness.behavior.callRpc("canOpen", {
        surfaceThreadId: "other-thread",
      }),
    ).resolves.toEqual({ canOpen: false });
    expect(host.harness.inspection.sdk.callsTo("threads.get")).toHaveLength(
      initialGetCalls,
    );

    await expect(
      host.harness.behavior.callRpc("canOpen", {
        surfaceThreadId: "manager-1",
      }),
    ).resolves.toEqual({ canOpen: true });
    expect(host.harness.inspection.sdk.callsTo("threads.get")).toHaveLength(
      initialGetCalls + 1,
    );
    expect(host.harness.inspection.sdk.callsTo("threads.list")).toEqual([]);
    expect(host.harness.inspection.sdk.callsTo("threads.events.list")).toEqual(
      [],
    );
  });

  it("silently rejects the action guard when no manager is configured", async () => {
    const host = createFakePluginHost({ pluginId: "firstmate-queue" });
    await plugin(host.bb);

    await expect(
      host.harness.behavior.callRpc("canOpen", {
        surfaceThreadId: "any-thread",
      }),
    ).resolves.toEqual({ canOpen: false });
    expect(host.harness.inspection.sdk.callsTo("threads.get")).toEqual([]);
  });

  it("rejects another surface and fails explicitly on an unknown BB tuple", async () => {
    const host = await configuredHost({
      list: async () => [listEntry("child-1", { status: "paused" as never })],
    });
    await expect(
      host.harness.behavior.callRpc("queueSnapshot", {
        surfaceThreadId: "other-thread",
      }),
    ).rejects.toThrow(/configured manager thread/i);
    await expect(
      host.harness.behavior.callRpc("queueSnapshot", {
        surfaceThreadId: "manager-1",
      }),
    ).rejects.toThrow("Unsupported BB thread status: paused");
  });
});

describe("inline replies", () => {
  it("routes exact untrimmed plain text to the authorized direct child", async () => {
    const host = await configuredHost();
    const text = "  Keep leading space\nAnd trailing space  \n";

    await expect(
      host.harness.behavior.callRpc("sendReply", {
        surfaceThreadId: "manager-1",
        childThreadId: "child-1",
        text,
      }),
    ).resolves.toEqual({ accepted: true });

    expect(host.harness.inspection.sdk.callsTo("threads.send")).toEqual([
      [
        {
          threadId: "child-1",
          mode: "auto",
          input: [{ type: "text", text, mentions: [] }],
        },
      ],
    ]);
    expect(host.harness.inspection.realtimeSignals.at(-1)).toEqual({
      channel: "queue-invalidated",
      payload: { threadId: "child-1", reason: "reply-sent" },
    });
  });

  it("rejects unauthorized, non-child, and whitespace-only replies", async () => {
    const host = await configuredHost({
      get: async ({ threadId }) =>
        makeThreadResponse({
          id: threadId,
          parentThreadId:
            threadId === "manager-1"
              ? null
              : threadId === "other-child"
                ? "other-manager"
                : "manager-1",
        }),
    });

    await expect(
      host.harness.behavior.callRpc("sendReply", {
        surfaceThreadId: "other-manager",
        childThreadId: "child-1",
        text: "Hello",
      }),
    ).rejects.toThrow(/configured manager thread/i);
    await expect(
      host.harness.behavior.callRpc("sendReply", {
        surfaceThreadId: "manager-1",
        childThreadId: "other-child",
        text: "Hello",
      }),
    ).rejects.toThrow(/current direct child/i);
    await expect(
      host.harness.behavior.callRpc("sendReply", {
        surfaceThreadId: "manager-1",
        childThreadId: "child-1",
        text: " \n\t ",
      }),
    ).rejects.toThrow(/rpc input validation failed/i);
    expect(host.harness.inspection.sdk.callsTo("threads.send")).toEqual([]);
  });

  it("does not publish acceptance when BB rejects the send", async () => {
    const host = await configuredHost({
      send: async () => {
        throw new Error("Provider unavailable");
      },
    });

    await expect(
      host.harness.behavior.callRpc("sendReply", {
        surfaceThreadId: "manager-1",
        childThreadId: "child-1",
        text: "Please continue",
      }),
    ).rejects.toThrow("Provider unavailable");
    expect(
      host.harness.inspection.realtimeSignals.filter(
        (signal) =>
          (signal.payload as { reason?: string }).reason === "reply-sent",
      ),
    ).toEqual([]);
  });
});

describe("annotation writes", () => {
  it("captures the durable completion cursor and persists exact annotation fields", async () => {
    const summary = "🚀".repeat(4_000);
    const host = await configuredHost({
      writes: true,
      events: async ({ threadId }) => [completion(threadId, 17)],
    });

    const output = await host.harness.behavior.callAgentTool(
      "firstmate_queue_update",
      {
        childThreadId: "child-1",
        summaryMarkdown: summary,
        disposition: "done",
      },
      { threadId: "manager-1" },
    );

    expect(toolResult(output)).toEqual({
      outcome: "updated",
      childThreadId: "child-1",
      reviewedThroughSeq: 17,
      disposition: "done",
    });
    const stored = host.bb.storage
      .database()
      .prepare(
        `SELECT summary_markdown, idle_disposition, reviewed_through_seq,
          user_managed, summary_updated_at, disposition_updated_at
         FROM queue_annotations WHERE thread_id = ?`,
      )
      .get("child-1");
    expect(stored).toMatchObject({
      summary_markdown: summary,
      idle_disposition: "done",
      reviewed_through_seq: 17,
      user_managed: 0,
    });
    expect(typeof (stored as { summary_updated_at: unknown }).summary_updated_at).toBe(
      "number",
    );
  });

  it("returns one exact JSON result shape for expected tool outcomes", async () => {
    const unconfigured = createFakePluginHost({
      pluginId: "firstmate-queue",
      settings: { agentWritesEnabled: true },
    });
    await plugin(unconfigured.bb);
    await expect(
      unconfigured.harness.behavior.callAgentTool(
        "firstmate_queue_update",
        {
          childThreadId: "child-1",
          summaryMarkdown: "Summary",
          disposition: "done",
        },
        { threadId: "manager-1" },
      ),
    ).resolves.toBe(JSON.stringify({ outcome: "not_configured" }));

    const disabled = await configuredHost();
    await expect(
      disabled.harness.behavior.callAgentTool(
        "firstmate_queue_update",
        {
          childThreadId: "child-1",
          summaryMarkdown: "Summary",
          disposition: "done",
        },
        { threadId: "manager-1" },
      ),
    ).resolves.toBe(JSON.stringify({ outcome: "writes_disabled" }));

    const active = await configuredHost({ writes: true });
    const input = {
      childThreadId: "child-1",
      summaryMarkdown: "Summary",
      disposition: "done",
    };
    await expect(
      active.harness.behavior.callAgentTool("firstmate_queue_update", input, {
        threadId: "other-thread",
      }),
    ).resolves.toBe(JSON.stringify({ outcome: "wrong_caller" }));
    await active.harness.behavior.callRpc("setUserManaged", {
      surfaceThreadId: "manager-1",
      childThreadId: "child-1",
      userManaged: true,
    });
    await expect(
      active.harness.behavior.callAgentTool("firstmate_queue_update", input, {
        threadId: "manager-1",
      }),
    ).resolves.toBe(JSON.stringify({ outcome: "user_managed" }));
    await expect(
      active.harness.behavior.callAgentTool(
        "firstmate_queue_update",
        { ...input, summaryMarkdown: "x".repeat(4_001) },
        { threadId: "manager-1" },
      ),
    ).rejects.toThrow(/4,000 Unicode characters/);

    const absent = await configuredHost({
      writes: true,
      get: async ({ threadId }) =>
        makeThreadResponse({
          id: threadId,
          parentThreadId: threadId === "manager-1" ? null : "other-manager",
        }),
    });
    await expect(
      absent.harness.behavior.callAgentTool("firstmate_queue_update", input, {
        threadId: "manager-1",
      }),
    ).resolves.toBe(JSON.stringify({ outcome: "not_current_child" }));
  });

  it("serializes a concurrent toggle before an agent update", async () => {
    let releaseCompletion!: () => void;
    let completionReadStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      completionReadStarted = resolve;
    });
    const gate = new Promise<void>((resolve) => {
      releaseCompletion = resolve;
    });
    const host = await configuredHost({
      writes: true,
      events: async ({ threadId }) => {
        completionReadStarted();
        await gate;
        return [completion(threadId, 4)];
      },
    });
    const write = host.harness.behavior.callAgentTool(
      "firstmate_queue_update",
      {
        childThreadId: "child-1",
        summaryMarkdown: "Must not land",
        disposition: "done",
      },
      { threadId: "manager-1" },
    );
    await started;
    await host.harness.behavior.callRpc("setUserManaged", {
      surfaceThreadId: "manager-1",
      childThreadId: "child-1",
      userManaged: true,
    });
    releaseCompletion();

    await expect(write).resolves.toBe(
      JSON.stringify({ outcome: "user_managed" }),
    );
    const stored = host.bb.storage
      .database()
      .prepare(
        "SELECT summary_markdown, user_managed FROM queue_annotations WHERE thread_id = ?",
      )
      .get("child-1");
    expect(stored).toEqual({ summary_markdown: null, user_managed: 1 });
  });

  it("keeps a completion racing an update visible as New result", async () => {
    let completionSeq = 10;
    const host = await configuredHost({
      writes: true,
      events: async ({ threadId }) => [completion(threadId, completionSeq)],
    });
    await host.harness.behavior.callAgentTool(
      "firstmate_queue_update",
      {
        childThreadId: "child-1",
        summaryMarkdown: "Reviewed ten",
        disposition: "done",
      },
      { threadId: "manager-1" },
    );
    completionSeq = 11;

    const snapshot = (await host.harness.behavior.callRpc("queueSnapshot", {
      surfaceThreadId: "manager-1",
    })) as { rows: Array<Record<string, unknown>> };
    expect(snapshot.rows[0]).toMatchObject({
      state: "new_result",
      detail: "New result",
      reviewedThroughSeq: 10,
      latestCompletionSeq: 11,
    });
  });

  it("retains annotations across reparent-away, reparent-back, and plugin restart", async () => {
    let isCurrentChild = true;
    const host = await configuredHost({
      writes: true,
      list: async () => (isCurrentChild ? [listEntry("child-1")] : []),
      events: async ({ threadId }) => [completion(threadId, 8)],
    });
    await host.harness.behavior.callAgentTool(
      "firstmate_queue_update",
      {
        childThreadId: "child-1",
        summaryMarkdown: "Retained review",
        disposition: "done",
      },
      { threadId: "manager-1" },
    );

    isCurrentChild = false;
    let view = (await host.harness.behavior.callRpc("queueSnapshot", {
      surfaceThreadId: "manager-1",
    })) as { rows: Array<Record<string, unknown>> };
    expect(view.rows).toEqual([]);

    isCurrentChild = true;
    view = (await host.harness.behavior.callRpc("queueSnapshot", {
      surfaceThreadId: "manager-1",
    })) as { rows: Array<Record<string, unknown>> };
    expect(view.rows[0]).toMatchObject({
      state: "done",
      detail: "Retained review",
      reviewedThroughSeq: 8,
    });

    const reloaded = await host.harness.lifecycle.reload(plugin);
    view = (await reloaded.harness.behavior.callRpc("queueSnapshot", {
      surfaceThreadId: "manager-1",
    })) as { rows: Array<Record<string, unknown>> };
    expect(view.rows[0]).toMatchObject({
      state: "done",
      detail: "Retained review",
      reviewedThroughSeq: 8,
    });
  });

  it("removes raced review fields without overwriting a winning user-managed toggle", async () => {
    let childLookups = 0;
    let releaseFinalCheck!: () => void;
    let finalCheckStarted!: () => void;
    const finalCheck = new Promise<void>((resolve) => {
      finalCheckStarted = resolve;
    });
    const finalCheckGate = new Promise<void>((resolve) => {
      releaseFinalCheck = resolve;
    });
    const host = await configuredHost({
      writes: true,
      events: async ({ threadId }) => [completion(threadId, 5)],
      get: async ({ threadId }) => {
        if (threadId === "manager-1") {
          return makeThreadResponse({ id: threadId, parentThreadId: null });
        }
        childLookups += 1;
        if (childLookups === 2) {
          finalCheckStarted();
          await finalCheckGate;
          return makeThreadResponse({
            id: threadId,
            parentThreadId: "other-manager",
          });
        }
        return makeThreadResponse({
          id: threadId,
          parentThreadId: "manager-1",
        });
      },
    });
    const write = host.harness.behavior.callAgentTool(
      "firstmate_queue_update",
      {
        childThreadId: "child-1",
        summaryMarkdown: "Raced review",
        disposition: "done",
      },
      { threadId: "manager-1" },
    );
    await finalCheck;
    await host.harness.behavior.callRpc("setUserManaged", {
      surfaceThreadId: "manager-1",
      childThreadId: "child-1",
      userManaged: true,
    });
    releaseFinalCheck();

    await expect(write).resolves.toBe(
      JSON.stringify({ outcome: "not_current_child" }),
    );
    expect(
      host.bb.storage
        .database()
        .prepare(
          `SELECT summary_markdown, idle_disposition, reviewed_through_seq,
             user_managed, mode_updated_at
           FROM queue_annotations WHERE thread_id = ?`,
        )
        .get("child-1"),
    ).toEqual({
      summary_markdown: null,
      idle_disposition: "needs_response",
      reviewed_through_seq: 0,
      user_managed: 1,
      mode_updated_at: expect.any(Number),
    });
  });

  it("removes a new review when archive or reparent wins the write race", async () => {
    let childLookups = 0;
    const host = await configuredHost({
      writes: true,
      get: async ({ threadId }) => {
        if (threadId === "manager-1") {
          return makeThreadResponse({ id: threadId, parentThreadId: null });
        }
        childLookups += 1;
        return makeThreadResponse({
          id: threadId,
          parentThreadId:
            childLookups === 1 ? "manager-1" : "other-manager",
        });
      },
    });
    const output = await host.harness.behavior.callAgentTool(
      "firstmate_queue_update",
      {
        childThreadId: "child-1",
        summaryMarkdown: "Raced write",
        disposition: "done",
      },
      { threadId: "manager-1" },
    );
    expect(toolResult(output)).toEqual({ outcome: "not_current_child" });
    expect(
      host.bb.storage
        .database()
        .prepare("SELECT * FROM queue_annotations WHERE thread_id = ?")
        .get("child-1"),
    ).toBeUndefined();
  });
});

describe("manual mode, archive, configuration, and invalidation", () => {
  it.each([
    ["non-child", { parentThreadId: "other-manager" }],
    ["archived child", { archivedAt: 100 }],
    ["deleted child", { deletedAt: 100 }],
  ] as const)(
    "rejects toggle, archive, and tool writes for a %s",
    async (_name, override) => {
      const host = await configuredHost({
        writes: true,
        get: async ({ threadId }) =>
          makeThreadResponse({
            id: threadId,
            parentThreadId:
              threadId === "manager-1" ? null : "manager-1",
            ...(threadId === "manager-1" ? {} : override),
          }),
      });
      const target = {
        surfaceThreadId: "manager-1",
        childThreadId: "child-1",
      };

      await expect(
        host.harness.behavior.callRpc("setUserManaged", {
          ...target,
          userManaged: true,
        }),
      ).rejects.toThrow(/not a current direct child/i);
      await expect(
        host.harness.behavior.callRpc("archiveThread", target),
      ).rejects.toThrow(/not a current direct child/i);
      const output = await host.harness.behavior.callAgentTool(
        "firstmate_queue_update",
        {
          childThreadId: "child-1",
          summaryMarkdown: "Must not land",
          disposition: "done",
        },
        { threadId: "manager-1" },
      );
      expect(toolResult(output)).toEqual({ outcome: "not_current_child" });
      expect(host.harness.inspection.sdk.callsTo("threads.archive")).toEqual([]);
      expect(host.harness.inspection.sdk.callsTo("threads.list")).toEqual([]);
    },
  );

  it("toggle-off preserves the review cursor while requiring a fresh review", async () => {
    const host = await configuredHost({
      writes: true,
      events: async ({ threadId }) => [completion(threadId, 12)],
    });
    await host.harness.behavior.callAgentTool(
      "firstmate_queue_update",
      {
        childThreadId: "child-1",
        summaryMarkdown: "Reviewed result",
        disposition: "done",
      },
      { threadId: "manager-1" },
    );
    await host.harness.behavior.callRpc("setUserManaged", {
      surfaceThreadId: "manager-1",
      childThreadId: "child-1",
      userManaged: true,
    });
    await host.harness.behavior.callRpc("setUserManaged", {
      surfaceThreadId: "manager-1",
      childThreadId: "child-1",
      userManaged: false,
    });

    expect(
      host.bb.storage
        .database()
        .prepare(
          `SELECT idle_disposition, reviewed_through_seq, user_managed
           FROM queue_annotations WHERE thread_id = ?`,
        )
        .get("child-1"),
    ).toEqual({
      idle_disposition: "needs_response",
      reviewed_through_seq: 12,
      user_managed: 0,
    });
  });

  it("toggle-on makes idle Needs, toggle-off requires fresh review, and archive uses one validated RPC", async () => {
    const archived: string[] = [];
    const host = await configuredHost({
      archive: async ({ threadId }) => {
        archived.push(threadId);
        return { archivedThreadIds: [threadId], ok: true };
      },
    });
    await host.harness.behavior.callRpc("setUserManaged", {
      surfaceThreadId: "manager-1",
      childThreadId: "child-1",
      userManaged: true,
    });
    let snapshot = (await host.harness.behavior.callRpc("queueSnapshot", {
      surfaceThreadId: "manager-1",
    })) as { rows: Array<Record<string, unknown>> };
    expect(snapshot.rows[0]).toMatchObject({
      userManaged: true,
      section: "needs_response",
    });
    await host.harness.behavior.callRpc("setUserManaged", {
      surfaceThreadId: "manager-1",
      childThreadId: "child-1",
      userManaged: false,
    });
    snapshot = (await host.harness.behavior.callRpc("queueSnapshot", {
      surfaceThreadId: "manager-1",
    })) as { rows: Array<Record<string, unknown>> };
    expect(snapshot.rows[0]).toMatchObject({
      userManaged: false,
      state: "needs_response",
    });
    await host.harness.behavior.callRpc("archiveThread", {
      surfaceThreadId: "manager-1",
      childThreadId: "child-1",
    });
    expect(archived).toEqual(["child-1"]);
  });

  it("exposes no tool or instructions until activation and only configures the current manager", async () => {
    const host = await configuredHost();
    let config = await host.harness.behavior.resolveAgentConfiguration(
      agentContext("manager-1"),
    );
    expect(config).toMatchObject({ tools: [], skills: [], instructions: null });

    await host.harness.behavior.callRpc("setUserManaged", {
      surfaceThreadId: "manager-1",
      childThreadId: "child-1",
      userManaged: true,
    });
    await host.harness.behavior.setSettings({ agentWritesEnabled: true });
    config = await host.harness.behavior.resolveAgentConfiguration(
      agentContext("manager-1"),
    );
    expect(config.tools.map((tool) => tool.name)).toEqual([
      "firstmate_queue_update",
    ]);
    expect(config.instructions).toContain("annotation writes are active");
    expect(config.instructions).toContain("return user_managed");
    expect(config.tools[0]?.instructions).toContain(
      "Calls accepted by the parameter schema return a JSON object",
    );
    expect(config.tools[0]?.instructions).toContain("outcome updated");
    expect(config.tools[0]?.instructions).toContain("runtime_error");
    expect(config.tools[0]?.instructions).toContain(
      "Malformed parameters fail tool validation before execution",
    );
    expect(config.instructions).not.toContain("child-1");
    const other = await host.harness.behavior.resolveAgentConfiguration(
      agentContext("other-thread"),
    );
    expect(other).toMatchObject({ tools: [], skills: [], instructions: null });
  });

  it("reports an archived configured manager as stale until reload", async () => {
    const host = createFakePluginHost({
      pluginId: "firstmate-queue",
      settings: {
        managerThreadId: "manager-1",
        agentWritesEnabled: false,
      },
      sdk: {
        threads: {
          get: async () =>
            makeThreadResponse({ id: "manager-1", archivedAt: 100 }),
        },
      },
    });
    await plugin(host.bb);
    expect(host.harness.inspection.needsConfigurationMessages.at(-1)).toMatch(
      /archived, deleted, or missing/,
    );
    expect(host.harness.inspection.logEntries.at(-1)?.message).toContain(
      "manager-1",
    );
  });

  it("reports a configured missing manager as needing configuration", async () => {
    const missing = Object.assign(new Error("not found"), { status: 404 });
    const host = createFakePluginHost({
      pluginId: "firstmate-queue",
      settings: {
        managerThreadId: "manager-1",
        agentWritesEnabled: false,
      },
      sdk: {
        threads: {
          get: async () => {
            throw missing;
          },
        },
      },
    });
    await plugin(host.bb);

    expect(host.harness.inspection.needsConfigurationMessages.at(-1)).toMatch(
      /archived, deleted, or missing/,
    );
  });

  it("keeps needs-configuration set after a missing manager is corrected", async () => {
    const host = createFakePluginHost({
      pluginId: "firstmate-queue",
      sdk: {
        threads: {
          get: async ({ threadId }) => makeThreadResponse({ id: threadId }),
        },
      },
    });
    await plugin(host.bb);
    expect(host.harness.inspection.needsConfigurationMessages).toEqual([
      "Set managerThreadId in the Firstmate Queue plugin settings.",
    ]);

    await host.harness.behavior.setSettings({ managerThreadId: "manager-1" });
    await expect(
      host.harness.behavior.callRpc("canOpen", {
        surfaceThreadId: "manager-1",
      }),
    ).resolves.toEqual({ canOpen: true });
    expect(host.harness.inspection.needsConfigurationMessages).toEqual([
      "Set managerThreadId in the Firstmate Queue plugin settings.",
    ]);
  });

  it("marks configuration as needed when the manager setting is cleared", async () => {
    const host = await configuredHost();
    const before = host.harness.inspection.needsConfigurationMessages.length;

    await host.harness.behavior.setSettings({ managerThreadId: null });

    expect(host.harness.inspection.needsConfigurationMessages.slice(before)).toEqual([
      "Set managerThreadId in the Firstmate Queue plugin settings.",
    ]);
    await expect(
      host.harness.behavior.callRpc("canOpen", {
        surfaceThreadId: "manager-1",
      }),
    ).resolves.toEqual({ canOpen: false });
  });

  it("does not mark a transient manager lookup failure as configuration", async () => {
    const host = createFakePluginHost({
      pluginId: "firstmate-queue",
      settings: {
        managerThreadId: "manager-1",
        agentWritesEnabled: false,
      },
      sdk: {
        threads: {
          get: async () => {
            throw new Error("temporary transport failure");
          },
        },
      },
    });
    await plugin(host.bb);

    expect(host.harness.inspection.needsConfigurationMessages).toEqual([]);
    await expect(
      host.harness.behavior.callRpc("canOpen", {
        surfaceThreadId: "manager-1",
      }),
    ).rejects.toThrow(/could not verify/i);
    expect(host.harness.inspection.needsConfigurationMessages).toEqual([]);
  });

  it("applies manager setting changes without reload", async () => {
    const host = await configuredHost({ writes: true });
    await host.harness.behavior.setSettings({ managerThreadId: "manager-2" });

    const oldManager = await host.harness.behavior.resolveAgentConfiguration(
      agentContext("manager-1"),
    );
    const newManager = await host.harness.behavior.resolveAgentConfiguration(
      agentContext("manager-2"),
    );
    expect(oldManager.tools).toEqual([]);
    expect(newManager.tools.map((tool) => tool.name)).toEqual([
      "firstmate_queue_update",
    ]);
    await expect(
      host.harness.behavior.callRpc("queueSnapshot", {
        surfaceThreadId: "manager-1",
      }),
    ).rejects.toThrow(/configured manager thread/i);
  });

  it("publishes invalidation for every relevant event and ignores unrelated threads", async () => {
    const host = await configuredHost({
      get: async ({ threadId }) =>
        makeThreadResponse({
          id: threadId,
          parentThreadId:
            threadId === "manager-1" || threadId === "other-manager"
              ? null
              : "manager-1",
        }),
    });
    const direct = makeThreadResponse({
      id: "child-1",
      parentThreadId: "manager-1",
    });
    await host.harness.behavior.emitThreadEvent("thread.created", {
      thread: direct,
    });
    await host.harness.behavior.emitThreadEvent("thread.active", {
      thread: { ...direct, status: "active" },
    });
    await host.harness.behavior.emitThreadEvent("thread.idle", {
      thread: direct,
      lastAssistantText: "Done",
    });
    await host.harness.behavior.emitThreadEvent("thread.failed", {
      thread: { ...direct, status: "error" },
      error: "Failed",
    });
    await host.harness.behavior.emitThreadEvent("thread.archived", {
      thread: { ...direct, archivedAt: 1 },
    });
    await host.harness.behavior.emitThreadEvent("thread.deleted", {
      thread: { ...direct, deletedAt: 1 },
    });
    await host.harness.behavior.emitThreadEvent("message.queued", {
      entry: makeQueueEntry({ threadId: "child-1" }),
    });
    await host.harness.behavior.emitThreadEvent("message.dispatched", {
      entry: makeQueueEntry({ threadId: "child-1" }),
    });
    await host.harness.behavior.emitThreadEvent(
      "turn.failed",
      makeTurnFailedEvent({ threadId: "child-1" }),
    );
    await host.harness.behavior.emitThreadEvent("thread.active", {
      thread: makeThreadResponse({
        id: "unrelated",
        parentThreadId: "other-manager",
        status: "active",
      }),
    });

    expect(host.harness.inspection.sdk.callsTo("threads.list")).toEqual([]);
    expect(
      host.harness.inspection.sdk
        .callsTo("threads.get")
        .filter(
          ([input]) =>
            (input as { threadId?: string }).threadId === "child-1",
        ),
    ).toHaveLength(3);
    expect(
      host.harness.inspection.realtimeSignals.map((signal) => signal.payload),
    ).toEqual([
      { threadId: "child-1", reason: "thread.created" },
      { threadId: "child-1", reason: "thread.active" },
      { threadId: "child-1", reason: "thread.idle" },
      { threadId: "child-1", reason: "thread.failed" },
      { threadId: "child-1", reason: "thread.archived" },
      { threadId: "child-1", reason: "thread.deleted" },
      { threadId: "child-1", reason: "message.queued" },
      { threadId: "child-1", reason: "message.dispatched" },
      { threadId: "child-1", reason: "turn.failed" },
    ]);
  });

  it("invalidates the owning row for descendant lifecycle changes", async () => {
    const host = await configuredHost({
      get: async ({ threadId }) =>
        makeThreadResponse({
          id: threadId,
          parentThreadId:
            threadId === "manager-1"
              ? null
              : threadId === "middle"
                ? "child-1"
                : "manager-1",
        }),
    });
    const descendant = makeThreadResponse({
      id: "deep-descendant",
      parentThreadId: "middle",
    });

    await host.harness.behavior.emitThreadEvent("thread.active", {
      thread: { ...descendant, status: "active" },
    });
    await host.harness.behavior.emitThreadEvent("thread.idle", {
      thread: descendant,
      lastAssistantText: "Done",
    });
    await host.harness.behavior.emitThreadEvent("thread.failed", {
      thread: { ...descendant, status: "error" },
      error: "Failed",
    });
    await host.harness.behavior.emitThreadEvent("thread.archived", {
      thread: { ...descendant, archivedAt: 1 },
    });
    await host.harness.behavior.emitThreadEvent("thread.deleted", {
      thread: { ...descendant, deletedAt: 1 },
    });

    expect(
      host.harness.inspection.realtimeSignals.map((signal) => signal.payload),
    ).toEqual([
      { threadId: "child-1", reason: "thread.active" },
      { threadId: "child-1", reason: "thread.idle" },
      { threadId: "child-1", reason: "thread.failed" },
      { threadId: "child-1", reason: "thread.archived" },
      { threadId: "child-1", reason: "thread.deleted" },
    ]);
  });
});
