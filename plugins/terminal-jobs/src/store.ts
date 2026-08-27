import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { decodeOutcomeArtifact, type OutcomeArtifact } from "./artifacts.js";

export const TERMINAL_STATES = [
  "preparing",
  "observing",
  "exited",
  "launch_ambiguous",
  "unavailable",
] as const;
export const OUTCOME_STATES = [
  "unchecked",
  "present",
  "missing",
  "invalid",
  "not-applicable",
] as const;
export const DELIVERY_STATES = [
  "pending",
  "delivering",
  "delivered",
  "retry_wait",
  "abandoned",
] as const;

export type TerminalState = (typeof TERMINAL_STATES)[number];
export type OutcomeState = (typeof OUTCOME_STATES)[number];
export type DeliveryState = (typeof DELIVERY_STATES)[number];
export type JobSource = "run" | "watch";
export type DeliveryMode = "queue" | "steer";
export type Scope =
  | { kind: "thread"; threadId: string }
  | { kind: "environment"; environmentId: string }
  | { kind: "machine"; hostId: string; cwd: string | null };

type Database = ReturnType<BbPluginApi["storage"]["database"]>;

export interface Job {
  jobId: string;
  marker: string;
  source: JobSource;
  schemaVersion: number;
  ownerThreadId: string;
  deliveryMode: DeliveryMode;
  title: string;
  scope: Scope;
  hostId: string;
  argv: string[];
  createdAt: number;
  artifactRoot: string;
  jobDirectory: string | null;
  launchPath: string | null;
  logPath: string;
  outcomePath: string | null;
  terminalId: string | null;
  terminalState: TerminalState;
  lastBbStatus: string | null;
  exitCode: number | null;
  closeReason: string | null;
  lastObservationError: string | null;
  observedAt: number | null;
  exitedAt: number | null;
  outcomeState: OutcomeState;
  outcome: OutcomeArtifact | null;
  outcomeError: string | null;
  outcomeCheckedAt: number | null;
  deliveryState: DeliveryState;
  deliveryAttemptCount: number;
  nextAttemptAt: number | null;
  deliveryLastError: string | null;
  acceptedDeliveryKind: "sent" | "queued" | "deferred" | null;
  reservationToken: string | null;
  ambiguousAttemptCount: number;
  deliveryAttemptedAt: number | null;
  deliveredAt: number | null;
  updatedAt: number;
}

const MIGRATIONS = [
  `
  CREATE TABLE jobs (
    job_id TEXT PRIMARY KEY,
    marker TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL CHECK (source IN ('run', 'watch')),
    schema_version INTEGER NOT NULL,
    owner_thread_id TEXT NOT NULL,
    delivery_mode TEXT NOT NULL CHECK (delivery_mode IN ('queue', 'steer')),
    title TEXT NOT NULL,
    scope_kind TEXT NOT NULL CHECK (scope_kind IN ('thread', 'environment', 'machine')),
    scope_json TEXT NOT NULL,
    host_id TEXT NOT NULL,
    argv_json TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    artifact_root TEXT NOT NULL,
    job_directory TEXT,
    launch_path TEXT,
    log_path TEXT NOT NULL,
    outcome_path TEXT,
    terminal_id TEXT,
    terminal_state TEXT NOT NULL CHECK (terminal_state IN ('preparing', 'observing', 'exited', 'launch_ambiguous', 'unavailable')),
    last_bb_status TEXT,
    exit_code INTEGER,
    close_reason TEXT,
    last_observation_error TEXT,
    observed_at INTEGER,
    exited_at INTEGER,
    outcome_state TEXT NOT NULL CHECK (outcome_state IN ('unchecked', 'present', 'missing', 'invalid', 'not-applicable')),
    outcome_json TEXT,
    outcome_error TEXT,
    outcome_checked_at INTEGER,
    delivery_state TEXT NOT NULL CHECK (delivery_state IN ('pending', 'delivering', 'delivered', 'retry_wait', 'abandoned')),
    delivery_attempt_count INTEGER NOT NULL DEFAULT 0,
    next_attempt_at INTEGER,
    delivery_last_error TEXT,
    accepted_delivery_kind TEXT CHECK (accepted_delivery_kind IN ('sent', 'queued', 'deferred')),
    reservation_token TEXT,
    ambiguous_attempt_count INTEGER NOT NULL DEFAULT 0,
    delivery_attempted_at INTEGER,
    delivered_at INTEGER,
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX jobs_unresolved_terminal ON jobs(terminal_state, created_at);
  CREATE INDEX jobs_due_delivery ON jobs(delivery_state, next_attempt_at);
  `,
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseJson(value: unknown, label: string): unknown {
  if (typeof value !== "string") throw new Error(`${label} is not JSON text`);
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`${label} is malformed JSON`);
  }
}

function decodeScope(kind: unknown, raw: unknown): Scope {
  const value = parseJson(raw, "scope_json");
  if (!isRecord(value) || value.kind !== kind) throw new Error("invalid stored scope");
  const keys = Object.keys(value).sort().join(",");
  if (kind === "thread" && keys === "kind,threadId" && typeof value.threadId === "string") {
    return { kind: "thread", threadId: value.threadId };
  }
  if (
    kind === "environment" &&
    keys === "environmentId,kind" &&
    typeof value.environmentId === "string"
  ) {
    return { kind: "environment", environmentId: value.environmentId };
  }
  if (
    kind === "machine" &&
    keys === "cwd,hostId,kind" &&
    typeof value.hostId === "string" &&
    (typeof value.cwd === "string" || value.cwd === null)
  ) {
    return { kind: "machine", hostId: value.hostId, cwd: value.cwd };
  }
  throw new Error("invalid stored scope");
}

function requiredText(row: Record<string, unknown>, key: string): string {
  if (typeof row[key] !== "string") throw new Error(`invalid ${key}`);
  return row[key];
}
function nullableText(row: Record<string, unknown>, key: string): string | null {
  if (row[key] !== null && typeof row[key] !== "string") throw new Error(`invalid ${key}`);
  return row[key] as string | null;
}
function integer(row: Record<string, unknown>, key: string): number {
  if (!Number.isInteger(row[key])) throw new Error(`invalid ${key}`);
  return row[key] as number;
}
function nullableInteger(row: Record<string, unknown>, key: string): number | null {
  if (row[key] !== null && !Number.isInteger(row[key])) throw new Error(`invalid ${key}`);
  return row[key] as number | null;
}
function enumValue<T extends string>(
  row: Record<string, unknown>,
  key: string,
  values: readonly T[],
): T {
  if (!values.includes(row[key] as T)) throw new Error(`invalid ${key}`);
  return row[key] as T;
}

function decodeJob(value: unknown): Job {
  if (!isRecord(value)) throw new Error("database returned an invalid job row");
  const argv = parseJson(value.argv_json, "argv_json");
  if (!Array.isArray(argv) || argv.some((item) => typeof item !== "string")) {
    throw new Error("invalid argv_json");
  }
  const outcomeValue =
    value.outcome_json === null
      ? null
      : decodeOutcomeArtifact(requiredText(value, "outcome_json"));
  const outcomeState = enumValue(value, "outcome_state", OUTCOME_STATES);
  const deliveryState = enumValue(value, "delivery_state", DELIVERY_STATES);
  if ((outcomeState === "present") !== (outcomeValue !== null)) {
    throw new Error("stored outcome state and artifact conflict");
  }
  if (deliveryState === "delivering" && typeof value.reservation_token !== "string") {
    throw new Error("delivering job has no reservation token");
  }
  if (deliveryState === "retry_wait" && !Number.isInteger(value.next_attempt_at)) {
    throw new Error("retrying job has no next attempt time");
  }
  if (
    deliveryState === "delivered" &&
    (!["sent", "queued", "deferred"].includes(String(value.accepted_delivery_kind)) ||
      !Number.isInteger(value.delivered_at))
  ) {
    throw new Error("delivered job has no accepted delivery record");
  }
  return {
    jobId: requiredText(value, "job_id"),
    marker: requiredText(value, "marker"),
    source: enumValue(value, "source", ["run", "watch"]),
    schemaVersion: integer(value, "schema_version"),
    ownerThreadId: requiredText(value, "owner_thread_id"),
    deliveryMode: enumValue(value, "delivery_mode", ["queue", "steer"]),
    title: requiredText(value, "title"),
    scope: decodeScope(value.scope_kind, value.scope_json),
    hostId: requiredText(value, "host_id"),
    argv,
    createdAt: integer(value, "created_at"),
    artifactRoot: requiredText(value, "artifact_root"),
    jobDirectory: nullableText(value, "job_directory"),
    launchPath: nullableText(value, "launch_path"),
    logPath: requiredText(value, "log_path"),
    outcomePath: nullableText(value, "outcome_path"),
    terminalId: nullableText(value, "terminal_id"),
    terminalState: enumValue(value, "terminal_state", TERMINAL_STATES),
    lastBbStatus: nullableText(value, "last_bb_status"),
    exitCode: nullableInteger(value, "exit_code"),
    closeReason: nullableText(value, "close_reason"),
    lastObservationError: nullableText(value, "last_observation_error"),
    observedAt: nullableInteger(value, "observed_at"),
    exitedAt: nullableInteger(value, "exited_at"),
    outcomeState,
    outcome: outcomeValue as OutcomeArtifact | null,
    outcomeError: nullableText(value, "outcome_error"),
    outcomeCheckedAt: nullableInteger(value, "outcome_checked_at"),
    deliveryState,
    deliveryAttemptCount: integer(value, "delivery_attempt_count"),
    nextAttemptAt: nullableInteger(value, "next_attempt_at"),
    deliveryLastError: nullableText(value, "delivery_last_error"),
    acceptedDeliveryKind:
      value.accepted_delivery_kind === null
        ? null
        : (enumValue(value, "accepted_delivery_kind", [
            "sent",
            "queued",
            "deferred",
          ]) as "sent" | "queued" | "deferred"),
    reservationToken: nullableText(value, "reservation_token"),
    ambiguousAttemptCount: integer(value, "ambiguous_attempt_count"),
    deliveryAttemptedAt: nullableInteger(value, "delivery_attempted_at"),
    deliveredAt: nullableInteger(value, "delivered_at"),
    updatedAt: integer(value, "updated_at"),
  };
}

export interface NewJob {
  jobId: string;
  source: JobSource;
  ownerThreadId: string;
  deliveryMode: DeliveryMode;
  title: string;
  scope: Scope;
  hostId: string;
  argv: string[];
  createdAt: number;
  artifactRoot: string;
  jobDirectory: string | null;
  launchPath: string | null;
  logPath: string;
  outcomePath: string | null;
  terminalId?: string | null;
  terminalState: TerminalState;
  lastBbStatus?: string | null;
  outcomeState: OutcomeState;
}

export class JobStore {
  constructor(private readonly db: Database) {}

  static open(bb: BbPluginApi): JobStore {
    const db = bb.storage.database();
    bb.storage.migrate(db, MIGRATIONS);
    return new JobStore(db);
  }

  insert(job: NewJob): Job {
    this.db
      .prepare(`
        INSERT INTO jobs (
          job_id, marker, source, schema_version, owner_thread_id, delivery_mode,
          title, scope_kind, scope_json, host_id, argv_json, created_at,
          artifact_root, job_directory, launch_path, log_path, outcome_path,
          terminal_id, terminal_state, last_bb_status, outcome_state,
          delivery_state, updated_at
        ) VALUES (
          @jobId, @marker, @source, 1, @ownerThreadId, @deliveryMode,
          @title, @scopeKind, @scopeJson, @hostId, @argvJson, @createdAt,
          @artifactRoot, @jobDirectory, @launchPath, @logPath, @outcomePath,
          @terminalId, @terminalState, @lastBbStatus, @outcomeState,
          'pending', @createdAt
        )
      `)
      .run({
        ...job,
        marker: `[terminal-job:${job.jobId}]`,
        scopeKind: job.scope.kind,
        scopeJson: JSON.stringify(job.scope),
        argvJson: JSON.stringify(job.argv),
        terminalId: job.terminalId ?? null,
        lastBbStatus: job.lastBbStatus ?? null,
      });
    return this.get(job.jobId)!;
  }

  get(jobId: string): Job | null {
    const row = this.db.prepare("SELECT * FROM jobs WHERE job_id = ?").get(jobId);
    return row === undefined ? null : decodeJob(row);
  }

  unresolved(limit = 100): Job[] {
    return this.db
      .prepare(
        `SELECT * FROM jobs
         WHERE terminal_state IN ('preparing', 'observing')
            OR (terminal_state IN ('exited', 'launch_ambiguous', 'unavailable')
              AND outcome_state = 'unchecked')
         ORDER BY created_at LIMIT ?`,
      )
      .all(limit)
      .map(decodeJob);
  }

  dueDeliveries(now: number, limit = 100): Job[] {
    return this.db
      .prepare(
        `SELECT * FROM jobs
         WHERE terminal_state IN ('exited', 'launch_ambiguous', 'unavailable')
           AND outcome_state <> 'unchecked'
           AND (delivery_state = 'pending'
             OR (delivery_state = 'retry_wait' AND next_attempt_at <= ?))
         ORDER BY created_at LIMIT ?`,
      )
      .all(now, limit)
      .map(decodeJob);
  }

  nextDeliveryAt(): number | null {
    const row = this.db
      .prepare(
        `SELECT MIN(next_attempt_at) AS value FROM jobs
         WHERE delivery_state = 'retry_wait'`,
      )
      .get() as { value: number | null };
    return row.value;
  }

  update(jobId: string, changes: Record<string, unknown>, now = Date.now()): Job {
    const entries = Object.entries(changes);
    if (entries.length === 0) return this.get(jobId)!;
    const columns: Record<string, string> = {
      terminalId: "terminal_id",
      terminalState: "terminal_state",
      lastBbStatus: "last_bb_status",
      exitCode: "exit_code",
      closeReason: "close_reason",
      lastObservationError: "last_observation_error",
      observedAt: "observed_at",
      exitedAt: "exited_at",
      outcomeState: "outcome_state",
      outcome: "outcome_json",
      outcomeError: "outcome_error",
      outcomeCheckedAt: "outcome_checked_at",
      deliveryState: "delivery_state",
      nextAttemptAt: "next_attempt_at",
      deliveryLastError: "delivery_last_error",
      acceptedDeliveryKind: "accepted_delivery_kind",
      reservationToken: "reservation_token",
      deliveryAttemptedAt: "delivery_attempted_at",
      deliveredAt: "delivered_at",
    };
    const values: Record<string, unknown> = { jobId, now };
    const assignments = entries.map(([key, raw], index) => {
      const column = columns[key];
      if (!column) throw new Error(`unsupported job update: ${key}`);
      const parameter = `v${index}`;
      values[parameter] = key === "outcome" && raw !== null ? JSON.stringify(raw) : raw;
      return `${column} = @${parameter}`;
    });
    this.db
      .prepare(`UPDATE jobs SET ${assignments.join(", ")}, updated_at = @now WHERE job_id = @jobId`)
      .run(values);
    return this.get(jobId)!;
  }

  recoverForeignReservations(serviceToken: string, now: number): number {
    return this.db
      .prepare(
        `UPDATE jobs SET
           delivery_state = 'retry_wait', next_attempt_at = ?,
           delivery_last_error = 'Prior delivery acceptance is unknown; retry can duplicate the notice.',
           ambiguous_attempt_count = ambiguous_attempt_count + 1,
           reservation_token = NULL, updated_at = ?
         WHERE delivery_state = 'delivering'
           AND (reservation_token IS NULL OR reservation_token <> ?)`,
      )
      .run(now, now, serviceToken).changes;
  }

  reserveDelivery(jobId: string, serviceToken: string, now: number): Job | null {
    const changed = this.db
      .prepare(
        `UPDATE jobs SET delivery_state = 'delivering', reservation_token = ?,
           delivery_attempt_count = delivery_attempt_count + 1,
           delivery_attempted_at = ?, next_attempt_at = NULL, updated_at = ?
         WHERE job_id = ?
           AND (delivery_state = 'pending'
             OR (delivery_state = 'retry_wait' AND next_attempt_at <= ?))`,
      )
      .run(serviceToken, now, now, jobId, now).changes;
    return changed === 1 ? this.get(jobId) : null;
  }

  completeDelivery(
    jobId: string,
    serviceToken: string,
    kind: "sent" | "queued" | "deferred",
    now: number,
  ): boolean {
    return (
      this.db
        .prepare(
          `UPDATE jobs SET delivery_state = 'delivered', accepted_delivery_kind = ?,
             delivered_at = ?, delivery_last_error = NULL, reservation_token = NULL,
             updated_at = ?
           WHERE job_id = ? AND delivery_state = 'delivering' AND reservation_token = ?`,
        )
        .run(kind, now, now, jobId, serviceToken).changes === 1
    );
  }

  failDelivery(
    jobId: string,
    serviceToken: string,
    state: "retry_wait" | "abandoned",
    error: string,
    nextAttemptAt: number | null,
    now: number,
  ): boolean {
    return (
      this.db
        .prepare(
          `UPDATE jobs SET delivery_state = ?, delivery_last_error = ?,
             next_attempt_at = ?, reservation_token = NULL, updated_at = ?
           WHERE job_id = ? AND delivery_state = 'delivering' AND reservation_token = ?`,
        )
        .run(state, error, nextAttemptAt, now, jobId, serviceToken).changes === 1
    );
  }

  retry(jobId: string, now: number): Job | null {
    const changed = this.db
      .prepare(
        `UPDATE jobs SET delivery_state = 'retry_wait', next_attempt_at = ?,
           delivery_last_error = NULL, reservation_token = NULL, updated_at = ?
         WHERE job_id = ? AND delivery_state IN ('retry_wait', 'abandoned')`,
      )
      .run(now, now, jobId).changes;
    return changed === 1 ? this.get(jobId) : null;
  }
}
