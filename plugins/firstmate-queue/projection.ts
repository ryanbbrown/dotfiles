import type { IdleDisposition, QueueRow } from "./contract.js";

export const THREAD_STATUSES = [
  "pending",
  "starting",
  "active",
  "stopping",
  "idle",
  "error",
] as const;
export const QUEUED_WORK_STATES = ["none", "waiting", "failed"] as const;

export type ThreadStatus = (typeof THREAD_STATUSES)[number];
export type QueuedWork = (typeof QUEUED_WORK_STATES)[number];

export interface ThreadFacts {
  id: string;
  title: string;
  status: unknown;
  queuedWork: unknown;
  archivedAt: number | null;
  deletedAt: number | null;
  latestCompletionSeq: number;
  hasActiveNativeTerminal: boolean;
  hasActiveDescendant: boolean;
  updatedAt: number;
}

export interface Annotation {
  threadId: string;
  summaryMarkdown: string | null;
  idleDisposition: IdleDisposition | null;
  reviewedThroughSeq: number;
  userManaged: boolean;
  summaryUpdatedAt: number | null;
  dispositionUpdatedAt: number | null;
  modeUpdatedAt: number | null;
}

function parseStatus(value: unknown): ThreadStatus {
  if (
    typeof value === "string" &&
    (THREAD_STATUSES as readonly string[]).includes(value)
  ) {
    return value as ThreadStatus;
  }
  throw new Error(`Unsupported BB thread status: ${String(value)}`);
}

function parseQueuedWork(value: unknown): QueuedWork {
  if (
    typeof value === "string" &&
    (QUEUED_WORK_STATES as readonly string[]).includes(value)
  ) {
    return value as QueuedWork;
  }
  throw new Error(`Unsupported BB queued-work state: ${String(value)}`);
}

function statusLabel(status: ThreadStatus): string {
  return status[0]!.toUpperCase() + status.slice(1);
}

function row(
  facts: ThreadFacts,
  annotation: Annotation | null,
  values: Pick<QueueRow, "section" | "state" | "detail"> & {
    statusLabel?: string;
    summaryMarkdown?: string | null;
  },
): QueueRow {
  const status = parseStatus(facts.status);
  return {
    id: facts.id,
    title: facts.title,
    section: values.section,
    state: values.state,
    statusLabel: values.statusLabel ?? statusLabel(status),
    detail: values.detail,
    summaryMarkdown: values.summaryMarkdown ?? null,
    userManaged: annotation?.userManaged ?? false,
    latestCompletionSeq: facts.latestCompletionSeq,
    reviewedThroughSeq: annotation?.reviewedThroughSeq ?? 0,
    updatedAt: facts.updatedAt,
  };
}

function currentReview(
  facts: ThreadFacts,
  annotation: Annotation | null,
): Annotation | null {
  if (
    annotation === null ||
    annotation.idleDisposition === null ||
    annotation.summaryUpdatedAt === null ||
    annotation.dispositionUpdatedAt === null ||
    facts.latestCompletionSeq > annotation.reviewedThroughSeq
  ) {
    return null;
  }
  return annotation;
}

function reviewedSection(
  annotation: Annotation | null,
): QueueRow["section"] {
  if (annotation?.idleDisposition === "needs_response") {
    return "needs_response";
  }
  if (annotation?.idleDisposition === "done") return "done";
  return "in_progress";
}

export function projectThread(
  facts: ThreadFacts,
  annotation: Annotation | null,
): QueueRow | null {
  if (facts.archivedAt !== null || facts.deletedAt !== null) return null;
  const status = parseStatus(facts.status);
  const queuedWork = parseQueuedWork(facts.queuedWork);
  const review = currentReview(facts, annotation);
  const summaryMarkdown = review?.summaryMarkdown ?? null;

  if (status === "error" || queuedWork === "failed") {
    return row(facts, annotation, {
      section: reviewedSection(review),
      state: status === "error" ? "error" : "queued_failed",
      detail: status === "error" ? "Thread failed" : "Queued work failed",
      summaryMarkdown,
    });
  }
  if (queuedWork === "waiting") {
    return row(facts, annotation, {
      section: "in_progress",
      state: "waiting",
      detail: summaryMarkdown ?? "Work is waiting to start",
      summaryMarkdown,
    });
  }
  if (["pending", "starting", "active", "stopping"].includes(status)) {
    return row(facts, annotation, {
      section: "in_progress",
      state: "running",
      detail: summaryMarkdown ?? "Work is in progress",
      summaryMarkdown,
    });
  }
  if (facts.hasActiveNativeTerminal) {
    return row(facts, annotation, {
      section: "in_progress",
      state: "running",
      statusLabel: "Active",
      detail: summaryMarkdown ?? "Native terminal is active",
      summaryMarkdown,
    });
  }
  if (facts.hasActiveDescendant) {
    return row(facts, annotation, {
      section: "in_progress",
      state: "running",
      statusLabel: "Active",
      detail: summaryMarkdown ?? "A descendant thread is active",
      summaryMarkdown,
    });
  }
  if (annotation?.userManaged === true) {
    return row(facts, annotation, {
      section: reviewedSection(review),
      state: "user_managed",
      detail: summaryMarkdown ?? "You are handling this",
      summaryMarkdown,
    });
  }
  if (review?.idleDisposition === "done") {
    return row(facts, annotation, {
      section: "done",
      state: "done",
      detail: summaryMarkdown ?? "Reviewed",
      summaryMarkdown,
    });
  }
  if (review?.idleDisposition === "needs_response") {
    return row(facts, annotation, {
      section: "needs_response",
      state: "needs_response",
      detail: summaryMarkdown ?? "Needs your response",
      summaryMarkdown,
    });
  }
  return row(facts, annotation, {
    section: "in_progress",
    state: "awaiting_review",
    detail: "Awaiting Firstmate review",
  });
}

export function projectQueue(
  facts: readonly ThreadFacts[],
  annotations: ReadonlyMap<string, Annotation>,
): QueueRow[] {
  const rows: QueueRow[] = [];
  for (const thread of facts) {
    const projected = projectThread(thread, annotations.get(thread.id) ?? null);
    if (projected !== null) rows.push(projected);
  }
  return rows.sort((left, right) => {
    if (left.updatedAt !== right.updatedAt) {
      return right.updatedAt - left.updatedAt;
    }
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
  });
}
