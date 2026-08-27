import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import type { PluginCliContext } from "@get-bb/plugin-sdk";
import { createFakePluginHost, type FakePluginHost } from "@get-bb/plugin-sdk/testing";
import plugin from "../server.js";
import { TerminalJobService } from "../src/service.js";
import { JobStore } from "../src/store.js";

const runner = path.resolve(import.meta.dirname, "../../../bin/terminal-job-runner");
const temporary: string[] = [];

function environment(id = "env_target", hostId = "host_target") {
  return { id, hostId, path: "/workspace" };
}

function thread(id = "thr_target", environmentId = "env_target") {
  return { id, environmentId };
}

function terminal(overrides: Record<string, unknown> = {}) {
  return {
    id: "term_target",
    title: "job title",
    hostId: "host_target",
    threadId: "thr_target",
    environmentId: "env_target",
    initialCwd: "/workspace",
    status: "running",
    exitCode: null,
    closeReason: null,
    ...overrides,
  };
}

async function load(options: {
  create?: Record<string, unknown>;
  get?: Record<string, unknown>;
  fileRead?: (args: { path: string; rootPath?: string; hostId?: string }) => unknown;
  send?: (args: unknown) => unknown;
} = {}): Promise<FakePluginHost> {
  const host = createFakePluginHost({
    pluginId: "terminal-jobs",
    sdk: {
      threads: {
        get: async ({ threadId }: { threadId: string }) => thread(threadId),
        send: async (args: unknown) => options.send?.(args) ?? { ok: true, delivery: "sent" },
      },
      environments: {
        get: async ({ environmentId }: { environmentId: string }) => environment(environmentId),
      },
      terminals: {
        create: async () => terminal(options.create),
        get: async () => terminal(options.get),
      },
      files: {
        read: async (args: { path: string; rootPath?: string; hostId?: string }) => {
          if (options.fileRead) return options.fileRead(args);
          throw Object.assign(new Error("404 not found"), { status: 404 });
        },
      },
    } as never,
  });
  await plugin(host.bb);
  return host;
}

async function runJob(
  host: FakePluginHost,
  extra: string[] = [],
  ctx: PluginCliContext = { threadId: "thr_owner" },
) {
  return host.harness.behavior.runCli(
    [
      "run",
      "--title",
      "demo",
      "--artifact-root",
      "/tmp/jobs",
      "--json",
      ...extra,
      "--",
      "printf",
      "%s",
      "secret argv value",
    ],
    ctx,
  );
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("terminal jobs plugin", () => {
  it("registers one backend CLI and one abortable service", async () => {
    const host = await load();
    expect(host.harness.inspection.registrations.cli?.name).toBe("terminal-job");
    expect(host.harness.inspection.registrations.services.map((item) => item.name)).toEqual(["reconciler"]);
    expect(host.harness.inspection.registrations.httpRoutes).toEqual([]);
    expect(host.harness.inspection.registrations.rpcMethods).toEqual([]);
    expect(host.harness.inspection.registrations.agentTools).toEqual([]);
    const service = host.harness.behavior.runService("reconciler");
    service.controller.abort();
    await service.done;
    await host.harness.lifecycle.dispose();
  });

  it("uses the invoking thread as immutable owner while targeting another thread", async () => {
    const host = await load();
    const result = await runJob(host, ["--thread", "thr_other"], { threadId: "thr_owner" });
    expect(result.exitCode, result.stderr).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.ownerThreadId).toBe("thr_owner");
    expect(value.scope).toEqual({ kind: "thread", threadId: "thr_other" });
    expect(value.hostId).toBe("host_target");
    const create = host.harness.inspection.sdk.callsTo("terminals.create")[0]![0] as {
      scope: unknown;
      start: { command: string };
    };
    expect(create.scope).toEqual({ kind: "thread", threadId: "thr_other" });
    expect(create.start.command.startsWith('exec "$HOME/.local/bin/terminal-job-runner"')).toBe(true);
    expect(create.start.command).toContain("'secret argv value'");
    expect(create.start.command).not.toContain("terminal create");
    await host.harness.lifecycle.dispose();
  });

  it("pins the complete owner matrix and machine cwd behavior", async () => {
    const host = await load();
    const defaultOwner = await runJob(host);
    expect(JSON.parse(defaultOwner.stdout).ownerThreadId).toBe("thr_owner");

    const noContextThread = await runJob(host, ["--thread", "thr_explicit"], {});
    expect(JSON.parse(noContextThread.stdout).ownerThreadId).toBe("thr_explicit");

    const environmentMissingOwner = await runJob(host, ["--environment", "env_target"]);
    expect(environmentMissingOwner.exitCode).toBe(1);
    expect(environmentMissingOwner.stderr).toContain("--notify-thread is required");

    const machine = await runJob(
      host,
      ["--machine", "host_remote", "--notify-thread", "thr_notify"],
      {},
    );
    expect(JSON.parse(machine.stdout).scope).toEqual({ kind: "machine", hostId: "host_remote", cwd: null });
    const machineCreate = host.harness.inspection.sdk.callsTo("terminals.create").at(-1)![0] as { scope: unknown };
    expect(machineCreate.scope).toEqual({ kind: "host_path", hostId: "host_remote", cwd: null });

    const cwd = await runJob(
      host,
      ["--machine", "host_remote", "--cwd", "/tmp/work", "--notify-thread", "thr_notify"],
      {},
    );
    expect(JSON.parse(cwd.stdout).scope.cwd).toBe("/tmp/work");
    await host.harness.lifecycle.dispose();
  });

  it("rejects conflicting scopes, relative paths, controls, and command omission", async () => {
    const host = await load();
    for (const [argv, message] of [
      [["run", "--title", "x", "--artifact-root", "/tmp/a", "--thread", "t", "--machine", "h", "--notify-thread", "n", "--", "true"], "mutually exclusive"],
      [["run", "--title", "x", "--artifact-root", "relative", "--", "true"], "absolute POSIX"],
      [["run", "--title", "bad\nname", "--artifact-root", "/tmp/a", "--", "true"], "control characters"],
      [["run", "--title", "x", "--artifact-root", "/tmp/a"], "literal --"],
      [["run", "--title", "x", "--artifact-root", "/tmp/a", "--"], "missing command"],
    ] as const) {
      const result = await host.harness.behavior.runCli([...argv], { threadId: "thr_owner" });
      expect(result.exitCode).toBe(1);
      expect(result.stderr).toContain(message);
    }
    await host.harness.lifecycle.dispose();
  });

  it("settles an already-exited command, validates a real runner artifact, and queues one notice", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "terminal-job-contract-"));
    temporary.push(artifactRoot);
    let outcomeContent = "";
    const sends: unknown[] = [];
    const host = await load({
      create: { status: "exited", exitCode: 0, closeReason: "process-exit" },
      get: { status: "exited", exitCode: 0, closeReason: "process-exit" },
      fileRead: ({ path: target }) => ({
        path: target,
        content: outcomeContent,
        contentEncoding: "utf8",
        sha256: "fixture",
        sizeBytes: outcomeContent.length,
      }),
      send: (args) => {
        sends.push(args);
        return { ok: true, delivery: "queued" };
      },
    });

    host.harness.inspection.sdk.stub("terminals.create", (async (args: { start: { command: string } }) => {
      const command = args.start.command;
      const jobId = command.match(/'(--job-id)' '([^']+)'/)?.[2];
      if (!jobId) throw new Error("missing generated job id");
      const result = spawnSync(
        runner,
        ["--job-id", jobId, "--owner-thread", "thr_owner", "--artifact-root", artifactRoot, "--", "true"],
        { encoding: "utf8", env: { ...process.env, BB_TERMINAL_SESSION_ID: "term_target" } },
      );
      expect(result.status).toBe(0);
      outcomeContent = readFileSync(path.join(artifactRoot, jobId, "outcome.json"), "utf8");
      return terminal({ status: "exited", exitCode: 0, closeReason: "process-exit" });
    }) as never);

    const result = await host.harness.behavior.runCli(
      ["run", "--title", "fast", "--artifact-root", artifactRoot, "--json", "--", "true"],
      { threadId: "thr_owner" },
    );
    expect(result.exitCode, result.stderr).toBe(0);
    const value = JSON.parse(result.stdout);
    expect(value.terminal).toMatchObject({ state: "exited", bbStatus: "exited", exitCode: 0 });
    expect(value.outcome).toMatchObject({ state: "present", result: "success", commandExitCode: 0 });
    expect(value.delivery).toMatchObject({ state: "delivered", acceptedKind: "queued", attemptCount: 1 });
    expect(sends).toHaveLength(1);
    expect(sends[0]).toMatchObject({ mode: "queue-if-active", threadId: "thr_owner" });
    expect(JSON.stringify(sends[0])).toContain(`[terminal-job:${value.jobId}]`);
    expect(host.harness.inspection.sdk.callsTo("files.read")).toEqual([
      [{ hostId: "host_target", rootPath: artifactRoot, path: value.artifacts.outcome }],
    ]);
    expect(host.harness.inspection.sdk.callsTo("terminals.create")).toHaveLength(1);
    await host.harness.lifecycle.dispose();
  });

  it("uses steer only when explicit and omits sensitive argv from status", async () => {
    const host = await load();
    const result = await runJob(host, ["--delivery", "steer"]);
    const value = JSON.parse(result.stdout);
    expect(value.deliveryMode).toBe("steer");
    expect(Object.keys(value)).toEqual([
      "schemaVersion",
      "jobId",
      "marker",
      "source",
      "title",
      "ownerThreadId",
      "deliveryMode",
      "scope",
      "hostId",
      "artifacts",
      "terminal",
      "outcome",
      "delivery",
      "createdAt",
      "updatedAt",
    ]);
    expect(Object.keys(value.artifacts)).toEqual(["root", "directory", "launch", "log", "outcome"]);
    expect(Object.keys(value.terminal)).toEqual([
      "id", "state", "bbStatus", "exitCode", "closeReason", "lastError", "observedAt", "exitedAt",
    ]);
    expect(Object.keys(value.outcome)).toEqual([
      "state", "result", "commandExitCode", "signal", "shellStatus", "durationMs", "terminalMarker", "error", "checkedAt",
    ]);
    expect(Object.keys(value.delivery)).toEqual([
      "state", "mode", "attemptCount", "nextAttemptAt", "lastError", "acceptedKind", "ambiguityCount", "attemptedAt", "deliveredAt",
    ]);
    expect(result.stdout).not.toContain("secret argv value");
    const show = await host.harness.behavior.runCli(["show", value.jobId, "--json"]);
    expect(show.stdout).toBe(result.stdout);
    expect(show.stdout).not.toContain("secret argv value");
    await host.harness.lifecycle.dispose();
  });

  it("registers only explicit watch jobs and states no outcome or scrollback contract", async () => {
    const sends: unknown[] = [];
    const host = await load({
      get: { status: "exited", exitCode: null, closeReason: "daemon-disconnect" },
      send: (args) => {
        sends.push(args);
        return { ok: true, delivery: "deferred" };
      },
    });
    const before = (host.bb.storage.database().prepare("SELECT COUNT(*) AS count FROM jobs").get() as { count: number }).count;
    expect(before).toBe(0);
    const missingLog = await host.harness.behavior.runCli([
      "watch",
      "term_target",
      "--notify-thread",
      "thr_owner",
    ]);
    expect(missingLog.exitCode).toBe(1);
    const result = await host.harness.behavior.runCli([
      "watch",
      "term_target",
      "--notify-thread",
      "thr_owner",
      "--log",
      "/tmp/durable.log",
      "--delivery",
      "steer",
      "--json",
    ]);
    const value = JSON.parse(result.stdout);
    expect(value.outcome.state).toBe("not-applicable");
    expect(value.delivery).toMatchObject({ state: "delivered", acceptedKind: "deferred" });
    expect(value.terminal).toMatchObject({ exitCode: null, closeReason: "daemon-disconnect" });
    expect(sends).toMatchObject([
      {
        mode: "steer-if-active",
        input: [{ text: expect.stringContaining("no scrollback was recovered") }],
      },
    ]);
    await host.harness.lifecycle.dispose();
  });

  it("keeps transient delivery retryable, abandons permanent failures, and gates manual retry", async () => {
    let failure: "transient" | "permanent" | null = "transient";
    const host = await load({
      get: { status: "exited", exitCode: 2, closeReason: "process-exit" },
      send: () => {
        if (failure === "transient") throw Object.assign(new Error("service unavailable"), { status: 503 });
        if (failure === "permanent") throw Object.assign(new Error("thread deleted"), { status: 410 });
        return { ok: true, delivery: "sent" };
      },
    });
    const first = await host.harness.behavior.runCli([
      "watch", "term_target", "--notify-thread", "thr_owner", "--log", "/tmp/a.log", "--json",
    ]);
    const retryWait = JSON.parse(first.stdout);
    expect(retryWait.delivery.state).toBe("retry_wait");
    expect(retryWait.delivery.nextAttemptAt).toBeTypeOf("number");

    const retry = await host.harness.behavior.runCli(["retry-notification", retryWait.jobId, "--json"]);
    expect(JSON.parse(retry.stdout).delivery.state).toBe("retry_wait");
    failure = null;
    const store = new JobStore(host.bb.storage.database());
    await new TerminalJobService(host.bb, store).processPass("service_restart", Date.now() + 2_000);
    expect(store.get(retryWait.jobId)?.deliveryState).toBe("delivered");
    const refused = await host.harness.behavior.runCli(["retry-notification", retryWait.jobId]);
    expect(refused.stderr).toContain("state is delivered");

    failure = "permanent";
    const second = await host.harness.behavior.runCli([
      "watch", "term_target", "--notify-thread", "thr_owner", "--log", "/tmp/b.log", "--json",
    ]);
    const abandoned = JSON.parse(second.stdout);
    expect(abandoned.delivery.state).toBe("abandoned");
    const reset = await host.harness.behavior.runCli(["retry-notification", abandoned.jobId, "--json"]);
    expect(JSON.parse(reset.stdout).delivery.state).toBe("retry_wait");
    await host.harness.lifecycle.dispose();
  });

  it("recovers a foreign reservation with the same marker and never reclaims a same-token row", async () => {
    const sends: unknown[] = [];
    const host = await load({
      get: { status: "exited", exitCode: 0, closeReason: "process-exit" },
      send: (args) => {
        sends.push(args);
        return { ok: true, delivery: "sent" };
      },
    });
    const created = await host.harness.behavior.runCli([
      "watch", "term_target", "--notify-thread", "thr_owner", "--log", "/tmp/recover.log", "--json",
    ]);
    const value = JSON.parse(created.stdout);
    const db = host.bb.storage.database();
    db.prepare(
      "UPDATE jobs SET delivery_state = 'delivering', reservation_token = 'old', delivered_at = NULL, accepted_delivery_kind = NULL WHERE job_id = ?",
    ).run(value.jobId);
    const store = new JobStore(db);
    const service = new TerminalJobService(host.bb, store);
    await service.processPass("new", Date.now());
    expect(store.get(value.jobId)).toMatchObject({
      deliveryState: "delivered",
      ambiguousAttemptCount: 1,
      acceptedDeliveryKind: "sent",
    });
    expect(sends.at(-1)).toMatchObject({ input: [{ text: expect.stringContaining(value.marker) }] });

    db.prepare(
      "UPDATE jobs SET delivery_state = 'delivering', reservation_token = 'same', delivered_at = NULL WHERE job_id = ?",
    ).run(value.jobId);
    const before = sends.length;
    await service.processPass("same", Date.now());
    expect(sends).toHaveLength(before);
    const retry = await host.harness.behavior.runCli(["retry-notification", value.jobId]);
    expect(retry.stderr).toContain("state is delivering");
    await host.harness.lifecycle.dispose();
  });

  it("reloads unresolved state from the same SQLite database and settles it", async () => {
    const host = await load();
    const launched = await runJob(host);
    const value = JSON.parse(launched.stdout);
    expect(value.terminal.state).toBe("observing");

    const reloaded = await host.harness.lifecycle.reload(plugin);
    reloaded.harness.inspection.sdk.stub("terminals.get", (async () =>
      terminal({ status: "exited", exitCode: null, closeReason: "daemon-disconnect" })) as never);
    reloaded.harness.inspection.sdk.stub("files.read", (async () => {
      throw Object.assign(new Error("404 not found"), { status: 404 });
    }) as never);
    reloaded.harness.inspection.sdk.stub("threads.send", (async () => ({
      ok: true,
      delivery: "sent",
    })) as never);
    const service = reloaded.harness.behavior.runService("reconciler");
    await new Promise((resolve) => setTimeout(resolve, 20));
    service.controller.abort();
    await service.done;

    const shown = await reloaded.harness.behavior.runCli(["show", value.jobId, "--json"]);
    expect(JSON.parse(shown.stdout)).toMatchObject({
      terminal: { state: "exited", exitCode: null, closeReason: "daemon-disconnect" },
      outcome: { state: "missing", result: null },
      delivery: { state: "delivered", acceptedKind: "sent" },
    });
    await reloaded.harness.lifecycle.dispose();
  });

  it("keeps missing and malformed runner outcomes as explicit uncertainty", async () => {
    const missingHost = await load({
      create: { status: "exited", exitCode: 0, closeReason: "process-exit" },
      get: { status: "exited", exitCode: 0, closeReason: "process-exit" },
    });
    const missing = await runJob(missingHost);
    expect(JSON.parse(missing.stdout).outcome).toMatchObject({
      state: "missing",
      result: null,
      error: expect.stringContaining("success is unknown"),
    });
    await missingHost.harness.lifecycle.dispose();

    const invalidHost = await load({
      create: { status: "exited", exitCode: 0, closeReason: "process-exit" },
      get: { status: "exited", exitCode: 0, closeReason: "process-exit" },
      fileRead: ({ path: target }) => ({
        path: target,
        content: '{"schemaVersion":1,"result":"success"}',
        contentEncoding: "utf8",
        sha256: "invalid",
        sizeBytes: 38,
      }),
    });
    const invalid = await runJob(invalidHost);
    expect(JSON.parse(invalid.stdout).outcome).toMatchObject({
      state: "invalid",
      result: null,
    });
    await invalidHost.harness.lifecycle.dispose();
  });

  it("recovers create acceptance without a response from the launch marker", async () => {
    const artifactRoot = await mkdtemp(path.join(os.tmpdir(), "terminal-job-launch-recovery-"));
    temporary.push(artifactRoot);
    let jobDirectory = "";
    const host = await load({
      get: { status: "exited", exitCode: 0, closeReason: "process-exit" },
      fileRead: ({ path: target }) => {
        const content = readFileSync(target, "utf8");
        return {
          path: target,
          content,
          contentEncoding: "utf8",
          sha256: "recovery",
          sizeBytes: content.length,
        };
      },
    });
    host.harness.inspection.sdk.stub("terminals.create", (async (args: { start: { command: string } }) => {
      const jobId = args.start.command.match(/'--job-id' '([^']+)'/)?.[1];
      if (!jobId) throw new Error("missing job marker");
      jobDirectory = path.join(artifactRoot, jobId);
      const result = spawnSync(
        runner,
        ["--job-id", jobId, "--owner-thread", "thr_owner", "--artifact-root", artifactRoot, "--", "true"],
        { encoding: "utf8", env: { ...process.env, BB_TERMINAL_SESSION_ID: "term_target" } },
      );
      expect(result.status).toBe(0);
      throw Object.assign(new Error("503 response lost"), { status: 503 });
    }) as never);
    const launched = await host.harness.behavior.runCli(
      ["run", "--title", "recover", "--artifact-root", artifactRoot, "--json", "--", "true"],
      { threadId: "thr_owner" },
    );
    const initial = JSON.parse(launched.stdout);
    expect(initial.terminal).toMatchObject({ id: null, state: "preparing" });
    expect(jobDirectory).not.toBe("");

    const store = new JobStore(host.bb.storage.database());
    await new TerminalJobService(host.bb, store).processPass("restart");
    expect(store.get(initial.jobId)).toMatchObject({
      terminalId: "term_target",
      terminalState: "exited",
      outcomeState: "present",
      deliveryState: "delivered",
    });
    await host.harness.lifecycle.dispose();
  });

  it("settles an unrecoverable launch boundary without claiming no terminal exists", async () => {
    const host = await load();
    host.harness.inspection.sdk.stub("terminals.create", (async () => {
      throw Object.assign(new Error("503 response lost"), { status: 503 });
    }) as never);
    const launched = await runJob(host);
    const value = JSON.parse(launched.stdout);
    const db = host.bb.storage.database();
    db.prepare("UPDATE jobs SET created_at = created_at - 121000 WHERE job_id = ?").run(value.jobId);
    const store = new JobStore(db);
    await new TerminalJobService(host.bb, store).processPass("restart", Date.now());
    expect(store.get(value.jobId)).toMatchObject({
      terminalState: "launch_ambiguous",
      outcomeState: "missing",
      deliveryState: "delivered",
      lastObservationError: expect.stringContaining("orphan terminal is possible"),
    });
    await host.harness.lifecycle.dispose();
  });

  it("rejects corrupted persisted rows instead of changing their meaning", async () => {
    const host = await load();
    const created = await runJob(host);
    const value = JSON.parse(created.stdout);
    host.bb.storage.database().prepare("UPDATE jobs SET scope_json = '{}' WHERE job_id = ?").run(value.jobId);
    const shown = await host.harness.behavior.runCli(["show", value.jobId, "--json"]);
    expect(shown.exitCode).toBe(1);
    expect(shown.stderr).toContain("invalid stored scope");
    await host.harness.lifecycle.dispose();
  });

  it("reports unknown jobs and preserves two concurrent argv rows", async () => {
    const host = await load();
    const unknown = await host.harness.behavior.runCli(["show", "job_missing", "--json"]);
    expect(unknown.exitCode).toBe(1);
    expect(unknown.stderr).toContain("unknown job");
    await Promise.all([runJob(host), runJob(host)]);
    const rows = host.bb.storage.database().prepare("SELECT job_id, argv_json FROM jobs ORDER BY job_id").all() as Array<{
      job_id: string;
      argv_json: string;
    }>;
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row) => row.job_id)).size).toBe(2);
    expect(rows.map((row) => JSON.parse(row.argv_json))).toEqual([
      ["printf", "%s", "secret argv value"],
      ["printf", "%s", "secret argv value"],
    ]);
    await host.harness.lifecycle.dispose();
  });
});
