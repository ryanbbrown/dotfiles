# Terminal jobs

`bb-plugin-terminal-jobs` is an opt-in, backend-only BB plugin for durable terminal commands. It stores job state in the plugin SQLite database, writes command artifacts on the target host, observes the BB terminal, and sends an honest at-least-once completion notice to one immutable owner thread.

The package has no app entry, host entry, HTTP or RPC route, settings, or agent tool. It registers `bb terminal-job` and bundles the `terminal-jobs` agent skill.

## Target-host requirements

Each target host needs:

- a POSIX shell
- Node.js 22 or later
- the linked `~/.local/bin/terminal-job-runner`
- `bin/terminal-job-schema.cjs` beside the runner's real repository target; keep the runner as the `link-home.sh` symlink rather than copying it alone
- write access to the selected absolute artifact root

Command arguments and logs are sensitive local data. Use environment variables or mode-0600 secret files instead of secrets in argv.

## Standalone development

The plugin is not a root workspace member. Work in this directory:

```bash
npm ci
bb plugin types . --check
npm run typecheck
npm test
npm run build
```

`npm test` uses the official fake-plugin host, real temporary SQLite storage, and real runner child processes. The package has its own lockfile and no runtime dependencies. Its test-only `cron-parser`, `hono`, and `zod` packages are optional peers that the SDK 0.4.18 fake host imports eagerly.

## Commands

Run a command in the invoking thread:

```bash
bb terminal-job run \
  --title "build docs" \
  --artifact-root "$BB_THREAD_STORAGE/terminal-jobs" \
  --json \
  -- npm run build
```

Target another thread, environment, or enrolled host with `--thread`, `--environment`, or `--machine`. Environment and machine scopes require `--notify-thread`. `--cwd` is valid only with `--machine`; an omitted machine cwd means the host home directory. Scope flags are mutually exclusive.

The default delivery is `queue`, which maps to `queue-if-active` and cannot interrupt an active owner. `--delivery steer` explicitly maps to `steer-if-active`.

Register an existing terminal only when its durable log path is known:

```bash
bb terminal-job watch TERMINAL_ID \
  --notify-thread THREAD_ID \
  --log /absolute/path/to/durable.log \
  --json
```

`watch` does not copy or recover BB scrollback and has no runner outcome contract.

Inspect state or reset an eligible notification:

```bash
bb terminal-job show JOB_ID --json
bb terminal-job retry-notification JOB_ID --json
```

Retry accepts only `retry_wait` and `abandoned`. A crash after BB accepts a notice but before the plugin records it can cause a duplicate. Every attempt has the same `[terminal-job:JOB_ID]` marker.

## Artifacts and cleanup

A run writes these target-host files:

```text
<artifact-root>/<job-id>/
  launch.json
  output.log
  outcome.json
```

The directory is mode `0700`; files are mode `0600`. `launch.json` and `outcome.json` use same-directory atomic renames after fsync. A forced runner or daemon loss can leave a partial log and no outcome. Missing or invalid outcomes never become success.

V1 retains plugin rows and artifact directories without a limit. This preserves audit evidence but can grow sensitive disk use. Remove selected caller-owned `<artifact-root>/<job-id>` directories after their retention period. Removing the plugin deletes its plugin-owned database.

## Mandatory agent policy

After activation, every agent-started command that can outlive its current tool call uses a skill-owned launcher or `bb terminal-job run`. Raw terminal creation is internal to this plugin. Review-panel and update-bb keep their public wrappers; each wrapper owns its terminal-job invocation and must not be wrapped again.

## Ordered activation

This review candidate must stay uninstalled. After it is integrated into canonical dotfiles, activate it in this order:

1. Run `npm ci`, `npm test`, `npm run typecheck`, and `npm run build` in `~/.dotfiles/plugins/terminal-jobs`.
2. Run `~/.dotfiles/scripts/link-home.sh` on each target host.
3. Run `bb plugin install ~/.dotfiles/plugins/terminal-jobs`.
4. Verify `bb terminal-job help`, plugin status, and one harmless completion job.

The shared AGENTS rule is conditional on `bb terminal-job` being installed, so the command exists before the mandatory policy becomes live. BB registers the local path in place. After later source changes, run:

```bash
bb plugin reload terminal-jobs
```

Do not reload only for artifact cleanup or ordinary status/retry operations.
