import { describe, expect, it } from "vitest";
import { projectQueue, projectThread, type Annotation, type ThreadFacts } from "./projection.js";

function facts(overrides: Partial<ThreadFacts> = {}): ThreadFacts {
  return {
    id: "child-1",
    title: "Child one",
    status: "idle",
    queuedWork: "none",
    archivedAt: null,
    deletedAt: null,
    latestCompletionSeq: 0,
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

  it("makes every user-managed idle thread need a response", () => {
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

  it.each([
    [{ status: "paused" }, "Unsupported BB thread status: paused"],
    [{ queuedWork: "blocked" }, "Unsupported BB queued-work state: blocked"],
  ])("fails the snapshot for an unknown BB contract value", (override, message) => {
    expect(() => projectQueue([facts(override)], new Map())).toThrow(message);
  });
});
