# Firstmate Queue

A personal BB 0.41 plugin that projects one Firstmate manager's current direct children into a queue panel.

BB owns thread titles, lifecycle state, queued-work state, archive state, parent relationships, and durable completion events. The plugin stores only review annotations and the user-managed mode in its SQLite database.

## Settings

- `managerThreadId` is required. It authorizes one manager thread.
- `agentWritesEnabled` defaults to `false`. The panel stays readable while annotation writes and manager instructions are disabled.

Set values through BB plugin settings. Do not track a manager thread ID in this repository. If the plugin reports a missing, archived, or deleted manager, correct the setting and run `bb plugin reload firstmate-queue`; Plugin SDK 0.4.36 cannot clear `needs-configuration` status in process. A transient lookup failure is a runtime error and does not change plugin status.

## Queue behavior

The panel shows three sections: Needs your response, In progress, and Done. It includes visible and hidden direct children across projects. It excludes grandchildren, archived threads, deleted threads, and threads moved to another parent.

Use I’m handling this to make a child user-managed. User-managed idle children always need your response. Archive validates that the target is still a current direct child, then archives it through BB.

`firstmate_queue_update` is the only agent annotation writer. When enabled, only the configured manager receives it. The tool records a Markdown summary, an idle disposition, and the latest durable `turn/completed` sequence.

## Development

The package keeps the Plugin SDK dependency at the plain version `0.4.36`. Because that version is not public on npm, the matching development tarball is committed under `vendor/` and the lockfile resolves only its installed package entry to that file. A clean checkout installs deterministically:

```bash
npm ci
../../tests/firstmate-queue-plugin.sh
bb plugin types --check .
bb plugin build .
```

When BB or its Plugin SDK version changes, build BB’s `packages/plugin-sdk`, remove the old tarball, and repack the new version:

```bash
rm vendor/get-bb-plugin-sdk-*.tgz
npm pack --json --pack-destination vendor /path/to/bb/packages/plugin-sdk
```

Keep `devDependencies.@get-bb/plugin-sdk` and the lockfile root dependency as the plain exact version. In `package-lock.json`, set only `node_modules/@get-bb/plugin-sdk.resolved` to `file:vendor/<generated-file>.tgz` and its `integrity` to the value from `npm pack --json`. Then run `npm ci`, `bb plugin types --check .`, the tests, and the build.

## Cutover

Keep `agentWritesEnabled` set to `false` until the existing Firstmate and rotation instructions no longer read or write `FIRSTMATE-QUEUE.md` and their focused tests pass. Then rebuild current annotations through normal plugin tool calls. Enable agent writes only after those steps.

For a later Firstmate rotation, update `managerThreadId` before queue work resumes.
