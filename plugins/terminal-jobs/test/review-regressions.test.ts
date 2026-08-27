import { createRequire } from "node:module";
import { createFakePluginHost, type FakePluginHost } from "@get-bb/plugin-sdk/testing";
import { describe, expect, it } from "vitest";
import plugin from "../server.js";
import {
  ARTIFACT_SCHEMA_VERSION,
  LAUNCH_ARTIFACT_FIELDS,
  OUTCOME_ARTIFACT_FIELDS,
} from "../src/artifacts.js";
import { formatCompletion, TerminalJobService } from "../src/service.js";
import { JobStore } from "../src/store.js";

function terminal(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title: `terminal ${id}`,
    hostId: "host_target",
    threadId: "thr_owner",
    environmentId: "env_target",
    initialCwd: "/workspace",
    status: "running",
    exitCode: null,
    closeReason: null,
    ...overrides,
  };
}

async function loadHost(options: {
  create?: (args: unknown) => unknown;
  get?: (args: { terminalId: string }) => unknown;
  read?: (args: { path: string; rootPath?: string; hostId?: string }) => unknown;
  send?: (args: unknown) => unknown;
} = {}): Promise<FakePluginHost> {
  const host = createFakePluginHost({
    pluginId: "terminal-jobs",
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => ({ id: threadId, environmentId: "env_target" }),
        send: async (args: unknown) => options.send?.(args) ?? { ok: true, delivery: "sent" },
      },
      environments: {
        get: async ({ environmentId }: { environmentId: string }) => ({
          id: environmentId,
          hostId: "host_target",
          path: "/workspace",
        }),
      },
      terminals: {
        create: async (args: unknown) => options.create?.(args) ?? terminal("term_created"),
        get: async (args: { terminalId: string }) => options.get?.(args) ?? terminal(args.terminalId),
      },
      files: {
        read: async (args: { path: string; rootPath?: string; hostId?: string }) => {
          if (options.read) return options.read(args);
          throw Object.assign(new Error("missing"), { status: 404 });
        },
      },
    } as never,
  });
  await plugin(host.bb);
  return host;
}

async function watch(host: FakePluginHost, terminalId: string, log = `/tmp/${terminalId}.log`) {
  const result = await host.harness.behavior.runCli([
    "watch",
    terminalId,
    "--notify-thread",
    "thr_owner",
    "--log",
    log,
    "--json",
  ]);
  expect(result.exitCode, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as { jobId: string; marker: string };
}

async function run(host: FakePluginHost, title: string, artifactRoot = "/tmp/jobs") {
  const result = await host.harness.behavior.runCli(
    ["run", "--title", title, "--artifact-root", artifactRoot, "--json", "--", "true"],
    { threadId: "thr_owner" },
  );
  expect(result.exitCode, result.stderr).toBe(0);
  return JSON.parse(result.stdout) as {
    jobId: string;
    marker: string;
    artifacts: { root: string; directory: string; launch: string; log: string; outcome: string };
  };
}

function service(host: FakePluginHost, onDecodeError: (message: string) => void = () => {}) {
  const store = new JobStore(host.bb.storage.database(), onDecodeError);
  return { store, worker: new TerminalJobService(host.bb, store) };
}

function file(content: string, path: string) {
  return {
    path,
    content,
    contentEncoding: "utf8" as const,
    sha256: "fixture",
    sizeBytes: content.length,
  };
}

function launchFor(
  job: Awaited<ReturnType<typeof run>>,
  overrides: Record<string, unknown> = {},
) {
  return JSON.stringify({
    schemaVersion: 1,
    jobId: job.jobId,
    terminalId: "term_recovered",
    ownerThreadId: "thr_owner",
    argv: ["true"],
    startedAt: "2026-08-27T00:00:00.000Z",
    artifactRoot: job.artifacts.root,
    jobDirectory: job.artifacts.directory,
    launchPath: job.artifacts.launch,
    logPath: job.artifacts.log,
    outcomePath: job.artifacts.outcome,
    ...overrides,
  });
}

function outcomeFor(job: Awaited<ReturnType<typeof run>>, terminalId: string | null = "term_created") {
  return JSON.stringify({
    schemaVersion: 1,
    jobId: job.jobId,
    terminalId,
    ownerThreadId: "thr_owner",
    commandExitCode: 0,
    signal: null,
    status: 0,
    result: "success",
    startedAt: "2026-08-27T00:00:00.000Z",
    finishedAt: "2026-08-27T00:00:01.000Z",
    durationMs: 1_000,
    logPath: job.artifacts.log,
  });
}

describe("required implementation-review regressions", () => {
  it("does not reclaim a held delivery when another CLI command runs", async () => {
    let release!: () => void;
    let sendStarted!: () => void;
    const started = new Promise<void>((resolve) => {
      sendStarted = resolve;
    });
    const held = new Promise<{ ok: true; delivery: "sent" }>((resolve) => {
      release = () => resolve({ ok: true, delivery: "sent" });
    });
    let sends = 0;
    const host = await loadHost({
      get: ({ terminalId }) => terminal(terminalId, { status: "exited", closeReason: "process-exit" }),
      send: () => {
        sends += 1;
        sendStarted();
        return held;
      },
    });
    const first = await watch(host, "term_held");
    const { store, worker } = service(host);
    const pass = worker.processPass("service_stable");
    await started;
    const reserved = store.get(first.jobId)!;
    expect(reserved).toMatchObject({
      deliveryState: "delivering",
      reservationToken: "service_stable",
      ambiguousAttemptCount: 0,
    });

    await watch(host, "term_concurrent");
    expect(store.get(first.jobId)).toMatchObject({
      deliveryState: "delivering",
      reservationToken: "service_stable",
      ambiguousAttemptCount: 0,
    });
    expect(sends).toBe(1);

    release();
    await pass;
    expect(store.get(first.jobId)).toMatchObject({
      deliveryState: "delivered",
      ambiguousAttemptCount: 0,
      deliveryAttemptCount: 1,
    });
    expect(sends).toBe(1);
    await host.harness.lifecycle.dispose();
  });

  it("settles an aged matching launch marker with a null terminal ID", async () => {
    let createdJob: Awaited<ReturnType<typeof run>>;
    const host = await loadHost({
      create: () => {
        throw Object.assign(new Error("connection lost"), { status: 503 });
      },
      read: ({ path: target }) => {
        if (target.endsWith("launch.json")) {
          return file(launchFor(createdJob, { terminalId: null }), target);
        }
        throw Object.assign(new Error("missing"), { status: 404 });
      },
    });
    createdJob = await run(host, "null marker");
    const { store, worker } = service(host);
    const createdAt = store.get(createdJob.jobId)!.createdAt;
    await worker.processPass("service", createdAt + 120_001);
    expect(store.get(createdJob.jobId)).toMatchObject({
      terminalId: null,
      terminalState: "launch_ambiguous",
      outcomeState: "missing",
      deliveryState: "delivered",
      lastObservationError: expect.stringContaining("no terminal ID after the launch deadline"),
    });
    await host.harness.lifecycle.dispose();
  });

  it.each([
    [408, "preparing"],
    [425, "preparing"],
    [429, "preparing"],
    [403, "unavailable"],
  ] as const)("classifies structured terminal-create status %i as %s", async (status, state) => {
    const host = await loadHost({
      create: () => {
        throw Object.assign(new Error("request failed"), { status });
      },
    });
    const job = await run(host, `status ${status}`);
    expect(new JobStore(host.bb.storage.database()).get(job.jobId)?.terminalState).toBe(state);
    await host.harness.lifecycle.dispose();
  });

  it("does not parse :443 from a network message as an HTTP status", async () => {
    const host = await loadHost({
      create: () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:443");
      },
    });
    const job = await run(host, "network");
    expect(new JobStore(host.bb.storage.database()).get(job.jobId)?.terminalState).toBe("preparing");
    await host.harness.lifecycle.dispose();
  });

  it.each([
    [408, "retry_wait"],
    [425, "retry_wait"],
    [429, "retry_wait"],
    [null, "retry_wait"],
    [403, "abandoned"],
  ] as const)("classifies delivery failure %s as %s", async (status, state) => {
    const host = await loadHost({
      get: ({ terminalId }) => terminal(terminalId, { status: "exited", closeReason: "process-exit" }),
      send: () => {
        if (status === null) throw new Error("connect ECONNREFUSED service.example:443");
        throw Object.assign(new Error("send failed"), { status });
      },
    });
    const job = await watch(host, `term_send_${status ?? "network"}`);
    const { store, worker } = service(host);
    await worker.processPass("service");
    expect(store.get(job.jobId)?.deliveryState).toBe(state);
    await host.harness.lifecycle.dispose();
  });

  it("bounds persistent EACCES outcome uncertainty and preserves transient recovery", async () => {
    let mode: "denied" | "success" = "denied";
    let currentJob: Awaited<ReturnType<typeof run>>;
    const host = await loadHost({
      create: () => terminal("term_created", { status: "exited", closeReason: "process-exit" }),
      read: ({ path: target }) => {
        if (mode === "denied") throw Object.assign(new Error("permission denied"), { code: "EACCES" });
        return file(outcomeFor(currentJob), target);
      },
    });
    currentJob = await run(host, "persistent denied");
    const { store, worker } = service(host);
    const started = store.get(currentJob.jobId)!.createdAt;
    await worker.processPass("service", started);
    expect(store.get(currentJob.jobId)).toMatchObject({ outcomeState: "unchecked", deliveryState: "pending" });
    await worker.processPass("service", started + 31_000);
    expect(store.get(currentJob.jobId)).toMatchObject({
      outcomeState: "invalid",
      deliveryState: "delivered",
      outcomeError: expect.stringContaining("permission denied"),
    });

    mode = "denied";
    currentJob = await run(host, "transient denied", "/tmp/transient");
    const secondStarted = store.get(currentJob.jobId)!.createdAt;
    await worker.processPass("service", secondStarted);
    mode = "success";
    await worker.processPass("service", secondStarted + 1_000);
    expect(store.get(currentJob.jobId)).toMatchObject({
      outcomeState: "present",
      deliveryState: "delivered",
      outcome: { result: "success" },
    });
    await host.harness.lifecycle.dispose();
  });

  it("isolates a corrupt row and completes a healthy row", async () => {
    const sends: unknown[] = [];
    const errors: string[] = [];
    const host = await loadHost({
      get: ({ terminalId }) => terminal(terminalId, { status: "exited", closeReason: "process-exit" }),
      send: (args) => {
        sends.push(args);
        return { ok: true, delivery: "sent" };
      },
    });
    const corrupt = await watch(host, "term_corrupt");
    const healthy = await watch(host, "term_healthy");
    host.bb.storage.database().prepare("UPDATE jobs SET scope_json = '{}' WHERE job_id = ?").run(corrupt.jobId);
    const createdAfterCorruption = await run(host, "created after corrupt row");
    expect(new JobStore(host.bb.storage.database()).get(createdAfterCorruption.jobId)).toMatchObject({
      terminalId: "term_created",
      terminalState: "observing",
      lastObservationError: null,
    });
    const { store, worker } = service(host, (message) => errors.push(message));
    await worker.processPass("service");
    expect(errors).toEqual([expect.stringContaining(`Skipped corrupt terminal job ${corrupt.jobId}`)]);
    expect(store.get(healthy.jobId)).toMatchObject({ deliveryState: "delivered" });
    expect(sends).toHaveLength(2);
    const quarantined = host.bb.storage.database().prepare(
      "SELECT terminal_state, outcome_state, delivery_state FROM jobs WHERE job_id = ?",
    ).get(corrupt.jobId);
    expect(quarantined).toEqual({
      terminal_state: "unavailable",
      outcome_state: "invalid",
      delivery_state: "abandoned",
    });
    await host.harness.lifecycle.dispose();
  });

  it("rotates observation beyond the oldest bounded batch", async () => {
    const host = await loadHost({
      get: ({ terminalId }) => terminal(terminalId),
    });
    const terminalIds = Array.from({ length: 101 }, (_, index) => `term_fair_${index}`);
    for (const terminalId of terminalIds) await watch(host, terminalId);
    const baseline = host.harness.inspection.sdk.callsTo("terminals.get").length;
    const { worker } = service(host);
    await worker.processPass("service", 1_000);
    const first = host.harness.inspection.sdk.callsTo("terminals.get").slice(baseline).map(
      ([args]) => (args as { terminalId: string }).terminalId,
    );
    expect(first).toHaveLength(100);
    const omitted = terminalIds.filter((terminalId) => !first.includes(terminalId));
    expect(omitted).toHaveLength(1);

    const secondStart = host.harness.inspection.sdk.callsTo("terminals.get").length;
    await worker.processPass("service", 2_000);
    const second = host.harness.inspection.sdk.callsTo("terminals.get").slice(secondStart).map(
      ([args]) => (args as { terminalId: string }).terminalId,
    );
    expect(second).toHaveLength(100);
    expect(second).toContain(omitted[0]);
    await host.harness.lifecycle.dispose();
  });

  it.each([
    ["job", (job: Awaited<ReturnType<typeof run>>) => ({ jobId: `${job.jobId}_other` })],
    ["owner", () => ({ ownerThreadId: "thr_other" })],
    ["argv", () => ({ argv: ["false"] })],
    ["paths", () => ({ logPath: "/tmp/other.log" })],
  ] as const)("settles a conflicting %s launch marker immediately", async (_label, mutation) => {
    let currentJob: Awaited<ReturnType<typeof run>>;
    const host = await loadHost({
      create: () => {
        throw Object.assign(new Error("connection lost"), { status: 503 });
      },
      read: ({ path: target }) => {
        if (target.endsWith("launch.json")) {
          return file(launchFor(currentJob, mutation(currentJob)), target);
        }
        throw Object.assign(new Error("missing"), { status: 404 });
      },
    });
    currentJob = await run(host, `conflict ${_label}`);
    const { store, worker } = service(host);
    await worker.processPass("service", store.get(currentJob.jobId)!.createdAt + 1);
    expect(store.get(currentJob.jobId)).toMatchObject({
      terminalState: "launch_ambiguous",
      outcomeState: "missing",
      lastObservationError: expect.stringContaining("Launch marker is invalid"),
    });
    await host.harness.lifecycle.dispose();
  });

  it("rejects a conflicting non-null outcome terminal marker", async () => {
    let currentJob: Awaited<ReturnType<typeof run>>;
    const host = await loadHost({
      create: () => terminal("term_created", { status: "exited", closeReason: "process-exit" }),
      read: ({ path: target }) => file(outcomeFor(currentJob, "term_other"), target),
    });
    currentJob = await run(host, "outcome conflict");
    const { store, worker } = service(host);
    await worker.processPass("service");
    expect(store.get(currentJob.jobId)).toMatchObject({
      outcomeState: "invalid",
      outcomeError: expect.stringContaining("terminal marker conflicts"),
    });
    await host.harness.lifecycle.dispose();
  });

  it("does not redeliver a duplicate exited observation", async () => {
    let sends = 0;
    const host = await loadHost({
      get: ({ terminalId }) => terminal(terminalId, { status: "exited", closeReason: "process-exit" }),
      send: () => {
        sends += 1;
        return { ok: true, delivery: "sent" };
      },
    });
    const job = await watch(host, "term_duplicate");
    const { store, worker } = service(host);
    await worker.processPass("service");
    await worker.processPass("service");
    expect(store.get(job.jobId)).toMatchObject({
      terminalState: "exited",
      deliveryState: "delivered",
      deliveryAttemptCount: 1,
    });
    expect(sends).toBe(1);
    await host.harness.lifecycle.dispose();
  });

  it("preserves mandatory completion fields under long optional data", async () => {
    const host = await loadHost();
    const store = new JobStore(host.bb.storage.database());
    const long = "x".repeat(20_000);
    const job = store.insert({
      jobId: "job_message_contract",
      source: "run",
      ownerThreadId: "thr_owner",
      deliveryMode: "queue",
      title: long,
      scope: { kind: "thread", threadId: "thr_owner" },
      hostId: "host_target",
      argv: ["true"],
      createdAt: 1,
      artifactRoot: "/tmp/jobs",
      jobDirectory: "/tmp/jobs/job_message_contract",
      launchPath: "/tmp/jobs/job_message_contract/launch.json",
      logPath: `/tmp/${long}.log`,
      outcomePath: `/tmp/${long}.json`,
      terminalId: "term_message_contract",
      terminalState: "exited",
      lastBbStatus: long,
      outcomeState: "missing",
    });
    const updated = store.update(job.jobId, {
      closeReason: long,
      outcomeError: long,
      outcomeCheckedAt: 1,
    });
    const message = formatCompletion(updated);
    expect(message.length).toBeLessThanOrEqual(12_000);
    expect(message).toContain("[terminal-job:job_message_contract]");
    expect(message).toContain("Terminal: term_message_contract");
    expect(message).toContain("Runner outcome: missing; command success is unknown");
    expect(message).toContain("Status: bb terminal-job show job_message_contract --json");
    expect(message.endsWith("Status: bb terminal-job show job_message_contract --json")).toBe(true);
    await host.harness.lifecycle.dispose();
  });

  it("keeps runner and plugin artifact marker/schema contracts identical", () => {
    const require = createRequire(import.meta.url);
    const runnerSchema = require("../../../bin/terminal-job-schema.cjs") as {
      ARTIFACT_SCHEMA_VERSION: number;
      launchFields: string[];
      outcomeFields: string[];
    };
    expect(runnerSchema.ARTIFACT_SCHEMA_VERSION).toBe(ARTIFACT_SCHEMA_VERSION);
    expect(runnerSchema.launchFields).toEqual([...LAUNCH_ARTIFACT_FIELDS]);
    expect(runnerSchema.outcomeFields).toEqual([...OUTCOME_ARTIFACT_FIELDS]);
  });
});
