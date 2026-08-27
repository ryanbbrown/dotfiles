import { randomUUID } from "node:crypto";
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { decodeLaunchArtifact, decodeOutcomeArtifact } from "./artifacts.js";
import { JobStore, type Job } from "./store.js";

const POLL_MS = 1_000;
const NOT_FOUND_WINDOW_MS = 30_000;
const LAUNCH_DEADLINE_MS = 120_000;
const MAX_BACKOFF_MS = 300_000;
const OUTCOME_INSPECTION_DEADLINE_MS = 30_000;
const MESSAGE_MAX_CHARS = 12_000;

function errorText(error: unknown, max = 1_000): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function structuredValue(error: unknown, keys: readonly string[]): unknown {
  let current = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (typeof current !== "object" || current === null) return undefined;
    const record = current as Record<string, unknown>;
    for (const key of keys) {
      if (record[key] !== undefined) return record[key];
    }
    current = record.cause ?? record.response;
  }
  return undefined;
}

function statusCode(error: unknown): number | null {
  const value = structuredValue(error, ["status", "statusCode"]);
  return Number.isInteger(value) ? (value as number) : null;
}

function errorCode(error: unknown): string | null {
  const value = structuredValue(error, ["code"]);
  return typeof value === "string" ? value : null;
}

function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function isNotFound(error: unknown): boolean {
  const code = errorCode(error);
  return statusCode(error) === 404 || code === "ENOENT" || code === "not_found" || code === "terminal_not_found";
}

function isDefiniteCreateRejection(error: unknown): boolean {
  const status = statusCode(error);
  return status !== null && status >= 400 && status < 500 && !isRetryableHttpStatus(status);
}

function isPermanentDeliveryError(error: unknown): boolean {
  const status = statusCode(error);
  if (status !== null) {
    if (isRetryableHttpStatus(status)) return false;
    return status >= 400 && status < 500;
  }
  return [
    "archived",
    "deleted",
    "forbidden",
    "not_found",
    "permission_denied",
    "thread_archived",
    "thread_deleted",
  ].includes(errorCode(error) ?? "");
}

function decodeFileContent(file: { content: string; contentEncoding: "base64" | "utf8" }): string {
  return file.contentEncoding === "base64"
    ? Buffer.from(file.content, "base64").toString("utf8")
    : file.content;
}

function validateLaunch(job: Job, content: string) {
  const launch = decodeLaunchArtifact(content);
  if (launch.jobId !== job.jobId) throw new Error("launch job marker conflicts with stored job");
  if (launch.ownerThreadId !== job.ownerThreadId) throw new Error("launch owner marker conflicts with stored owner");
  if (launch.artifactRoot !== job.artifactRoot || launch.jobDirectory !== job.jobDirectory) {
    throw new Error("launch artifact paths conflict with stored paths");
  }
  if (
    launch.launchPath !== job.launchPath ||
    launch.logPath !== job.logPath ||
    launch.outcomePath !== job.outcomePath
  ) {
    throw new Error("launch artifact file paths conflict with stored paths");
  }
  if (JSON.stringify(launch.argv) !== JSON.stringify(job.argv)) {
    throw new Error("launch argv conflicts with stored argv");
  }
  return launch;
}

function validateOutcome(job: Job, content: string) {
  const outcome = decodeOutcomeArtifact(content);
  if (outcome.jobId !== job.jobId) throw new Error("outcome job marker conflicts with stored job");
  if (outcome.ownerThreadId !== job.ownerThreadId) {
    throw new Error("outcome owner marker conflicts with stored owner");
  }
  if (outcome.terminalId !== null && outcome.terminalId !== job.terminalId) {
    throw new Error("outcome terminal marker conflicts with stored terminal");
  }
  if (outcome.logPath !== job.logPath) throw new Error("outcome log path conflicts with stored path");
  return outcome;
}

function bounded(value: string, max: number): string {
  if (value.length <= max) return value;
  const side = Math.floor((max - 1) / 2);
  return `${value.slice(0, side)}…${value.slice(-side)}`;
}

function displayedPath(path: string, max = 1_000): string {
  return bounded(path, max);
}

export function formatCompletion(job: Job): string {
  const terminal = job.terminalId ?? "unknown";
  const status = bounded(job.lastBbStatus ?? "unknown", 256);
  const exitCode = job.exitCode === null ? "unknown" : String(job.exitCode);
  const closeReason = bounded(job.closeReason ?? "unknown", 256);
  let outcome: string;
  let duration: string | null = null;
  if (job.outcomeState === "present" && job.outcome) {
    const commandResult =
      job.outcome.signal !== null
        ? `signal ${bounded(job.outcome.signal, 128)}, shell status ${job.outcome.status}`
        : `exit ${job.outcome.commandExitCode ?? "unknown"}, shell status ${job.outcome.status}`;
    const terminalMarker = job.outcome.terminalId === null ? "; terminal marker unknown" : "";
    outcome = `${job.outcome.result} (${commandResult}${terminalMarker})`;
    duration = `Duration: ${job.outcome.durationMs} ms`;
  } else if (job.outcomeState === "not-applicable") {
    outcome = "not applicable; watched terminals have no runner outcome and no scrollback was recovered";
  } else {
    const detail = job.outcomeError ? ` (${bounded(job.outcomeError, 1_000)})` : "";
    outcome = `${job.outcomeState}; command success is unknown${detail}`;
  }

  const mandatory = [
    job.marker,
    `Terminal: ${terminal}`,
    `BB status: ${status}; exit: ${exitCode}; close reason: ${closeReason}`,
    `Runner outcome: ${outcome}`,
    `Status: bb terminal-job show ${job.jobId} --json`,
  ];
  const optional = [
    `Terminal job completed: ${bounded(job.title, 1_000)}`,
    ...(duration ? [duration] : []),
    `Log: ${displayedPath(job.logPath)}`,
    `Outcome: ${job.outcomePath ? displayedPath(job.outcomePath) : "not applicable"}`,
  ];
  let message = [...mandatory.slice(0, 1), ...optional, ...mandatory.slice(1)].join("\n");
  if (message.length > MESSAGE_MAX_CHARS) {
    message = [
      ...mandatory.slice(0, 1),
      "Terminal job completed.",
      `Log: ${displayedPath(job.logPath, 200)}`,
      `Outcome: ${job.outcomePath ? displayedPath(job.outcomePath, 200) : "not applicable"}`,
      ...mandatory.slice(1),
    ].join("\n");
  }
  if (message.length > MESSAGE_MAX_CHARS) {
    throw new Error(`completion message invariant exceeded ${MESSAGE_MAX_CHARS} characters`);
  }
  return message;
}

export class TerminalJobService {
  constructor(
    private readonly bb: BbPluginApi,
    private readonly store: JobStore,
  ) {}

  recoverReservations(serviceToken: string, now = Date.now()): number {
    return this.store.recoverForeignReservations(serviceToken, now);
  }

  async processPass(serviceToken: string, now = Date.now()): Promise<void> {
    for (const initial of this.store.unresolved(100)) {
      await this.reconcile(initial, now);
    }
    for (const due of this.store.dueDeliveries(now, 100)) {
      await this.deliver(due, serviceToken, now);
    }
  }

  private async reconcile(initial: Job, now: number): Promise<void> {
    let job = initial;
    if (job.terminalState === "preparing") {
      job = await this.recoverPreparing(job, now);
    }
    if (job.terminalState === "observing" && job.terminalId) {
      job = await this.pollTerminal(job, now);
    }
    if (
      ["exited", "unavailable", "launch_ambiguous"].includes(job.terminalState) &&
      job.outcomeState === "unchecked"
    ) {
      await this.inspectOutcome(job, now);
    }
  }

  private settleLaunchAmbiguous(job: Job, detail: string, now: number): Job {
    return this.store.update(
      job.jobId,
      {
        terminalState: "launch_ambiguous",
        lastObservationError: detail,
        observedAt: now,
      },
      now,
    );
  }

  private async recoverPreparing(job: Job, now: number): Promise<Job> {
    if (!job.launchPath) throw new Error(`preparing job ${job.jobId} has no launch path`);
    let content: string;
    try {
      const file = await this.bb.sdk.files.read({
        hostId: job.hostId,
        rootPath: job.artifactRoot,
        path: job.launchPath,
      });
      content = decodeFileContent(file);
    } catch (error) {
      if (now - job.createdAt >= LAUNCH_DEADLINE_MS) {
        return this.settleLaunchAmbiguous(
          job,
          "Terminal creation acceptance and terminal identity are unknown; an orphan terminal is possible.",
          now,
        );
      }
      const message = isNotFound(error)
        ? "launch marker is not available"
        : `launch reconciliation failed: ${errorText(error)}`;
      return this.store.update(
        job.jobId,
        { lastObservationError: message, observedAt: now },
        now,
      );
    }

    let launch: ReturnType<typeof decodeLaunchArtifact>;
    try {
      launch = validateLaunch(job, content);
    } catch (error) {
      return this.settleLaunchAmbiguous(
        job,
        `Launch marker is invalid: ${errorText(error)}`,
        now,
      );
    }
    if (launch.terminalId) {
      return this.store.update(
        job.jobId,
        {
          terminalId: launch.terminalId,
          terminalState: "observing",
          lastObservationError: null,
          observedAt: now,
        },
        now,
      );
    }
    if (now - job.createdAt >= LAUNCH_DEADLINE_MS) {
      return this.settleLaunchAmbiguous(
        job,
        "Launch marker has no terminal ID after the launch deadline; terminal identity is unknown.",
        now,
      );
    }
    return this.store.update(
      job.jobId,
      {
        lastObservationError: "launch marker has no terminal ID; launch acceptance remains unknown",
        observedAt: now,
      },
      now,
    );
  }

  private async pollTerminal(job: Job, now: number): Promise<Job> {
    try {
      const terminal = await this.bb.sdk.terminals.get({ terminalId: job.terminalId! });
      if (terminal.status === "exited") {
        return this.store.update(
          job.jobId,
          {
            terminalState: "exited",
            lastBbStatus: terminal.status,
            exitCode: terminal.exitCode,
            closeReason: terminal.closeReason,
            lastObservationError: null,
            observedAt: now,
            exitedAt: now,
          },
          now,
        );
      }
      return this.store.update(
        job.jobId,
        {
          lastBbStatus: terminal.status,
          lastObservationError: null,
          observedAt: now,
        },
        now,
      );
    } catch (error) {
      const message = errorText(error);
      if (isNotFound(error) && now - job.createdAt >= NOT_FOUND_WINDOW_MS) {
        return this.store.update(
          job.jobId,
          {
            terminalState: "unavailable",
            exitCode: null,
            closeReason: null,
            lastObservationError: `terminal unavailable after consistency window: ${message}`,
            observedAt: now,
          },
          now,
        );
      }
      return this.store.update(
        job.jobId,
        { lastObservationError: `terminal observation failed: ${message}`, observedAt: now },
        now,
      );
    }
  }

  private async inspectOutcome(job: Job, now: number): Promise<Job> {
    if (job.source === "watch") {
      return this.store.update(
        job.jobId,
        { outcomeState: "not-applicable", outcomeCheckedAt: now },
        now,
      );
    }
    if (!job.outcomePath) throw new Error(`run job ${job.jobId} has no outcome path`);
    try {
      const file = await this.bb.sdk.files.read({
        hostId: job.hostId,
        rootPath: job.artifactRoot,
        path: job.outcomePath,
      });
      try {
        const outcome = validateOutcome(job, decodeFileContent(file));
        return this.store.update(
          job.jobId,
          {
            outcomeState: "present",
            outcome,
            outcomeError: outcome.terminalId === null ? "runner terminal marker is unknown" : null,
            outcomeCheckedAt: now,
          },
          now,
        );
      } catch (error) {
        return this.store.update(
          job.jobId,
          {
            outcomeState: "invalid",
            outcomeError: errorText(error),
            outcomeCheckedAt: now,
          },
          now,
        );
      }
    } catch (error) {
      if (!isNotFound(error)) {
        const inspectionStartedAt = job.exitedAt ?? job.observedAt ?? job.createdAt;
        const detail = errorText(error);
        if (now - inspectionStartedAt >= OUTCOME_INSPECTION_DEADLINE_MS) {
          return this.store.update(
            job.jobId,
            {
              outcomeState: "invalid",
              outcomeError: `outcome read failed through inspection deadline: ${detail}`,
              outcomeCheckedAt: now,
            },
            now,
          );
        }
        return this.store.update(
          job.jobId,
          {
            outcomeError: `outcome read failed and will retry: ${detail}`,
            outcomeCheckedAt: now,
          },
          now,
        );
      }
      return this.store.update(
        job.jobId,
        {
          outcomeState: "missing",
          outcomeError: "runner outcome file is missing; command success is unknown",
          outcomeCheckedAt: now,
        },
        now,
      );
    }
  }

  private async deliver(job: Job, serviceToken: string, now: number): Promise<void> {
    const reserved = this.store.reserveDelivery(job.jobId, serviceToken, now);
    if (!reserved) return;
    try {
      // SDK 0.4.18's portable interface loses inherited send fields under skipLibCheck.
      const sendArgs = {
        threadId: reserved.ownerThreadId,
        mode: reserved.deliveryMode === "steer" ? "steer-if-active" : "queue-if-active",
        input: [{ type: "text", text: formatCompletion(reserved) }],
      } as unknown as Parameters<BbPluginApi["sdk"]["threads"]["send"]>[0];
      const response = await this.bb.sdk.threads.send(sendArgs);
      const delivery = (response as unknown as { delivery?: unknown }).delivery;
      if (!["sent", "queued", "deferred"].includes(String(delivery))) {
        throw new Error("BB accepted a thread send without a recognized delivery result");
      }
      this.store.completeDelivery(
        reserved.jobId,
        serviceToken,
        delivery as "sent" | "queued" | "deferred",
        Date.now(),
      );
    } catch (error) {
      const message = errorText(error);
      const permanent = isPermanentDeliveryError(error);
      const delay = Math.min(
        MAX_BACKOFF_MS,
        1_000 * 2 ** Math.min(20, Math.max(0, reserved.deliveryAttemptCount - 1)),
      );
      this.store.failDelivery(
        reserved.jobId,
        serviceToken,
        permanent ? "abandoned" : "retry_wait",
        message,
        permanent ? null : Date.now() + delay,
        Date.now(),
      );
    }
  }
}

export function definiteCreateFailure(error: unknown): boolean {
  return isDefiniteCreateRejection(error);
}

export function createServiceLoop(
  service: TerminalJobService,
  store: JobStore,
  waitForWake: (delayMs: number, signal: AbortSignal) => Promise<void>,
) {
  return async (signal: AbortSignal): Promise<void> => {
    const token = `service_${randomUUID()}`;
    service.recoverReservations(token);
    while (!signal.aborted) {
      await service.processPass(token);
      const next = store.nextDeliveryAt();
      const delay = Math.max(0, Math.min(POLL_MS, next === null ? POLL_MS : next - Date.now()));
      await waitForWake(delay, signal);
    }
  };
}
