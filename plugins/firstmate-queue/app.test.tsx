// @vitest-environment jsdom
import { act, cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  loadPluginApp,
  renderSlot,
  type PluginRpcTestHandlers,
  type RenderSlotOptions,
} from "@get-bb/plugin-sdk/testing/app";
import type { PluginThreadPanelProps } from "@get-bb/plugin-sdk/app";
import type { QueueRow, rpcContract } from "./contract.js";

const toastError = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { error: toastError } }));

const app = await loadPluginApp(() => import("./app.js"));
const action = app.threadPanelActions[0]!;

function row(overrides: Partial<QueueRow> = {}): QueueRow {
  return {
    id: "child-1",
    title: "Review child result",
    section: "needs_response",
    state: "needs_response",
    statusLabel: "Idle",
    detail: "Needs your response",
    summaryMarkdown: null,
    userManaged: false,
    latestCompletionSeq: 7,
    reviewedThroughSeq: 7,
    updatedAt: 1_767_355_445_000,
    ...overrides,
  };
}

function snapshot(rows: QueueRow[] = [row()]) {
  return {
    managerThreadId: "manager-1",
    agentWritesEnabled: false,
    rows,
  };
}

type QueueRenderOptions = Omit<
  RenderSlotOptions<typeof rpcContract>,
  "rpc"
> & {
  rpc?: Partial<PluginRpcTestHandlers<typeof rpcContract>>;
};

function renderQueue(options: QueueRenderOptions = {}) {
  const { rpc, ...rest } = options;
  const handlers: PluginRpcTestHandlers<typeof rpcContract> = {
    canOpen: () => ({ canOpen: true }),
    queueSnapshot: () => snapshot(),
    setUserManaged: ({ childThreadId, userManaged }) => ({
      childThreadId,
      userManaged,
    }),
    archiveThread: () => ({ archived: true }),
    sendReply: () => ({ accepted: true }),
    ...rpc,
  };
  return renderSlot<PluginThreadPanelProps, typeof rpcContract>(
    action,
    { threadId: "manager-1", params: null },
    {
      settings: { managerThreadId: "manager-1", agentWritesEnabled: false },
      ...rest,
      rpc: handlers,
    },
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  toastError.mockReset();
  window.localStorage.clear();
});

describe("registration guards", () => {
  it("registers one padded Firstmate queue thread action", () => {
    expect(app.threadPanelActions).toHaveLength(1);
    expect(action).toMatchObject({
      id: "firstmate-queue",
      title: "Firstmate queue",
      layout: "padded",
    });
  });

  it("opens only after the cheap backend guard authorizes the manager", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ ok: true, result: { canOpen: true } }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    const openPanel = vi.fn(() => true);
    await action.run!({ threadId: "manager-1", openPanel });
    expect(openPanel).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/plugins/firstmate-queue/rpc/canOpen",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ surfaceThreadId: "manager-1" }),
      }),
    );

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, result: { canOpen: false } }),
      })),
    );
    await action.run!({ threadId: "other-thread", openPanel });
    expect(openPanel).toHaveBeenCalledOnce();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("silently declines an unconfigured action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ ok: true, result: { canOpen: false } }),
      })),
    );
    const openPanel = vi.fn(() => true);

    await action.run!({ threadId: "any-thread", openPanel });

    expect(openPanel).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalled();
  });

  it("surfaces a bounded authorization failure without opening", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: false,
        json: async () => ({
          ok: false,
          error: { message: "x".repeat(300) },
        }),
      })),
    );
    const openPanel = vi.fn(() => true);
    await action.run!({ threadId: "manager-1", openPanel });

    expect(openPanel).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledOnce();
    expect(String(toastError.mock.calls[0]![0]).endsWith("…")).toBe(true);
    expect(String(toastError.mock.calls[0]![0]).length).toBeLessThan(280);
  });

  it("renders no queue content when panel props do not match live settings", () => {
    const slot = renderSlot(
      action,
      { threadId: "other-thread", params: null },
      {
        settings: { managerThreadId: "manager-1" },
        rpc: { queueSnapshot: () => snapshot() },
      },
    );
    expect(slot.container.childElementCount).toBe(0);
    expect(slot.inspection.rpcCalls).toEqual([]);
  });

  it("uses the trimmed manager setting for the panel guard", async () => {
    const slot = renderSlot(
      action,
      { threadId: "manager-1", params: null },
      {
        settings: { managerThreadId: "  manager-1  " },
        rpc: { queueSnapshot: () => snapshot() },
      },
    );
    expect(await slot.findByText("Review child result")).toBeTruthy();
  });
});

describe("queue panel", () => {
  it("renders all sections, deterministic states, and Markdown summaries", async () => {
    const rows = [
      row(),
      row({
        id: "child-2",
        title: "Building plugin",
        section: "in_progress",
        state: "running",
        statusLabel: "Active",
        detail: "Implements **backend**",
        summaryMarkdown: "Implements **backend**",
      }),
      row({
        id: "child-3",
        title: "Finished review",
        section: "done",
        state: "done",
        detail: "All checks pass",
        summaryMarkdown: "All checks pass",
      }),
    ];
    const slot = renderQueue({ rpc: { queueSnapshot: () => snapshot(rows) } });

    await slot.findByRole("heading", { name: "Needs your response" });
    expect(slot.getByRole("heading", { name: "In progress" })).toBeTruthy();
    expect(slot.getByRole("heading", { name: "Done" })).toBeTruthy();
    expect(slot.getByText("Needs your response", { selector: "p" })).toBeTruthy();
    expect(slot.getByText("Implements **backend**")).toBeTruthy();
    expect(slot.getByText("Active")).toBeTruthy();
  });

  it("shows the local update time to the minute only for Needs rows", async () => {
    const formatLocalTime = vi
      .spyOn(Date.prototype, "toLocaleString")
      .mockReturnValue("1/2/26, 3:04 PM");
    const slot = renderQueue({
      rpc: {
        queueSnapshot: () =>
          snapshot([
            row({ title: "Terminal Plugin Launch" }),
            row({
              id: "child-2",
              title: "Native terminal work",
              section: "in_progress",
              state: "running",
              statusLabel: "Active",
              detail: "Native terminal is active",
            }),
          ]),
      },
    });

    const needsRow = (await slot.findByText("Terminal Plugin Launch")).closest(
      "li",
    )!;
    const progressRow = slot.getByText("Native terminal work").closest("li")!;
    expect(formatLocalTime).toHaveBeenCalledWith(undefined, {
      dateStyle: "short",
      timeStyle: "short",
    });
    expect(needsRow.querySelector("time")?.textContent).toBe(
      "Updated 1/2/26, 3:04 PM",
    );
    expect(needsRow.querySelector("time")?.className).toContain(
      "text-muted-foreground",
    );
    expect(progressRow.textContent).toContain("Active");
    expect(progressRow.querySelector("time")).toBeNull();
  });

  it("opens, validates, and sends an exact multiline reply by keyboard", async () => {
    const sendReply = vi.fn(async () => ({ accepted: true as const }));
    const queueSnapshot = vi.fn(() => snapshot());
    const slot = renderQueue({ rpc: { queueSnapshot, sendReply } });
    const replyButton = await slot.findByRole("button", {
      name: "Reply to Review child result",
    });
    expect(replyButton.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(replyButton);

    const input = await slot.findByRole("textbox", {
      name: "Reply to Review child result",
    });
    expect(replyButton.getAttribute("aria-expanded")).toBe("true");
    expect(replyButton.getAttribute("aria-controls")).toBe(
      input.closest("form")?.id,
    );
    expect(document.activeElement).toBe(input);
    expect(slot.getByRole("button", { name: "Cancel" })).toBeTruthy();
    fireEvent.change(input, { target: { value: " \n\t " } });
    fireEvent.keyDown(input, { key: "Enter", ctrlKey: true });
    expect(sendReply).not.toHaveBeenCalled();
    expect(await slot.findByRole("alert")).toHaveProperty(
      "textContent",
      "Enter a reply.",
    );

    const text = "  First line\nSecond line  \n";
    fireEvent.change(input, { target: { value: text } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(sendReply).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter", metaKey: true });

    await waitFor(() => {
      expect(sendReply).toHaveBeenCalledWith({
        surfaceThreadId: "manager-1",
        childThreadId: "child-1",
        text,
      });
    });
    await waitFor(() => {
      expect(
        slot.queryByRole("textbox", { name: "Reply to Review child result" }),
      ).toBeNull();
    });
    expect(replyButton.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(replyButton);
    expect(queueSnapshot).toHaveBeenCalledTimes(2);

    fireEvent.click(replyButton);
    expect(
      (
        (await slot.findByRole("textbox", {
          name: "Reply to Review child result",
        })) as HTMLTextAreaElement
      ).value,
    ).toBe("");
  });

  it("keeps a failed reply draft and prevents duplicate submits", async () => {
    let rejectSend!: (cause: Error) => void;
    const pending = new Promise<{ accepted: true }>((_resolve, reject) => {
      rejectSend = reject;
    });
    const sendReply = vi.fn(() => pending);
    const slot = renderQueue({ rpc: { sendReply } });
    const replyButton = await slot.findByRole("button", {
      name: "Reply to Review child result",
    });
    fireEvent.click(replyButton);
    const input = (await slot.findByRole("textbox", {
      name: "Reply to Review child result",
    })) as HTMLTextAreaElement;
    const exactDraft = "  Retry this\nwithout trimming  ";
    fireEvent.change(input, { target: { value: exactDraft } });
    const form = input.closest("form")!;

    fireEvent.submit(form);
    fireEvent.submit(form);

    expect(sendReply).toHaveBeenCalledOnce();
    expect(form.getAttribute("aria-busy")).toBe("true");
    expect(input.disabled).toBe(true);
    expect(slot.getByRole("button", { name: "Sending…" })).toHaveProperty(
      "disabled",
      true,
    );

    await act(async () => {
      rejectSend(new Error("x".repeat(300)));
      await pending.catch(() => undefined);
    });

    const error = await slot.findByRole("alert");
    expect(error.textContent?.endsWith("…")).toBe(true);
    expect(error.textContent?.length).toBe(240);
    expect(input.value).toBe(exactDraft);
    expect(input.disabled).toBe(false);
    expect(replyButton.getAttribute("aria-expanded")).toBe("true");
  });

  it("shows neutral review state without New result or a stale summary", async () => {
    const slot = renderQueue({
      rpc: {
        queueSnapshot: () =>
          snapshot([
            row({
              section: "in_progress",
              state: "awaiting_review",
              detail: "Awaiting Firstmate review",
              summaryMarkdown: null,
            }),
          ]),
      },
    });

    expect(await slot.findByText("Awaiting Firstmate review")).toBeTruthy();
    expect(slot.queryByText("New result")).toBeNull();
    expect(slot.queryByText("Earlier reviewed result")).toBeNull();
  });

  it("keeps failure text visible with the earlier summary as context", async () => {
    const failed = row({
      state: "queued_failed",
      statusLabel: "Idle",
      detail: "Queued work failed",
      summaryMarkdown: "Earlier successful result",
    });
    const slot = renderQueue({
      rpc: { queueSnapshot: () => snapshot([failed]) },
    });

    expect(await slot.findByText("Queued work failed")).toBeTruthy();
    expect(slot.getByText("Earlier successful result")).toBeTruthy();
  });

  it("uses BB's thread-mention pill with no split action", async () => {
    const slot = renderQueue({ rpc: { queueSnapshot: () => snapshot() } });
    const title = await slot.findByRole("button", {
      name: "Review child result",
    });

    expect(title.className).toContain("prompt-mention-pill");
    expect(title.className).toContain("rounded-full");
    expect(title.className).toContain("cursor-pointer");
    expect(title.className).toContain("text-sm");
    expect(title.textContent).not.toContain("↗");
    const icon = title.querySelector("svg");
    expect(icon?.getAttribute("aria-hidden")).toBe("true");
    expect(title.firstElementChild).toBe(icon);
    fireEvent.click(title);
    expect(slot.inspection.navigateCalls).toEqual([
      { method: "toThread", threadId: "child-1" },
    ]);
    expect(slot.inspection.sidebarActionCalls).toEqual([]);
  });

  it("keeps status and compact Archive controls in the card header", async () => {
    const slot = renderQueue({ rpc: { queueSnapshot: () => snapshot() } });
    const title = await slot.findByRole("button", {
      name: "Review child result",
    });
    const archive = slot.getByRole("button", {
      name: "Archive Review child result",
    });
    const status = slot.getByText("Idle");
    const toggle = slot.getByRole("switch", {
      name: "User managed: Off",
    });

    expect(title.parentElement?.contains(archive)).toBe(true);
    expect(status.parentElement?.contains(archive)).toBe(true);
    expect(archive.className).toContain("rounded-md");
    expect(archive.className).toContain("border-border");
    expect(archive.className).toContain("min-h-6");
    expect(archive.className).toContain("text-xs");
    expect(status.className).toContain("text-xs");
    expect(toggle.parentElement?.className).toContain("justify-end");
    expect(toggle.className).toContain("text-[11px]");
    expect(toggle.className).toContain("text-muted-foreground");
  });

  it("persists a collapsed row across an app reload without hiding its controls", async () => {
    const stableRow = row({
      state: "awaiting_review",
      detail: "Stable detail",
      summaryMarkdown: null,
    });
    const first = renderQueue({
      rpc: { queueSnapshot: () => snapshot([stableRow]) },
    });
    const collapse = await first.findByRole("button", {
      name: "Collapse details for Review child result",
    });
    const contentId = collapse.getAttribute("aria-controls")!;
    const content = document.getElementById(contentId)!;

    fireEvent.click(collapse);
    expect(
      first.getByRole("button", {
        name: "Expand details for Review child result",
      }),
    ).toBeTruthy();
    expect(content.hidden).toBe(true);
    expect(first.getByText("Idle")).toBeTruthy();
    expect(
      (first.getByRole("button", {
        name: "Archive Review child result",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
    expect(
      (first.getByRole("switch", {
        name: "User managed: Off",
      }) as HTMLButtonElement).disabled,
    ).toBe(false);
    fireEvent.click(
      first.getByRole("button", { name: "Review child result" }),
    );
    expect(first.inspection.navigateCalls.at(-1)).toEqual({
      method: "toThread",
      threadId: "child-1",
    });
    first.lifecycle.unmount();

    const reloaded = renderQueue({
      rpc: {
        queueSnapshot: () =>
          snapshot([
            stableRow,
            row({
              id: "child-2",
              title: "Other child",
              state: "awaiting_review",
              detail: "Stable detail",
              summaryMarkdown: null,
            }),
          ]),
      },
    });
    const persisted = await reloaded.findByRole("button", {
      name: "Expand details for Review child result",
    });
    expect(
      document.getElementById(persisted.getAttribute("aria-controls")!)?.hidden,
    ).toBe(true);
    expect(
      reloaded.getByRole("button", {
        name: "Collapse details for Other child",
      }),
    ).toBeTruthy();
  });

  it("keeps a row collapsed through an unchanged snapshot refresh", async () => {
    const stableRow = row({
      state: "awaiting_review",
      detail: "Stable detail",
      summaryMarkdown: null,
    });
    const slot = renderQueue({
      rpc: { queueSnapshot: () => snapshot([stableRow]) },
    });
    fireEvent.click(
      await slot.findByRole("button", {
        name: "Collapse details for Review child result",
      }),
    );

    await slot.behavior.emitRealtime("queue-invalidated", {
      threadId: "child-1",
      reason: "thread.idle",
    });
    await waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(2));

    const persisted = slot.getByRole("button", {
      name: "Expand details for Review child result",
    });
    expect(
      document.getElementById(persisted.getAttribute("aria-controls")!)?.hidden,
    ).toBe(true);
  });

  it.each(["detail", "summary"] as const)(
    "auto-expands once when displayed %s changes",
    async (changedField) => {
      let changed = false;
      const currentRow = () =>
        changedField === "detail"
          ? row({
              state: "awaiting_review",
              detail: changed ? "Updated detail" : "Earlier detail",
              summaryMarkdown: null,
            })
          : row({
              detail: changed ? "Updated summary" : "Earlier summary",
              summaryMarkdown: changed
                ? "Updated summary"
                : "Earlier summary",
            });
      const slot = renderQueue({
        rpc: { queueSnapshot: () => snapshot([currentRow()]) },
      });
      fireEvent.click(
        await slot.findByRole("button", {
          name: "Collapse details for Review child result",
        }),
      );
      changed = true;

      await slot.behavior.emitRealtime("queue-invalidated", {
        threadId: "child-1",
        reason: "thread.idle",
      });
      await waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(2));

      const expanded = slot.getByRole("button", {
        name: "Collapse details for Review child result",
      });
      const content = document.getElementById(
        expanded.getAttribute("aria-controls")!,
      )!;
      expect(content.hidden).toBe(false);
      expect(
        slot.getByText(
          changedField === "detail" ? "Updated detail" : "Updated summary",
        ),
      ).toBeTruthy();

      fireEvent.click(expanded);
      await slot.behavior.emitRealtime("queue-invalidated", {
        threadId: "child-1",
        reason: "thread.idle",
      });
      await waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(3));
      expect(
        slot.getByRole("button", {
          name: "Expand details for Review child result",
        }),
      ).toBeTruthy();
      expect(content.hidden).toBe(true);
    },
  );

  it("refetches after archive failure instead of restoring a stale snapshot", async () => {
    let rejectArchive!: (error: Error) => void;
    const archive = new Promise<never>((_resolve, reject) => {
      rejectArchive = reject;
    });
    let snapshotCalls = 0;
    const slot = renderQueue({
      rpc: {
        queueSnapshot: () => {
          snapshotCalls += 1;
          if (snapshotCalls === 1) return snapshot();
          if (snapshotCalls === 2) {
            return snapshot([row({ title: "Newer authoritative title" })]);
          }
          return snapshot([row({ title: "Final authoritative title" })]);
        },
        archiveThread: () => archive,
      },
    });
    const archiveButton = await slot.findByRole("button", {
      name: "Archive Review child result",
    });
    fireEvent.click(archiveButton);
    expect(slot.queryByText("Review child result")).toBeNull();
    expect(slot.inspection.rpcCalls.at(-1)).toEqual({
      method: "archiveThread",
      input: {
        surfaceThreadId: "manager-1",
        childThreadId: "child-1",
      },
    });

    await slot.behavior.emitRealtime("queue-invalidated", {
      threadId: "child-1",
      reason: "thread.idle",
    });
    await slot.findByText("Newer authoritative title");
    rejectArchive(new Error("x".repeat(300)));

    await slot.findByText("Final authoritative title");
    expect(slot.queryByText("Review child result")).toBeNull();
    expect(snapshotCalls).toBe(3);
    const alert = slot.getByRole("alert");
    expect(alert.textContent?.endsWith("…")).toBe(true);
    expect(alert.textContent!.length).toBeLessThan(250);
  });

  it("toggles manual ownership and refreshes the projected row", async () => {
    let managed = false;
    const slot = renderQueue({
      rpc: {
        queueSnapshot: () =>
          snapshot([
            row({
              section: "in_progress",
              state: managed ? "user_managed" : "awaiting_review",
              detail: managed
                ? "You are handling this"
                : "Awaiting Firstmate review",
              userManaged: managed,
            }),
          ]),
        setUserManaged: ({ userManaged }) => {
          managed = userManaged;
          return { childThreadId: "child-1", userManaged };
        },
      },
    });
    const toggle = await slot.findByRole("switch", {
      name: "User managed: Off",
    });
    fireEvent.click(toggle);
    await slot.findByRole("switch", { name: "User managed: On" });
    expect(
      slot.inspection.rpcCalls.some((call) => call.method === "setUserManaged"),
    ).toBe(true);
  });

  it("disables every mutation control but keeps title navigation available", async () => {
    let finishToggle!: (value: {
      childThreadId: string;
      userManaged: boolean;
    }) => void;
    const pendingToggle = new Promise<{
      childThreadId: string;
      userManaged: boolean;
    }>((resolve) => {
      finishToggle = resolve;
    });
    const slot = renderQueue({
      rpc: {
        queueSnapshot: () =>
          snapshot([
            row(),
            row({ id: "child-2", title: "Other child" }),
          ]),
        setUserManaged: () => pendingToggle,
      },
    });
    await slot.findByText("Other child");
    const toggles = slot.getAllByRole("switch");
    const activeToggle = toggles[0]!;

    fireEvent.click(activeToggle);
    await waitFor(() =>
      expect((activeToggle as HTMLButtonElement).disabled).toBe(true),
    );
    expect((toggles[1] as HTMLButtonElement).disabled).toBe(true);
    expect(
      slot.getAllByRole("button", { name: /^Archive / }).every(
        (button) => (button as HTMLButtonElement).disabled,
      ),
    ).toBe(true);
    const otherTitle = slot.getByRole("button", { name: "Other child" });
    expect((otherTitle as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(otherTitle);
    expect(slot.inspection.navigateCalls.at(-1)).toEqual({
      method: "toThread",
      threadId: "child-2",
    });
    fireEvent.click(toggles[1]!);
    expect(
      slot.inspection.rpcCalls.filter(
        (call) => call.method === "setUserManaged",
      ),
    ).toHaveLength(1);

    finishToggle({ childThreadId: "child-1", userManaged: true });
    await act(async () => pendingToggle);
  });

  it("shows accessible loading, empty, activation-disabled, and error states", async () => {
    const loading = renderQueue({
      rpc: { queueSnapshot: () => new Promise<never>(() => undefined) },
    });
    expect(loading.getByRole("status").getAttribute("aria-busy")).toBe("true");
    loading.lifecycle.unmount();

    const empty = renderQueue({ rpc: { queueSnapshot: () => snapshot([]) } });
    await empty.findByText(/queue is empty/i);
    expect(empty.getByText(/annotation writes are disabled/i)).toBeTruthy();
    expect(empty.queryByRole("heading")).toBeNull();
    empty.lifecycle.unmount();

    const failed = renderQueue({
      rpc: { queueSnapshot: () => Promise.reject(new Error("Server unavailable")) },
    });
    expect((await failed.findByRole("alert")).textContent).toContain(
      "Server unavailable",
    );
  });

  it("keeps hidden or cross-project snapshot rows and refreshes a rename every 15 seconds", async () => {
    vi.useFakeTimers();
    let title = "Hidden cross-project child";
    const slot = renderQueue({
      rpc: {
        queueSnapshot: () => snapshot([row({ title })]),
      },
      sidebarThreads: { threads: [] },
    });
    await act(async () => Promise.resolve());
    expect(slot.getByText("Hidden cross-project child")).toBeTruthy();

    title = "Renamed hidden child";
    await act(async () => vi.advanceTimersByTimeAsync(15_000));
    expect(slot.getByText("Renamed hidden child")).toBeTruthy();
    expect(slot.inspection.rpcCalls).toHaveLength(2);
  });

  it("coalesces a burst of invalidations into one trailing refresh", async () => {
    vi.useFakeTimers();
    const slot = renderQueue({
      rpc: { queueSnapshot: () => snapshot() },
    });
    await act(async () => Promise.resolve());
    expect(slot.inspection.rpcCalls).toHaveLength(1);

    await slot.behavior.emitRealtime("queue-invalidated", { reason: "one" });
    await slot.behavior.emitRealtime("queue-invalidated", { reason: "two" });
    await slot.behavior.emitRealtime("queue-invalidated", { reason: "three" });
    expect(slot.inspection.rpcCalls).toHaveLength(1);

    await act(async () => vi.advanceTimersByTimeAsync(100));
    expect(slot.inspection.rpcCalls).toHaveLength(2);
  });

  it("refetches after realtime invalidation and reconnect", async () => {
    const slot = renderQueue({
      rpc: { queueSnapshot: () => snapshot() },
      realtimeConnectionState: "connected",
    });
    await slot.findByText("Review child result");
    await slot.behavior.emitRealtime("queue-invalidated", {
      threadId: "child-1",
      reason: "thread.idle",
    });
    await waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(2));
    await slot.behavior.setRealtimeConnectionState("reconnecting");
    await slot.behavior.setRealtimeConnectionState("connected");
    await waitFor(() => expect(slot.inspection.rpcCalls).toHaveLength(3));
  });
});
