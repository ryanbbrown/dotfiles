import { randomUUID } from "node:crypto";
import path from "node:path";
import type { BbPluginApi, PluginCliContext, PluginCliResult } from "@get-bb/plugin-sdk";
import { ARTIFACT_SCHEMA_VERSION } from "./artifacts.js";
import { TerminalJobService, definiteCreateFailure } from "./service.js";
import { JobStore, type DeliveryMode, type Job, type Scope } from "./store.js";

class CliError extends Error {}

interface Parsed {
  positionals: string[];
  options: Map<string, string>;
  flags: Set<string>;
}

const CONTROL = /[\0-\x1f\x7f]/u;

function parse(argv: string[], allowedOptions: readonly string[], allowedFlags: readonly string[]): Parsed {
  const positionals: string[] = [];
  const options = new Map<string, string>();
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (!argument.startsWith("--")) {
      positionals.push(argument);
      continue;
    }
    if (allowedFlags.includes(argument)) {
      if (flags.has(argument)) throw new CliError(`duplicate option ${argument}`);
      flags.add(argument);
      continue;
    }
    if (!allowedOptions.includes(argument)) throw new CliError(`unknown option ${argument}`);
    if (options.has(argument)) throw new CliError(`duplicate option ${argument}`);
    const value = argv[++index];
    if (value === undefined) throw new CliError(`missing value for ${argument}`);
    options.set(argument, value);
  }
  return { positionals, options, flags };
}

function required(options: Map<string, string>, name: string): string {
  const value = options.get(name);
  if (value === undefined || value === "") throw new CliError(`missing required ${name}`);
  return value;
}

function safeText(value: string, name: string, maxLength = 512): string {
  if (value.length === 0 || CONTROL.test(value)) {
    throw new CliError(`${name} contains invalid control characters`);
  }
  if (value.length > maxLength) throw new CliError(`${name} exceeds ${maxLength} characters`);
  return value;
}

function absolutePath(value: string, name: string): string {
  safeText(value, name, 4_096);
  if (!path.posix.isAbsolute(value)) throw new CliError(`${name} must be an absolute POSIX path`);
  return value;
}

function deliveryMode(value: string | undefined): DeliveryMode {
  if (value === undefined || value === "queue") return "queue";
  if (value === "steer") return "steer";
  throw new CliError("--delivery must be queue or steer");
}

function quote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

export function runnerCommand(job: {
  jobId: string;
  ownerThreadId: string;
  artifactRoot: string;
  argv: string[];
}): string {
  return [
    'exec "$HOME/.local/bin/terminal-job-runner"',
    quote("--job-id"),
    quote(job.jobId),
    quote("--owner-thread"),
    quote(job.ownerThreadId),
    quote("--artifact-root"),
    quote(job.artifactRoot),
    quote("--"),
    ...job.argv.map(quote),
  ].join(" ");
}

function status(job: Job) {
  return {
    schemaVersion: job.schemaVersion,
    jobId: job.jobId,
    marker: job.marker,
    source: job.source,
    title: job.title,
    ownerThreadId: job.ownerThreadId,
    deliveryMode: job.deliveryMode,
    scope: job.scope,
    hostId: job.hostId,
    artifacts: {
      root: job.artifactRoot,
      directory: job.jobDirectory,
      launch: job.launchPath,
      log: job.logPath,
      outcome: job.outcomePath,
    },
    terminal: {
      id: job.terminalId,
      state: job.terminalState,
      bbStatus: job.lastBbStatus,
      exitCode: job.exitCode,
      closeReason: job.closeReason,
      lastError: job.lastObservationError,
      observedAt: job.observedAt,
      exitedAt: job.exitedAt,
    },
    outcome: {
      state: job.outcomeState,
      result: job.outcome?.result ?? null,
      commandExitCode: job.outcome?.commandExitCode ?? null,
      signal: job.outcome?.signal ?? null,
      shellStatus: job.outcome?.status ?? null,
      durationMs: job.outcome?.durationMs ?? null,
      terminalMarker: job.outcome
        ? job.outcome.terminalId === null
          ? "unknown"
          : job.outcome.terminalId
        : null,
      error: job.outcomeError,
      checkedAt: job.outcomeCheckedAt,
    },
    delivery: {
      state: job.deliveryState,
      mode: job.deliveryMode,
      attemptCount: job.deliveryAttemptCount,
      nextAttemptAt: job.nextAttemptAt,
      lastError: job.deliveryLastError,
      acceptedKind: job.acceptedDeliveryKind,
      ambiguityCount: job.ambiguousAttemptCount,
      attemptedAt: job.deliveryAttemptedAt,
      deliveredAt: job.deliveredAt,
    },
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

function render(job: Job, json: boolean): string {
  const value = status(job);
  if (json) return `${JSON.stringify(value)}\n`;
  return [
    `jobId: ${value.jobId}`,
    `terminalId: ${value.terminal.id ?? "unknown"}`,
    `ownerThreadId: ${value.ownerThreadId}`,
    `scope: ${JSON.stringify(value.scope)}`,
    `hostId: ${value.hostId}`,
    `artifactRoot: ${value.artifacts.root}`,
    `jobDirectory: ${value.artifacts.directory ?? "not applicable"}`,
    `launchPath: ${value.artifacts.launch ?? "not applicable"}`,
    `logPath: ${value.artifacts.log}`,
    `outcomePath: ${value.artifacts.outcome ?? "not applicable"}`,
    `terminalState: ${value.terminal.state}`,
    `outcomeState: ${value.outcome.state}`,
    `deliveryState: ${value.delivery.state}`,
  ].join("\n") + "\n";
}

async function resolveScope(
  bb: BbPluginApi,
  parsed: Parsed,
  ctx: PluginCliContext,
): Promise<{ scope: Scope; hostId: string; ownerThreadId: string }> {
  const threadFlag = parsed.options.get("--thread");
  const environmentFlag = parsed.options.get("--environment");
  const machineFlag = parsed.options.get("--machine");
  const count = [threadFlag, environmentFlag, machineFlag].filter((value) => value !== undefined).length;
  if (count > 1) throw new CliError("--thread, --environment, and --machine are mutually exclusive");
  if (parsed.options.has("--cwd") && machineFlag === undefined) {
    throw new CliError("--cwd requires --machine");
  }
  const explicitOwner = parsed.options.get("--notify-thread");
  if (environmentFlag !== undefined || machineFlag !== undefined) {
    if (!explicitOwner) throw new CliError("--notify-thread is required for environment or machine scope");
  }

  if (machineFlag !== undefined) {
    const hostId = safeText(machineFlag, "--machine");
    const cwd = parsed.options.has("--cwd")
      ? absolutePath(parsed.options.get("--cwd")!, "--cwd")
      : null;
    return {
      scope: { kind: "machine", hostId, cwd },
      hostId,
      ownerThreadId: safeText(explicitOwner!, "--notify-thread"),
    };
  }
  if (environmentFlag !== undefined) {
    const environmentId = safeText(environmentFlag, "--environment");
    const environment = await bb.sdk.environments.get({ environmentId, signal: ctx.signal });
    return {
      scope: { kind: "environment", environmentId },
      hostId: environment.hostId,
      ownerThreadId: safeText(explicitOwner!, "--notify-thread"),
    };
  }

  const threadId = threadFlag ?? ctx.threadId;
  if (!threadId) throw new CliError("a thread context or explicit --thread is required");
  safeText(threadId, "--thread");
  const ownerThreadId = explicitOwner ?? ctx.threadId ?? threadId;
  safeText(ownerThreadId, "notification owner");
  const thread = await bb.sdk.threads.get({ threadId, signal: ctx.signal });
  if (!thread.environmentId) throw new CliError(`thread ${threadId} has no environment`);
  const environment = await bb.sdk.environments.get({
    environmentId: thread.environmentId,
    signal: ctx.signal,
  });
  return {
    scope: { kind: "thread", threadId },
    hostId: environment.hostId,
    ownerThreadId,
  };
}

function terminalScope(scope: Scope) {
  if (scope.kind === "thread") return { kind: "thread" as const, threadId: scope.threadId };
  if (scope.kind === "environment") {
    return { kind: "environment" as const, environmentId: scope.environmentId };
  }
  return { kind: "host_path" as const, hostId: scope.hostId, cwd: scope.cwd };
}

export class TerminalJobCli {
  constructor(
    private readonly bb: BbPluginApi,
    private readonly store: JobStore,
    private readonly service: TerminalJobService,
    private readonly wake: () => void,
  ) {}

  async run(argv: string[], ctx: PluginCliContext): Promise<PluginCliResult> {
    try {
      const command = argv[0];
      if (command === "run") return await this.runJob(argv.slice(1), ctx);
      if (command === "watch") return await this.watch(argv.slice(1), ctx);
      if (command === "show") return this.show(argv.slice(1));
      if (command === "retry-notification") return this.retry(argv.slice(1));
      if (command === "help" || command === undefined) return { exitCode: 0, stdout: this.help() };
      throw new CliError(`unknown command: ${command}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { exitCode: 1, stderr: `terminal-job: ${message.slice(0, 4_000)}\n` };
    }
  }

  private async runJob(argv: string[], ctx: PluginCliContext): Promise<PluginCliResult> {
    const separator = argv.indexOf("--");
    if (separator < 0) throw new CliError("command arguments must follow literal --");
    const pluginArgv = argv.slice(0, separator);
    const commandArgv = argv.slice(separator + 1);
    if (commandArgv.length === 0) throw new CliError("missing command after --");
    const parsed = parse(
      pluginArgv,
      ["--title", "--thread", "--environment", "--machine", "--cwd", "--notify-thread", "--artifact-root", "--delivery"],
      ["--json"],
    );
    if (parsed.positionals.length > 0) throw new CliError(`unexpected argument: ${parsed.positionals[0]}`);
    const title = safeText(required(parsed.options, "--title"), "--title");
    const artifactRoot = absolutePath(required(parsed.options, "--artifact-root"), "--artifact-root");
    const resolved = await resolveScope(this.bb, parsed, ctx);
    const mode = deliveryMode(parsed.options.get("--delivery"));
    const jobId = `job_${randomUUID()}`;
    const jobDirectory = path.posix.join(artifactRoot, jobId);
    const launchPath = path.posix.join(jobDirectory, "launch.json");
    const logPath = path.posix.join(jobDirectory, "output.log");
    const outcomePath = path.posix.join(jobDirectory, "outcome.json");
    let job = this.store.insert({
      jobId,
      source: "run",
      ownerThreadId: resolved.ownerThreadId,
      deliveryMode: mode,
      title,
      scope: resolved.scope,
      hostId: resolved.hostId,
      argv: commandArgv,
      createdAt: Date.now(),
      artifactRoot,
      jobDirectory,
      launchPath,
      logPath,
      outcomePath,
      terminalState: "preparing",
      outcomeState: "unchecked",
    });
    try {
      const terminal = await this.bb.sdk.terminals.create({
        cols: 120,
        rows: 30,
        scope: terminalScope(resolved.scope),
        title,
        start: {
          mode: "command",
          command: runnerCommand({
            jobId,
            ownerThreadId: resolved.ownerThreadId,
            artifactRoot,
            argv: commandArgv,
          }),
        },
      });
      job = this.store.update(jobId, {
        terminalId: terminal.id,
        terminalState: "observing",
        lastBbStatus: terminal.status,
        observedAt: Date.now(),
      });
      await this.service.processPass(`cli_${randomUUID()}`);
      job = this.store.get(jobId)!;
    } catch (error) {
      if (definiteCreateFailure(error)) {
        job = this.store.update(jobId, {
          terminalState: "unavailable",
          lastObservationError: `terminal creation was rejected: ${error instanceof Error ? error.message : String(error)}`,
        });
        await this.service.processPass(`cli_${randomUUID()}`);
        job = this.store.get(jobId)!;
      } else {
        job = this.store.update(jobId, {
          lastObservationError: `terminal create response is unknown: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }
    this.wake();
    return { exitCode: 0, stdout: render(job, parsed.flags.has("--json")) };
  }

  private async watch(argv: string[], ctx: PluginCliContext): Promise<PluginCliResult> {
    const parsed = parse(argv, ["--notify-thread", "--log", "--delivery"], ["--json"]);
    if (parsed.positionals.length !== 1) throw new CliError("watch requires one TERMINAL_ID");
    const terminalId = safeText(parsed.positionals[0]!, "TERMINAL_ID");
    const ownerThreadId = safeText(required(parsed.options, "--notify-thread"), "--notify-thread");
    const logPath = absolutePath(required(parsed.options, "--log"), "--log");
    const terminal = await this.bb.sdk.terminals.get({ terminalId, signal: ctx.signal });
    let scope: Scope;
    if (terminal.threadId) scope = { kind: "thread", threadId: terminal.threadId };
    else if (terminal.environmentId) scope = { kind: "environment", environmentId: terminal.environmentId };
    else scope = { kind: "machine", hostId: terminal.hostId, cwd: terminal.initialCwd };
    const now = Date.now();
    let job = this.store.insert({
      jobId: `job_${randomUUID()}`,
      source: "watch",
      ownerThreadId,
      deliveryMode: deliveryMode(parsed.options.get("--delivery")),
      title: terminal.title,
      scope,
      hostId: terminal.hostId,
      argv: [],
      createdAt: now,
      artifactRoot: path.posix.dirname(logPath),
      jobDirectory: null,
      launchPath: null,
      logPath,
      outcomePath: null,
      terminalId,
      terminalState: terminal.status === "exited" ? "exited" : "observing",
      lastBbStatus: terminal.status,
      outcomeState: terminal.status === "exited" ? "not-applicable" : "unchecked",
    });
    if (terminal.status === "exited") {
      job = this.store.update(job.jobId, {
        exitCode: terminal.exitCode,
        closeReason: terminal.closeReason,
        observedAt: now,
        exitedAt: now,
      });
      await this.service.processPass(`cli_${randomUUID()}`);
      job = this.store.get(job.jobId)!;
    }
    this.wake();
    return { exitCode: 0, stdout: render(job, parsed.flags.has("--json")) };
  }

  private show(argv: string[]): PluginCliResult {
    const parsed = parse(argv, [], ["--json"]);
    if (parsed.positionals.length !== 1) throw new CliError("show requires one JOB_ID");
    const job = this.store.get(safeText(parsed.positionals[0]!, "JOB_ID"));
    if (!job) throw new CliError(`unknown job: ${parsed.positionals[0]}`);
    return { exitCode: 0, stdout: render(job, parsed.flags.has("--json")) };
  }

  private retry(argv: string[]): PluginCliResult {
    const parsed = parse(argv, [], ["--json"]);
    if (parsed.positionals.length !== 1) throw new CliError("retry-notification requires one JOB_ID");
    const jobId = safeText(parsed.positionals[0]!, "JOB_ID");
    const existing = this.store.get(jobId);
    if (!existing) throw new CliError(`unknown job: ${jobId}`);
    const job = this.store.retry(jobId, Date.now());
    if (!job) {
      throw new CliError(`notification cannot be retried while delivery state is ${existing.deliveryState}`);
    }
    this.wake();
    return { exitCode: 0, stdout: render(job, parsed.flags.has("--json")) };
  }

  private help(): string {
    return `Usage:\n  bb terminal-job run --title TITLE [scope] --artifact-root ABSOLUTE_PATH [--delivery queue|steer] [--json] -- COMMAND [ARG...]\n  bb terminal-job watch TERMINAL_ID --notify-thread THREAD --log ABSOLUTE_PATH [--delivery queue|steer] [--json]\n  bb terminal-job show JOB_ID [--json]\n  bb terminal-job retry-notification JOB_ID [--json]\n`;
  }
}

export const PUBLIC_SCHEMA_VERSION = ARTIFACT_SCHEMA_VERSION;
