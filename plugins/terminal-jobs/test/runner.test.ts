import { chmodSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { decodeLaunchArtifact, decodeOutcomeArtifact } from "../src/artifacts.js";
import { runnerCommand } from "../src/cli.js";

const runner = path.resolve(import.meta.dirname, "../../../bin/terminal-job-runner");
const temporary: string[] = [];

async function root(prefix = "terminal-job-runner-") {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporary.push(directory);
  return directory;
}

function paths(artifactRoot: string, jobId: string) {
  const directory = path.join(artifactRoot, jobId);
  return {
    directory,
    launch: path.join(directory, "launch.json"),
    log: path.join(directory, "output.log"),
    outcome: path.join(directory, "outcome.json"),
  };
}

function run(artifactRoot: string, jobId: string, command: string[]) {
  return spawnSync(
    runner,
    ["--job-id", jobId, "--owner-thread", "thr_owner", "--artifact-root", artifactRoot, "--", ...command],
    { encoding: "utf8", env: { ...process.env, BB_TERMINAL_SESSION_ID: "term_fixture" } },
  );
}

afterEach(async () => {
  await Promise.all(temporary.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("terminal-job-runner", () => {
  it.each([0, 2])("preserves combined output and exact status for exit %i", async (exitCode) => {
    const artifactRoot = await root();
    const jobId = `job_exit_${exitCode}`;
    const result = run(artifactRoot, jobId, [
      process.execPath,
      "-e",
      `process.stdout.write('one\\n'); process.stderr.write('two\\n'); process.exit(${exitCode})`,
    ]);
    const files = paths(artifactRoot, jobId);

    expect(result.status).toBe(exitCode);
    expect(result.stdout).toBe("one\ntwo\n");
    expect(readFileSync(files.log, "utf8")).toBe(result.stdout);
    const launch = decodeLaunchArtifact(readFileSync(files.launch, "utf8"));
    expect(launch).toMatchObject({
      jobId,
      terminalId: "term_fixture",
      ownerThreadId: "thr_owner",
    });
    const outcome = decodeOutcomeArtifact(readFileSync(files.outcome, "utf8"));
    expect(outcome).toMatchObject({
      jobId,
      terminalId: "term_fixture",
      commandExitCode: exitCode,
      signal: null,
      status: exitCode,
      result: exitCode === 0 ? "success" : "failure",
    });
    await expect((await import("node:fs/promises")).stat(files.directory).then((item) => item.mode & 0o777)).resolves.toBe(0o700);
    for (const file of [files.launch, files.log, files.outcome]) {
      await expect((await import("node:fs/promises")).stat(file).then((item) => item.mode & 0o777)).resolves.toBe(0o600);
    }
  });

  it("records an absent terminal environment as unknown without invalidating success", async () => {
    const artifactRoot = await root();
    const jobId = "job_no_terminal_env";
    const env = { ...process.env };
    delete env.BB_TERMINAL_SESSION_ID;
    const result = spawnSync(
      runner,
      ["--job-id", jobId, "--owner-thread", "thr_owner", "--artifact-root", artifactRoot, "--", "true"],
      { encoding: "utf8", env },
    );
    expect(result.status).toBe(0);
    expect(decodeOutcomeArtifact(readFileSync(paths(artifactRoot, jobId).outcome, "utf8"))).toMatchObject({
      terminalId: null,
      result: "success",
      status: 0,
    });
  });

  it("passes hostile argv unchanged without evaluation", async () => {
    const artifactRoot = await root();
    const argv = ["space value", "", "雪", "quote'\"", "line\nbreak", "*", "$(touch NEVER)", "; echo bad"];
    const result = run(artifactRoot, "job_argv", [
      process.execPath,
      "-e",
      "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
      ...argv,
    ]);

    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual(argv);
    expect(existsSync(path.join(artifactRoot, "NEVER"))).toBe(false);
  });

  it("records a child signal and a signal forwarded to the child", async () => {
    const artifactRoot = await root();
    const childSignal = run(artifactRoot, "job_child_signal", [
      "/bin/sh",
      "-c",
      "printf partial; kill -TERM $$",
    ]);
    expect(childSignal.status).toBe(143);
    expect(readFileSync(paths(artifactRoot, "job_child_signal").log, "utf8")).toBe("partial");
    expect(decodeOutcomeArtifact(readFileSync(paths(artifactRoot, "job_child_signal").outcome, "utf8"))).toMatchObject({
      commandExitCode: null,
      signal: "SIGTERM",
      status: 143,
      result: "signaled",
    });

    const forwardedId = "job_forwarded_signal";
    const child = spawn(
      runner,
      [
        "--job-id",
        forwardedId,
        "--owner-thread",
        "thr_owner",
        "--artifact-root",
        artifactRoot,
        "--",
        "/bin/sh",
        "-c",
        "printf ready; while :; do sleep 1; done",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));
    child.kill("SIGTERM");
    const status = await new Promise<number | null>((resolve) => child.once("close", resolve));
    expect(status).toBe(143);
    expect(decodeOutcomeArtifact(readFileSync(paths(artifactRoot, forwardedId).outcome, "utf8"))).toMatchObject({
      signal: "SIGTERM",
      status: 143,
      result: "signaled",
    });
  });

  it("preserves normal exit when a signal arrives after child exit but before stdio close", async () => {
    const artifactRoot = await root();
    const jobId = "job_post_exit_signal";
    const child = spawn(
      runner,
      [
        "--job-id",
        jobId,
        "--owner-thread",
        "thr_owner",
        "--artifact-root",
        artifactRoot,
        "--",
        "/bin/sh",
        "-c",
        "(sleep 0.5) & printf exited",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));
    await new Promise((resolve) => setTimeout(resolve, 100));
    child.kill("SIGTERM");
    const status = await new Promise<number | null>((resolve) => child.once("close", resolve));
    expect(status).toBe(0);
    expect(decodeOutcomeArtifact(readFileSync(paths(artifactRoot, jobId).outcome, "utf8"))).toMatchObject({
      commandExitCode: 0,
      signal: null,
      status: 0,
      result: "success",
    });
  });

  it("leaves partial output without a false outcome after forced runner loss", async () => {
    const artifactRoot = await root();
    const jobId = "job_forced_loss";
    const child = spawn(
      runner,
      [
        "--job-id",
        jobId,
        "--owner-thread",
        "thr_owner",
        "--artifact-root",
        artifactRoot,
        "--",
        "/bin/sh",
        "-c",
        "printf partial; sleep 0.2",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    await new Promise<void>((resolve) => child.stdout.once("data", () => resolve()));
    child.kill("SIGKILL");
    await new Promise((resolve) => child.once("close", resolve));
    await new Promise((resolve) => setTimeout(resolve, 300));

    expect(readFileSync(paths(artifactRoot, jobId).log, "utf8")).toBe("partial");
    expect(existsSync(paths(artifactRoot, jobId).outcome)).toBe(false);
  });

  it("runs the generated shell prefix with a spaced HOME and exact argv", async () => {
    const artifactRoot = await root();
    const home = await root("terminal job home ");
    const localBin = path.join(home, ".local", "bin");
    mkdirSync(localBin, { recursive: true });
    symlinkSync(runner, path.join(localBin, "terminal-job-runner"));
    const capture = path.join(artifactRoot, "capture.js");
    writeFileSync(capture, "process.stdout.write(JSON.stringify(process.argv.slice(2))); process.exit(6)");
    chmodSync(capture, 0o700);
    const argv = [process.execPath, capture, "", "a b", "'", "$(false)", "line\nbreak"];
    const command = runnerCommand({
      jobId: "job_shell",
      ownerThreadId: "thr_owner",
      artifactRoot,
      argv,
    });
    const result = spawnSync("/bin/sh", ["-c", command], {
      encoding: "utf8",
      env: { ...process.env, HOME: home, BB_TERMINAL_SESSION_ID: "term_shell" },
    });

    expect(result.status).toBe(6);
    expect(JSON.parse(result.stdout)).toEqual(argv.slice(2));
    expect(decodeOutcomeArtifact(readFileSync(paths(artifactRoot, "job_shell").outcome, "utf8")).status).toBe(6);
  });
});
