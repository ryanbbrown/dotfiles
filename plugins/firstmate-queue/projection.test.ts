import { describe, expect, it } from "vitest";
import type { QueueRow } from "./contract.js";
import {
  projectQueue,
  projectThread,
  type Annotation,
  type ThreadFacts,
} from "./projection.js";

function facts(overrides: Partial<ThreadFacts> = {}): ThreadFacts {
  return {
    id: "child-1",
    title: "Child one",
    status: "idle",
    queuedWork: "none",
    archivedAt: null,
    deletedAt: null,
    latestCompletionSeq: 0,
    hasActiveNativeTerminal: false,
    updatedAt: 1_000,
    ...overrides,
  };
}

function annotation(overrides: Partial<Annotation> = {}): Annotation {
  return {
    threadId: "child-1",
    summaryMarkdown: "Reviewed summary",
    idleDisposition: "needs_response",
    reviewedThroughSeq: 10,
    userManaged: false,
    summaryUpdatedAt: 100,
    dispositionUpdatedAt: 100,
    modeUpdatedAt: null,
    ...overrides,
  };
}

describe("projectThread", () => {
  it.each([
    ["pending", "none", "in_progress", "running"],
    ["starting", "none", "in_progress", "running"],
    ["active", "none", "in_progress", "running"],
    ["stopping", "none", "in_progress", "running"],
    ["idle", "waiting", "in_progress", "waiting"],
    ["active", "waiting", "in_progress", "waiting"],
    ["error", "none", "needs_response", "error"],
    ["idle", "failed", "needs_response", "queued_failed"],
    ["active", "failed", "needs_response", "queued_failed"],
  ] as const)(
    "projects %s with queued work %s into %s",
    (status, queuedWork, section, state) => {
      expect(projectThread(facts({ status, queuedWork }), null)).toMatchObject({
        section,
        state,
      });
    },
  );

  it("keeps explicit durable failure text above an old annotated summary", () => {
    const done = annotation({
      idleDisposition: "done",
      summaryMarkdown: "Earlier successful result",
    });
    expect(projectThread(facts({ status: "error" }), done)).toMatchObject({
      section: "needs_response",
      detail: "Thread failed",
      summaryMarkdown: "Earlier successful result",
    });
    expect(projectThread(facts({ queuedWork: "failed" }), done)).toMatchObject({
      section: "needs_response",
      detail: "Queued work failed",
      summaryMarkdown: "Earlier successful result",
    });
  });

  it("projects an idle thread with an active native terminal as in progress", () => {
    expect(
      projectThread(facts({ hasActiveNativeTerminal: true }), null),
    ).toMatchObject({
      section: "in_progress",
      state: "running",
      statusLabel: "Active",
      detail: "Native terminal is active",
    });
    expect(
      projectThread(
        facts({ hasActiveNativeTerminal: true }),
        annotation({ userManaged: true }),
      ),
    ).toMatchObject({ section: "in_progress", statusLabel: "Active" });
  });

  it.each([
    [
      { status: "error", hasActiveNativeTerminal: true },
      "needs_response",
      "error",
      "Error",
    ],
    [
      { queuedWork: "failed", hasActiveNativeTerminal: true },
      "needs_response",
      "queued_failed",
      "Idle",
    ],
    [
      { queuedWork: "waiting", hasActiveNativeTerminal: true },
      "in_progress",
      "waiting",
      "Idle",
    ],
    [
      { status: "active", hasActiveNativeTerminal: true },
      "in_progress",
      "running",
      "Active",
    ],
  ] as const)(
    "keeps existing failure, queued-work, and provider priority for %o",
    (overrides, section, state, expectedStatusLabel) => {
      expect(projectThread(facts(overrides), null)).toMatchObject({
        section,
        state,
        statusLabel: expectedStatusLabel,
      });
    },
  );

  it("keeps every otherwise-idle user-managed thread in Needs your response", () => {
    expect(
      projectThread(
        facts({ latestCompletionSeq: 30 }),
        annotation({ userManaged: true, idleDisposition: "done" }),
      ),
    ).toMatchObject({ section: "needs_response", state: "user_managed" });
  });

  it("marks an unannotated completion as New result and a new idle child as awaiting review", () => {
    expect(
      projectThread(facts({ latestCompletionSeq: 4 }), null),
    ).toMatchObject({ detail: "New result", state: "new_result" });
    expect(projectThread(facts(), null)).toMatchObject({
      detail: "Awaiting Firstmate review",
      state: "awaiting_review",
    });
  });

  it("keeps the prior summary as context for a New result", () => {
    expect(
      projectThread(
        facts({ latestCompletionSeq: 11 }),
        annotation({
          reviewedThroughSeq: 10,
          idleDisposition: "done",
          summaryMarkdown: "Earlier reviewed result",
        }),
      ),
    ).toMatchObject({
      section: "needs_response",
      state: "new_result",
      detail: "New result",
      summaryMarkdown: "Earlier reviewed result",
    });
  });

  it("uses the review cursor boundary and stored idle disposition", () => {
    expect(
      projectThread(
        facts({ latestCompletionSeq: 10 }),
        annotation({ reviewedThroughSeq: 10, idleDisposition: "done" }),
      ),
    ).toMatchObject({ section: "done", state: "done" });
    expect(
      projectThread(
        facts({ latestCompletionSeq: 11 }),
        annotation({ reviewedThroughSeq: 10, idleDisposition: "done" }),
      ),
    ).toMatchObject({ section: "needs_response", state: "new_result" });
    expect(
      projectThread(
        facts({ latestCompletionSeq: 10 }),
        annotation({ reviewedThroughSeq: 10, idleDisposition: "needs_response" }),
      ),
    ).toMatchObject({ section: "needs_response", state: "needs_response" });
  });

  it("omits archived and deleted rows", () => {
    expect(projectThread(facts({ archivedAt: 1 }), annotation())).toBeNull();
    expect(projectThread(facts({ deletedAt: 1 }), annotation())).toBeNull();
  });

  it("sorts newest first inside every section with thread-ID ties", () => {
    const threads = [
      facts({ id: "needs-old", latestCompletionSeq: 1, updatedAt: 100 }),
      facts({ id: "progress-old", status: "active", updatedAt: 200 }),
      facts({ id: "done-old", updatedAt: 300 }),
      facts({ id: "needs-z", latestCompletionSeq: 1, updatedAt: 500 }),
      facts({ id: "progress-new", status: "active", updatedAt: 600 }),
      facts({ id: "done-new", updatedAt: 700 }),
      facts({ id: "needs-a", latestCompletionSeq: 1, updatedAt: 500 }),
    ];
    const annotations = new Map([
      [
        "done-old",
        annotation({ threadId: "done-old", idleDisposition: "done" }),
      ],
      [
        "done-new",
        annotation({ threadId: "done-new", idleDisposition: "done" }),
      ],
    ]);
    const rows = projectQueue(threads, annotations);
    const idsIn = (section: QueueRow["section"]) =>
      rows.filter((row) => row.section === section).map((row) => row.id);

    expect(idsIn("needs_response")).toEqual([
      "needs-a",
      "needs-z",
      "needs-old",
    ]);
    expect(idsIn("in_progress")).toEqual(["progress-new", "progress-old"]);
    expect(idsIn("done")).toEqual(["done-new", "done-old"]);
  });

  it.each([
    [{ status: "paused" }, "Unsupported BB thread status: paused"],
    [{ queuedWork: "blocked" }, "Unsupported BB queued-work state: blocked"],
  ])("fails the snapshot for an unknown BB contract value", (override, message) => {
    expect(() => projectQueue([facts(override)], new Map())).toThrow(message);
  });
});
