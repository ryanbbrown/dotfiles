import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { TerminalJobCli } from "./src/cli.js";
import { createServiceLoop, TerminalJobService } from "./src/service.js";
import { JobStore } from "./src/store.js";

function createWakeSignal() {
  let wakeCurrent: (() => void) | null = null;
  return {
    wake() {
      wakeCurrent?.();
    },
    wait(delayMs: number, signal: AbortSignal): Promise<void> {
      if (signal.aborted) return Promise.resolve();
      return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal.removeEventListener("abort", finish);
          if (wakeCurrent === finish) wakeCurrent = null;
          resolve();
        };
        const timer = setTimeout(finish, delayMs);
        wakeCurrent = finish;
        signal.addEventListener("abort", finish, { once: true });
      });
    },
  };
}

export default function terminalJobsPlugin(bb: BbPluginApi): void {
  const store = JobStore.open(bb);
  const service = new TerminalJobService(bb, store);
  const wakeSignal = createWakeSignal();
  const cli = new TerminalJobCli(bb, store, service, () => wakeSignal.wake());

  bb.cli.register({
    name: "terminal-job",
    summary: "Run and inspect durable terminal jobs.",
    commands: [
      {
        name: "run",
        summary: "Run a command in a durable BB terminal.",
        usage:
          "bb terminal-job run --title TITLE [scope] --artifact-root PATH [--delivery queue|steer] [--json] -- COMMAND [ARG...]",
      },
      {
        name: "watch",
        summary: "Register an existing terminal without recovering scrollback.",
        usage:
          "bb terminal-job watch TERMINAL_ID --notify-thread THREAD --log PATH [--delivery queue|steer] [--json]",
      },
      {
        name: "show",
        summary: "Show durable job status without command arguments.",
        usage: "bb terminal-job show JOB_ID [--json]",
      },
      {
        name: "retry-notification",
        summary: "Retry an abandoned or waiting completion notice.",
        usage: "bb terminal-job retry-notification JOB_ID [--json]",
      },
    ],
    run(argv, ctx) {
      return cli.run(argv, ctx);
    },
  });

  bb.background.service("reconciler", {
    start: createServiceLoop(service, store, (delay, signal) =>
      wakeSignal.wait(delay, signal),
    ),
  });

  bb.log.info("Terminal jobs 0.1.0 loaded");
}
