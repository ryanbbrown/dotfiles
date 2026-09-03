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
    hasActiveDescendant: false,
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
    ["pending", "none", "running"],
    ["starting", "none", "running"],
    ["active", "none", "running"],
    ["stopping", "none", "running"],
    ["idle", "waiting", "waiting"],
    ["active", "waiting", "waiting"],
    ["error", "none", "error"],
    ["idle", "failed", "queued_failed"],
    ["active", "failed", "queued_failed"],
  ] as const)(
    "keeps %s with queued work %s outside Needs without a review",
    (status, queuedWork, state) => {
      expect(projectThread(facts({ status, queuedWork }), null)).toMatchObject({
        section: "in_progress",
        state,
      });
    },
  );

  it("keeps useful failure detail but hides a stale reviewed summary", () => {
    const prior = annotation({
      idleDisposition: "done",
      summaryMarkdown: "Earlier successful result",
      reviewedThroughSeq: 10,
    });
    expect(
      projectThread(facts({ status: "error", latestCompletionSeq: 11 }), prior),
    ).toMatchObject({
      section: "in_progress",
      state: "error",
      detail: "Thread failed",
      summaryMarkdown: null,
    });
    expect(
      projectThread(facts({ queuedWork: "failed", latestCompletionSeq: 11 }), prior),
    ).toMatchObject({
      section: "in_progress",
      state: "queued_failed",
      detail: "Queued work failed",
      summaryMarkdown: null,
    });
  });

  it("moves failures into Needs only after an explicit needs-response review", () => {
    const needsResponse = annotation({
      idleDisposition: "needs_response",
      summaryMarkdown: "Firstmate reviewed this failure",
    });
    expect(projectThread(facts({ status: "error" }), needsResponse)).toMatchObject({
      section: "needs_response",
      state: "error",
      detail: "Thread failed",
      summaryMarkdown: "Firstmate reviewed this failure",
    });
    expect(
      projectThread(facts({ queuedWork: "failed" }), needsResponse),
    ).toMatchObject({
      section: "needs_response",
      state: "queued_failed",
      detail: "Queued work failed",
    });
  });

  it("projects an idle thread with an active descendant as in progress", () => {
    expect(
      projectThread(facts({ hasActiveDescendant: true }), null),
    ).toMatchObject({
      section: "in_progress",
      state: "running",
      statusLabel: "Active",
      detail: "A descendant thread is active",
    });
    expect(
      projectThread(
        facts({ hasActiveDescendant: true }),
        annotation({ userManaged: true }),
      ),
    ).toMatchObject({ section: "in_progress", statusLabel: "Active" });
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
      {
        status: "error",
        hasActiveNativeTerminal: true,
        hasActiveDescendant: true,
      },
      "error",
      "Error",
    ],
    [
      {
        queuedWork: "failed",
        hasActiveNativeTerminal: true,
        hasActiveDescendant: true,
      },
      "queued_failed",
      "Idle",
    ],
    [
      {
        queuedWork: "waiting",
        hasActiveNativeTerminal: true,
        hasActiveDescendant: true,
      },
      "waiting",
      "Idle",
    ],
    [
      {
        status: "active",
        hasActiveNativeTerminal: true,
        hasActiveDescendant: true,
      },
      "running",
      "Active",
    ],
  ] as const)(
    "keeps existing failure, queued-work, and provider priority for %o",
    (overrides, state, expectedStatusLabel) => {
      expect(projectThread(facts(overrides), null)).toMatchObject({
        section: "in_progress",
        state,
        statusLabel: expectedStatusLabel,
      });
    },
  );

  it("keeps user-managed ownership without synthesizing a Needs row", () => {
    expect(
      projectThread(
        facts(),
        annotation({
          idleDisposition: null,
          summaryMarkdown: null,
          summaryUpdatedAt: null,
          dispositionUpdatedAt: null,
          userManaged: true,
        }),
      ),
    ).toMatchObject({
      section: "in_progress",
      state: "user_managed",
      detail: "You are handling this",
      userManaged: true,
    });
  });

  it("projects unannotated idle children the same with or without a completion", () => {
    for (const latestCompletionSeq of [0, 4]) {
      expect(
        projectThread(facts({ latestCompletionSeq }), null),
      ).toMatchObject({
        section: "in_progress",
        state: "awaiting_review",
        detail: "Awaiting Firstmate review",
        summaryMarkdown: null,
      });
    }
  });

  it.each(["needs_response", "done"] as const)(
    "returns a newer completion after %s to neutral review state",
    (idleDisposition) => {
      expect(
        projectThread(
          facts({ latestCompletionSeq: 11 }),
          annotation({
            reviewedThroughSeq: 10,
            idleDisposition,
            summaryMarkdown: "Earlier reviewed result",
          }),
        ),
      ).toMatchObject({
        section: "in_progress",
        state: "awaiting_review",
        detail: "Awaiting Firstmate review",
        summaryMarkdown: null,
      });
    },
  );

  it.each([
    { status: "active" },
    { hasActiveNativeTerminal: true },
    { hasActiveDescendant: true },
  ] as const)(
    "keeps review/delegation active, then neutralizes its completed result for %o",
    (activeOverride) => {
      const review = annotation({
        reviewedThroughSeq: 10,
        idleDisposition: "needs_response",
        summaryMarkdown: "Review and delegation in progress",
      });
      expect(projectThread(facts(activeOverride), review)).toMatchObject({
        section: "in_progress",
        state: "running",
        detail: "Review and delegation in progress",
      });
      expect(
        projectThread(facts({ latestCompletionSeq: 11 }), review),
      ).toMatchObject({
        section: "in_progress",
        state: "awaiting_review",
        detail: "Awaiting Firstmate review",
        summaryMarkdown: null,
      });
    },
  );

  it("uses only a current explicit disposition for Needs and Done", () => {
    expect(
      projectThread(
        facts({ latestCompletionSeq: 10 }),
        annotation({ reviewedThroughSeq: 10, idleDisposition: "done" }),
      ),
    ).toMatchObject({ section: "done", state: "done" });
    expect(
      projectThread(
        facts({ latestCompletionSeq: 10 }),
        annotation({
          reviewedThroughSeq: 10,
          idleDisposition: "needs_response",
        }),
      ),
    ).toMatchObject({ section: "needs_response", state: "needs_response" });
    expect(
      projectThread(
        facts(),
        annotation({
          summaryMarkdown: null,
          idleDisposition: "needs_response",
          summaryUpdatedAt: null,
        }),
      ),
    ).toMatchObject({ section: "in_progress", state: "awaiting_review" });
  });

  it("omits archived and deleted rows", () => {
    expect(projectThread(facts({ archivedAt: 1 }), annotation())).toBeNull();
    expect(projectThread(facts({ deletedAt: 1 }), annotation())).toBeNull();
  });

  it("sorts newest first inside every section with thread-ID ties", () => {
    const threads = [
      facts({ id: "needs-old", updatedAt: 100 }),
      facts({ id: "progress-old", status: "active", updatedAt: 200 }),
      facts({ id: "done-old", updatedAt: 300 }),
      facts({ id: "needs-z", updatedAt: 500 }),
      facts({ id: "progress-new", status: "active", updatedAt: 600 }),
      facts({ id: "done-new", updatedAt: 700 }),
      facts({ id: "needs-a", updatedAt: 500 }),
    ];
    const annotations = new Map([
      [
        "needs-old",
        annotation({ threadId: "needs-old", idleDisposition: "needs_response" }),
      ],
      [
        "needs-z",
        annotation({ threadId: "needs-z", idleDisposition: "needs_response" }),
      ],
      [
        "needs-a",
        annotation({ threadId: "needs-a", idleDisposition: "needs_response" }),
      ],
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
      rows.filter((projected) => projected.section === section).map((projected) => projected.id);

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
