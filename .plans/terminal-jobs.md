# Terminal jobs implementation plan

## Objective

Add an opt-in, backend-only `bb-plugin-terminal-jobs` package and a small target-host runner. A registered terminal job keeps its owner, terminal metadata, command artifacts, outcome, and completion-delivery state after the invoking turn, terminal, plugin, or BB server stops. Completion delivery is honest at-least-once.

This change does not install or reload the plugin, change review-panel or update-bb, recover deleted BB scrollback, add UI, publish, push, or update canonical `main`.

## Package and interface

Create:

- `plugins/terminal-jobs/`: one backend entry, SQLite-backed domain modules, tests, package metadata, TypeScript and Vitest configuration, and operator documentation.
- `bin/terminal-job-runner`: a small Node 22 executable used inside the target terminal.
- a `scripts/link-home.sh` executable guard and link from that runner to `~/.local/bin/terminal-job-runner`, an isolated link/backup test, and matching README layout, inventory, install, and operator sections.

`plugins/terminal-jobs` is a standalone npm package with its own lockfile and package-local ignores for `node_modules`, `dist`, coverage, and runtime artifacts. It is not a root workspace member. The plugin ID is `terminal-jobs`; its one CLI registration is `terminal-job`. It has no `bb.app`, `bb.host`, RPC, HTTP, settings, skills, or agent tools.

This review candidate remains uninstalled. The later opt-in install path is: run `scripts/link-home.sh` on each target host, run `npm ci` in `plugins/terminal-jobs`, then run `bb plugin install ~/.dotfiles/plugins/terminal-jobs`. BB registers that local path in place; a later `bb plugin reload terminal-jobs` is needed only after source changes. These commands are the install plan, not actions authorized for this implementation.

```text
bb terminal-job run \
  --title TITLE \
  [--thread THREAD | --environment ENVIRONMENT | --machine HOST [--cwd PATH]] \
  [--notify-thread THREAD] \
  --artifact-root ABSOLUTE_PATH \
  [--delivery queue|steer] [--json] \
  -- COMMAND [ARG...]

bb terminal-job watch TERMINAL_ID \
  --notify-thread THREAD \
  --log ABSOLUTE_PATH \
  [--delivery queue|steer] [--json]

bb terminal-job show JOB_ID [--json]
bb terminal-job retry-notification JOB_ID [--json]
```

`--json` is a plugin option and must occur before the command separator on `run`; arguments after literal `--` always belong to the child command.

Owner selection is exact:

| Invocation context | Scope flags | Notification owner |
|---|---|---|
| thread A | none | thread A; terminal scope is thread A |
| thread A | `--thread B` | thread A unless `--notify-thread` is explicit |
| no thread | `--thread B` | thread B unless `--notify-thread` is explicit |
| any | `--environment E` | required explicit `--notify-thread` |
| any | `--machine H` | required explicit `--notify-thread` |

Scope flags are mutually exclusive. Machine scope requires an explicit host ID and uses its home directory when `--cwd` is absent. Environment scope means BB's environment path on its enrolled host, not a container bootstrap; every target host must have the runner link. `queue` is the default and maps only to the SDK-confirmed `queue-if-active`; `steer` is explicit and maps to the SDK-confirmed `steer-if-active`.

`watch` is intentionally narrow. It registers one terminal already known by ID and requires one absolute durable log path. It does not copy or recover terminal output and has no outcome contract. `show` is the inspectable status boundary. It omits stored argv from both human and JSON output because argv can contain sensitive values; `launch.json` is the mode-0600 command audit. `retry-notification` uses one conditional update and only resets `retry_wait` or `abandoned`. It refuses `pending`, in-flight `delivering`, and `delivered`, so it cannot race the service reservation.

A successful `run` or `watch` prints `jobId`, `terminalId`, immutable owner, scope, host, artifact paths, terminal state, outcome state, and delivery state. `--json` produces the same bounded status object as `show --json`.

## Plugin and host boundary

The backend plugin owns registration, SQLite state, terminal polling, outcome inspection, completion formatting, delivery reservation, retry, and restart reconciliation. It uses only the installed BB SDK surface pinned by `bb plugin types`: `bb.storage.database`, `bb.storage.migrate`, `bb.background.service`, `bb.cli.register`, `bb.sdk.terminals`, `bb.sdk.threads`, `bb.sdk.environments`, and `bb.sdk.files`.

The plugin never uses server-side `node:fs` for an invoking-host path. It creates and gets terminals through `bb.sdk.terminals`. It reads runner artifacts through `bb.sdk.files.read` with the terminal's explicit `hostId` and the supplied artifact root as `rootPath`. This keeps environment and enrolled-host routing at the BB host boundary. There is no host entry because the terminal process itself runs on the selected host.

The generated terminal command has the exact fixed prefix `exec "$HOME/.local/bin/terminal-job-runner"`; `$HOME` expands in the terminal shell, including when it contains spaces. Every later generated and user argument is separately POSIX-single-quoted. The target host needs a POSIX shell, Node 22, and the dotfiles runner link before `run`; a missing runner settles as a normal failed terminal with a missing outcome when the create response is available. The plugin never uses `eval`. The original argv is passed as an array, stored as JSON in plugin state and `launch.json`, and never reconstructed by splitting a command string.

The installed BB host-daemon source confirms that every terminal scope injects `BB_TERMINAL_SESSION_ID` (`apps/host-daemon/src/terminals/terminal-manager.ts`, `buildTerminalEnv`), and its tests pin the value. The runner treats this terminal ID as expected but nullable. Job ID and immutable owner are the authoritative artifact markers. An absent terminal env value is recorded as `null`/`unknown`; it never invalidates an otherwise matching outcome or becomes success. A conflicting non-null terminal ID is invalid. Validation also creates one harmless real BB terminal that writes this variable to a temporary file, then checks the file and terminal metadata; it does not install the plugin.

## Artifact contract

For `run`, generate an unguessable `job_<uuid>` before terminal creation and compute this target-host directory; the runner creates it:

```text
<artifact-root>/<job-id>/
  launch.json
  output.log
  outcome.json
```

The runner creates directories with mode `0700`, files with mode `0600`, and writes `launch.json` and `outcome.json` by fsync/close plus same-directory atomic rename. `launch.json` contains schema version, job ID, nullable terminal ID from `BB_TERMINAL_SESSION_ID`, immutable owner, exact argv, ISO-8601 UTC start time, and artifact paths. The runner uses `/bin/sh -c 'exec "$@" 2>&1'` only as a safe argv-preserving fd merger, with a fixed `$0` placeholder and the original command in positional arguments. It does not evaluate command text. The child receives one combined pipe, so `output.log` and the terminal receive the same ordered bytes. The child does not receive a TTY; programs can change color/progress/interactive behavior. Partial output remains if the runner or daemon is killed.

`outcome.json` contains schema version, job ID, nullable terminal ID, owner, exact command exit code or signal, shell-compatible status, result (`success`, `failure`, `signaled`, or `launch-failed`), ISO-8601 UTC start and finish times, duration, and log path. One runner-owned schema module is the source for artifact field names/version; a contract fixture feeds a real runner artifact unchanged into the plugin decoder to catch drift. The runner returns the command's exit status. For a signal it records a nullable command exit code plus the exact signal and returns `128 + signal number`. A runner signal is forwarded to the child; forced loss can prevent the outcome rename, which is represented as missing outcome rather than inferred success.

`watch` stores only the supplied log path. Its outcome state is `not-applicable`, and its completion text says that it has no runner outcome. No code calls `terminals.output` after exit or claims BB scrollback recovery.

## Persistence schema

Use the plugin-owned SQLite database and one append-only initial migration. The `jobs` table stores:

- identity: `job_id` primary key, stable marker, source (`run` or `watch`), schema version;
- immutable owner and launch data: owner thread ID, delivery mode, title, scope kind and strict scope JSON, host ID, command argv JSON, created time;
- artifacts: artifact root, job directory, launch path, log path, outcome path;
- terminal observation: terminal ID, terminal state, last BB status, nullable exit code, nullable close reason, last observation error, observed and exited times;
- outcome observation: outcome state, validated outcome JSON, outcome error, checked time;
- delivery outbox: state, attempt count, nullable next-attempt time, last error, accepted delivery kind, reservation service-run token, ambiguous-attempt count, attempted and delivered times;
- row update time.

Strict row decoders reject impossible enums or malformed JSON instead of silently changing meaning. SQLite transactions and conditional updates reserve transitions.

Terminal state is independent from delivery state:

```text
preparing -> observing -> exited
    \-> launch_ambiguous   \-> unavailable
```

`starting`, `running`, and `disconnected` remain exact `last_bb_status` observations under `observing`. A terminal-not-found response retries for a 30-second consistency window before settling `unavailable` with null exit/close metadata; other observation failures remain unresolved and retry. `exited` copies BB's real nullable `exitCode` and `closeReason`. It then checks the outcome file. A valid matching job/owner marker becomes `present`; an absent terminal marker becomes `unknown` metadata within that valid outcome; an absent file becomes `missing`; malformed JSON or conflicting job/owner/non-null terminal markers becomes `invalid`; a transient host-file error leaves the job unresolved for another check. None of `missing`, `invalid`, unknown terminal metadata, or nullable BB exit becomes success.

Delivery state is:

```text
pending -> delivering -> delivered
                     \-> retry_wait
                     \-> abandoned
```

One conditional SQLite update reserves `delivering` before `threads.send` and stores the current service-run token. Accepted `sent`, `queued`, and `deferred` results become `delivered`. Installed server source confirms that `queued` creates a durable queued-message row and `deferred` creates a durable deferred-message row before returning; both are BB-owned accepted state. Default delivery cannot interrupt an active owner. Definite transient failures become `retry_wait` with exponential backoff from 1 second to a 5 minute cap. Definite missing/deleted/archived owner errors and other permanent 4xx request/permission failures become `abandoned`. Status preserves the last error and next retry.

The plugin makes no exactly-once claim. Each background-service `start` creates a fresh service-run token. A process crash after BB accepts a send and before SQLite stores the acknowledgement leaves `delivering` with the prior token. Service startup converts only foreign-token `delivering` rows to immediate `retry_wait`, records that acceptance is unknown, and increments the ambiguity count. A same-token in-flight row is never reclaimed concurrently, and manual retry refuses it. A later foreign-token retry can duplicate the message. Every attempt uses the same `[terminal-job:<job-id>]` marker, so the owner can identify that duplicate.

## Service and restart behavior

A single abortable `bb.background.service` processes at most 100 jobs and 100 due deliveries per pass, polls active terminals every 1 second, and sleeps with an abort-aware timer until the earlier of the next poll or retry. CLI registration wakes it after a new job or explicit retry. Notification retries have no attempt ceiling; their delay is capped at 5 minutes and status remains inspectable.

Each pass:

1. recovers foreign-service-token ambiguous `delivering` rows;
2. recovers `preparing` rows from target-host `launch.json`, then polls unresolved jobs by stored terminal ID;
3. records exact terminal exit or terminal-not-found uncertainty;
4. reads and validates expected outcome artifacts through the stored host/root boundary;
5. reserves and sends due notifications;
6. sleeps until the next poll or notification retry, with bounded work per pass.

Before inserting `preparing`, the plugin resolves and stores the target host: machine scope supplies it, environment scope comes from `environments.get`, and thread scope comes from its required environment. A fast command may exit before `terminals.create` returns or before the DB row receives the terminal ID. The runner atomically writes `launch.json` as its first target-host action, including the injected terminal ID when present. After create, one transaction stores the returned terminal ID/host and enters `observing`; immediate reconciliation observes an already-exited row.

On restart, a `preparing` row reads its confined `launch.json`. A valid non-null terminal ID recovers it into `observing`, covering create acceptance without response and response-before-persistence. Before create, no file exists. If no recoverable marker appears within a 2-minute launch deadline, the row settles `launch_ambiguous`, records that create acceptance and terminal identity are unknown, and notifies without claiming that no terminal exists. A definite synchronous create rejection settles `unavailable` immediately. These are bounded, honest states; an orphan terminal remains a residual risk only at the accepted-without-response boundary when its runner never writes a marker.

Server or plugin restart reloads every unresolved SQLite row. Provider restart has no effect. Completion while the server is down leaves target-host log/outcome artifacts for the next pass. A daemon/full restart can end the command; later BB terminal metadata is authoritative when present, while partial logs remain and a missing outcome is reported as unknown/interrupted. Deleted BB scrollback remains unavailable.

## Completion message

Each completion message includes:

- stable `[terminal-job:<job-id>]` marker;
- title, terminal ID, exact observed BB status, nullable exit code, and close reason;
- runner outcome result, exact command exit/signal when present, or explicit missing/invalid/not-applicable uncertainty;
- duration when known;
- target-host log and outcome paths;
- `bb terminal-job show <job-id> --json` for authoritative status.

Message size is bounded below the plugin CLI/output limits. Truncation drops title detail first, then shortens displayed paths while preserving their full values in status, then drops optional duration detail. It never truncates the marker, terminal ID, uncertainty, or status command.

## Security and compatibility

- Treat command argv and logs as sensitive local data. Store artifact files as `0600`, job directories as `0700`, and plugin state only in the plugin-owned database. Documentation tells users to use environment variables or secret files instead of secrets in argv.
- Require POSIX absolute artifact/log paths, reject NUL bytes and control characters in IDs/options, derive the run directory only by appending the generated job ID, and confine SDK file reads with `rootPath`. Do not accept a caller-selected job ID or arbitrary outcome path. `watch` requires the `--log` value but does not require the file to exist at registration because the watched command can create it later.
- Pass command arguments only after literal `--`; preserve empty strings, spaces, Unicode, quotes, glob characters, substitutions, and newlines as data. The runner uses only the fixed POSIX-shell fd-merger described above; it never interpolates or evaluates command text.
- The runner does not elevate privileges, alter the command environment, or read BB scrollback.
- Pin the current installed SDK package and declare honest `engines.bb` / `engines.bbPluginSdk` floors from `bb plugin types`. Authoritative installed SDK 0.4.18 confirms terminal nullable exit/close fields, delivery modes, and accepted response enum. Keep runtime dependencies empty unless authoritative types or build behavior prove one is required.
- V1 has deliberate unbounded audit retention: it never deletes plugin rows or caller-owned artifact directories. Operators remove selected artifact directories themselves and remove the plugin to delete its database. This avoids silent evidence loss but creates a documented sensitive-disk-growth residual risk.
- Review-panel and update-bb continue unchanged in this scope. They are proven specialized callers. Migration to `terminal-job` is deferred until this opt-in plugin is installed and operated successfully; no shared extraction is justified across the shell/plugin package boundary now.

## High-value tests

Tests enter through the runner process, plugin CLI harness, real SQLite repository, or reconciler service boundary. They do not assert private call order when persisted/user-visible state is the contract.

1. Runner processes exit 0 and exit 2: exact combined bytes remain in `output.log`, terminal output receives them, atomic outcome fields are exact, and the runner status matches.
2. Runner child signal and runner-forwarded signal: partial output remains, the exact signal and signal-derived status are recorded when cleanup can run, and forced loss leaves no false success marker.
3. End-to-end argv fixture: spaces, empty strings, Unicode, quotes, newlines, glob and shell metacharacters reach the child unchanged and no substitution/evaluation occurs.
4. CLI/service race: a terminal returned already exited settles correctly after registration by stored terminal ID.
5. Delivery outcomes: an idle owner returns `sent`, an active owner returns `queued`, and an interaction returns `deferred`; all three persist accepted delivery once.
6. Mode policy: default sends `queue-if-active`; only explicit `--delivery steer` sends `steer-if-active`.
7. Repeated polls and duplicate exit observations retain one logical reservation and one accepted send.
8. Restart before terminal exit and after terminal exit recreates the service over the same SQLite database and settles unresolved state.
9. A transient send failure persists capped backoff and succeeds after restart; deleted/permanently unwritable owner becomes inspectable `abandoned`; explicit retry resets it.
10. Crash boundary fixtures: a foreign service-run token in `delivering` retries once; a same-token in-flight send plus manual retry cannot reserve twice; simulated acceptance followed by lost acknowledgement produces a possible duplicate with the same stable marker and increments ambiguity.
11. Daemon disconnect/terminal unavailable keeps real nullable exit and close reason, validates any matching outcome, and never maps missing/invalid outcome to success.
12. Existing terminals are absent from state until explicit `watch`; already-exited watch settles immediately; watch rejects an omitted/non-absolute durable log path and states that no scrollback was recovered.
13. Path and parser tests reject traversal/control errors, conflicting scopes, missing owner, malformed outcome, conflicting job/non-null terminal/owner markers, and command omission. The full owner-default matrix, machine cwd default/override, two concurrent jobs, and argv SQLite round trip are pinned.
14. Status tests pin the complete public JSON shape, unknown-job errors, retry state matrix, sensitive argv omission, and bounded errors/messages so inspection cannot overflow the plugin CLI contract.
15. Launch-boundary restart tests cover before create, create accepted without response, and response received before terminal-ID persistence. Missing runner, unwritable artifact root, absent `BB_TERMINAL_SESSION_ID`, transient host-file errors, root confinement, and runner/plugin schema drift each remain explicit uncertainty without false success.
16. The generated terminal command runs through a real POSIX shell with a spaced `HOME`; it proves expansion, `exec`, exact hostile argv, exit status, and signal delivery. An isolated link-home fixture proves the executable guard, runner link, and existing-file backup behavior.

## Validation and acceptance

Before implementation review:

- record the clean pre-implementation Git SHA;
- run `bb plugin types plugins/terminal-jobs`; if it changes the exact SDK pin, run `npm install` to refresh the standalone lockfile, then require `bb plugin types plugins/terminal-jobs --check`; run TypeScript, focused Vitest files, and the full plugin test suite;
- run runner tests as real child processes, including status, signal, shell-prefix quoting, partial-log, missing-outcome, restart, and duplicate-marker scenarios;
- run `bb plugin build plugins/terminal-jobs` and inspect `dist/server.meta.json` for plugin ID/version/current SDK compatibility;
- load the backend factory with the official fake-plugin host and run its registered service/CLI; do not install or reload it in live BB;
- run the new top-level `tests/terminal-job-runner.sh`/link fixture plus all existing dotfiles shell tests, `bash -n` on changed shell files, and ShellCheck on changed shell files when available; the plugin's Vitest suite owns the runner/artifact contract tests while the top-level test preserves the repo's `bin/` convention;
- inspect package contents/boundaries (`npm pack --dry-run` or equivalent) so no app/host entry, source secret, test artifact, runtime database, or unrelated file ships;
- scan the feature diff and package for common credential/private-key patterns;
- document standalone `npm ci`, `npm test`, typecheck, build, status/retry, artifact cleanup, target-host prerequisites, and the later opt-in install/reload commands in `plugins/terminal-jobs/README.md`;
- run `git diff --check` and verify the review candidate is clean after its final commit.

Acceptance requires durable exact-owner job rows, target-host artifacts, real terminal/outcome uncertainty, restart reconciliation, default queued completion, explicit retry/status, stable-marker at-least-once behavior, and all validation above. Exactly one successful plan review and one successful implementation review are recorded. Required review findings are resolved within those same cycles; deferred findings are only non-required and are listed with evidence.
