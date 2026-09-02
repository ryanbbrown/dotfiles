# Smart Queue personal plugin

## Goal

Build a personal BB 0.41.0 plugin at `plugins/firstmate-queue` that replaces manual queue state after a later explicit cutover. The plugin is scoped to one configured Firstmate manager thread and uses BB as the authority for child-thread facts.

## Final behavior

- Register one `PluginAppSlots.threadPanelAction`.
- Its `run` opens the panel only when `context.threadId` equals the configured manager thread ID.
- The panel component independently refuses to render queue content when `PluginThreadPanelProps.threadId` does not equal the configured manager ID.
- Child titles call `useBbNavigate().toThread(childThreadId)`. Do not use split navigation.
- A typed `archiveThread` RPC archives without confirmation through `bb.sdk.threads.archive({ threadId })` after exact-child validation.
- Only exact direct children of the configured manager are ordinary rows. Include children across projects and exclude grandchildren.
- The plugin reads current BB thread status, queued work, archive state, and event history. It does not persist copied thread status.
- Plugin SQLite stores summary Markdown, idle disposition, reviewed event sequence, user-management mode, and annotation timestamps.
- `firstmate_queue_update` is the only Firstmate annotation write interface.
- Agent writes are disabled by default. Live validation can inspect the BB-derived panel without injecting competing manager instructions; the parent enables writes only during its explicit cutover.
- No old queue file support, migration UI, compatibility path, global panel, additional manager, root-owned queue items, or BB core change.

## State projection

Derive the three sections in this order:

1. Archived or deleted: omit.
2. `status === "error"` or `queuedWork === "failed"`: **Needs your response**.
3. `queuedWork === "waiting"`: **In progress**.
4. `status` in `pending | starting | active | stopping`: **In progress**.
5. `status === "idle"` and user-managed: **Needs your response**.
6. `status === "idle"`, Firstmate-managed, and no annotation: **Needs your response**. Show **New result** when durable completion history has a `turn/completed` sequence; otherwise show **Awaiting Firstmate review**.
7. `status === "idle"`, Firstmate-managed, and `latestCompletionSeq > reviewedThroughSeq`: **Needs your response**, with deterministic **New result** state.
8. Other idle Firstmate-managed row: use stored `needs_response | done` disposition.

These are the complete BB 0.41.0 tuples: `status` is `pending | starting | active | stopping | idle | error`; `queuedWork` is `none | waiting | failed`. Parse both at the boundary and fail the snapshot with an explicit contract error for any unknown value rather than dropping a row. Treat missing `reviewedThroughSeq` as zero. Compute `latestCompletionSeq` from durable BB thread event history, not from an in-memory lifecycle event. Durable error and queued failure facts preserve precedence after restart.

User-managed mode keeps automatic title, link, lifecycle, queued-work, error, and archive tracking. It rejects `firstmate_queue_update` writes and, after activation, injects manager instructions that forbid unsolicited child follow-ups. Turning user-managed mode off atomically sets the idle disposition to `needs_response` while preserving the review cursor; it does not restore an old decision or infer Done.

## Backend

1. Scaffold a BB plugin using `@get-bb/plugin-sdk` 0.4.36 and the current manifest contract.
2. Declare two non-secret settings: required `managerThreadId` and `agentWritesEnabled`, default `false`. Read current settings for every RPC and agent-configuration call, so a manager change applies without plugin reload. The panel remains readable while writes are disabled; `bb.agents.configure` exposes no tool or competing instructions. If the configured manager is archived or deleted, plugin status/logs report stale configuration; automatic rotation support remains outside version 1.
3. Create one plugin-owned SQLite annotation table through `bb.storage.database()` and append-only schema setup. Archive, delete, and reparenting remove rows only from the current projection; annotation retention across later unarchive or reparent-back is intentionally unchanged because the approved behavior defines removal from view, not destructive annotation cleanup.
4. Implement a queue service that:
   - pages `bb.sdk.threads.list({ parentThreadId, archived: false, includeHidden: true })` without a project filter;
   - reads queued-message state and durable `turn/completed` event sequences;
   - uses the BB snapshot title as the cross-project fallback and durable status/queued-work facts for projection;
   - merges BB facts with annotation rows;
   - derives sections with a pure projection function;
   - validates exact direct-child membership before writes.
5. Register typed RPC methods for:
   - queue snapshot, requiring the requested surface thread to equal the configured manager;
   - user-management toggle, requiring the target to be a current direct child whose durable row is neither archived nor deleted; error and hidden children are live. Perform mode/disposition changes in one SQLite `BEGIN IMMEDIATE` transaction;
   - `archiveThread`, requiring the same configured-manager and exact-live-child checks, then calling `bb.sdk.threads.archive`. The frontend removes the row optimistically, restores it on RPC failure, and shows the bounded error. There is one archive path.
6. Register `firstmate_queue_update` with bounded input and output. Validate configured caller, activation, exact direct child, live thread, Firstmate-managed mode, summary size of at most 4,000 Unicode characters, and disposition. Do not require the agent to guess a sequence: read the latest durable completion sequence before the SQLite transaction, validate mode and write inside `BEGIN IMMEDIATE`, then re-read the BB thread. If archive or reparent won the race, delete the just-written annotation and return `not_current_child`; otherwise publish invalidation. Persist the pre-transaction completion sequence, so a completion racing the write remains newer and appears as **New result**.
7. Use `bb.agents.configure` to expose the tool and queue instructions only when both the caller is the configured manager and `agentWritesEnabled` is true. A Firstmate rotation requires the operator to update `managerThreadId`; automatic rotation support is outside the approved one-manager scope.
8. Subscribe to `thread.created`, `thread.active`, `thread.idle`, `thread.failed`, `thread.archived`, `thread.deleted`, `message.queued`, `message.dispatched`, and `turn.failed`. Publish one bounded realtime invalidation after relevant direct-child changes. Dispose listeners through plugin lifecycle cleanup.
9. Treat events as hints. Every server/plugin start and every frontend reconnect obtains a full authoritative snapshot. Reparenting and hidden-thread title edits have no suitable public lifecycle event; the frontend’s live `experimental_useSidebarThreads()` view triggers reconciliation for visible changes, and a 15-second panel-mounted snapshot refresh covers hidden or missed changes. Mount and reconnect also refetch immediately.

## Frontend

1. Register one padded `threadPanelAction` titled **Firstmate queue**.
2. Guard both action open and component render by the configured manager thread ID. Missing configuration is handled in plugin settings/status; it is intentionally not a panel state because no thread is authorized to open the panel.
3. Render three sentence-case sections: **Needs your response**, **In progress**, and **Done**.
4. Each row contains:
   - normal thread-title navigation;
   - current status label;
   - concise summary or deterministic New result marker;
   - **I’m handling this** toggle;
   - **Archive** action.
5. Use native buttons, accessible names, visible focus states, non-color status text, wrapping summaries, and BB visual tokens/components.
6. Show explicit loading, activation-disabled, empty, and RPC error states.
7. Subscribe with `useRealtime`; on signals refetch the snapshot. Use `useRealtimeConnectionState()` to refetch after reconnect and a 15-second refresh only while the panel is mounted. Use BB’s global live sidebar thread array for immediate visible parent/title/archive changes. Snapshot data remains authoritative for hidden and cross-project children. `BbNavigate.toThread` works by thread ID across projects; every Archive control uses the one typed RPC.
8. Do not register a New thread, child-thread, navigation, homepage, or global queue surface.

## Tests

### Backend

- Projection table covers every status, waiting/failed queued work, user-managed idle, a new idle child with no annotation, completion at the cursor boundary, unreviewed completion, reviewed Needs, reviewed Done, archive, and durable error precedence after restart.
- Paged cross-project exact-parent discovery includes visible and hidden direct children, excludes grandchildren, and handles more than one page.
- Agent tool accepts a current manager-owned direct child, captures the durable completion cursor, and persists exact annotation fields.
- Agent tool rejects disabled activation, wrong caller, non-child, archived/deleted child, user-managed child, and oversized summary.
- Concurrent toggle and agent update serialize so no summary lands after user-managed mode wins; a completion racing an update remains New.
- Toggle-on makes idle Needs and blocks writes; toggle-off atomically requires fresh review.
- Archive, delete, and reparent remove a row from projection; unarchive or reparent-back restores retained annotation state.
- An annotation write racing archive or reparent cannot leave a newly written annotation for a non-child.
- Reconciliation recovers current projection after missed lifecycle events, title edits, reparenting, and plugin restart.
- Relevant events publish invalidation; unrelated threads do not.

### Frontend

- Action opens only for the configured manager thread; missing configuration stays in settings/status.
- Component renders no queue content for another thread ID.
- Sections, unannotated idle state, and deterministic New result text render from the snapshot.
- Title uses normal `toThread` navigation with no split action.
- Archive calls the one typed backend RPC, removes the row optimistically without confirmation, and restores it on a bounded failure.
- Toggle mutation and refresh behavior are observable.
- Loading, empty, activation-disabled, and error states are accessible.
- A hidden or cross-project child absent from the visible sidebar cache keeps its snapshot title, navigation, and archive action; a mounted-panel refresh picks up a rename.

Prefer behavior tests through SDK boundaries and exported pure projection functions. Avoid snapshot-only tests and mock-call tests that do not prove user-visible or persisted outcomes.

## Validation

1. Use a standalone package at `plugins/firstmate-queue` with its own `package.json`, lockfile, TypeScript/Vitest config, and package-local ignores for `node_modules`, `dist`, and coverage. Add concise plugin documentation plus root README inventory/install notes and a top-level shell test entry point consistent with this repository.
2. Run focused backend and frontend tests.
3. Run type checking and `bb plugin types` against the installed BB 0.41.0 / Plugin SDK 0.4.36 declarations already verified in `/Users/ryanbrown/code/bb`.
4. Run `bb plugin build` and inspect generated server/app bundles and manifest; require a clean status after the reviewed commit.
5. Update the root README’s layout and plugin policy to state that personal plugins can live under `plugins/`; the existing Terminal Jobs sentence remains a package-specific exception.
6. Install with `bb plugin install ~/code/dotfiles/plugins/firstmate-queue`; use `bb plugin reload firstmate-queue` after source changes.
7. Configure the current parent Firstmate thread ID through runtime plugin settings, never a tracked source file, and leave `agentWritesEnabled = false` during validation.
8. Inspect `bb plugin list/show`, plugin logs, settings, and runtime status.
9. In BB, verify:
   - Firstmate’s panel action opens and renders;
   - the guarded action does not open queue content on this child or another thread;
   - a row title performs normal navigation;
   - archive needs no plugin confirmation;
   - direct child lifecycle/realtime changes reconcile;
   - restart/reload restores the same state.
10. Run existing dotfiles regression tests, including `tests/firstmate-skills.sh`, to prove the pre-cutover workflow remains unchanged.
11. Do not populate current queue annotations or activate manager tools. Report this strict parent-owned cutover order: first change the Firstmate and rotation instructions so they no longer read or write the prior queue and run their focused tests; then rebuild current annotations through normal plugin tool calls; only then set `agentWritesEnabled = true`. Those instruction edits are not part of this plugin implementation. For a future Firstmate rotation, update `managerThreadId` in plugin settings before resuming queue work.

## Repository and review flow

- Develop in the clean `smart-queue-plugin` worktree from base `ab27dd088287e77c32fcc59b66486cc79352dc43` because canonical dotfiles has unrelated approved work in progress.
- Run exactly one plan-review panel cycle and resolve accepted findings.
- Record a clean pre-implementation base after the plan is settled.
- Use one implementation child as the only code writer.
- Run exactly one implementation-review panel cycle against that base, resolve accepted findings with the same child, and rerun validation.
- Commit the reviewed plugin on the feature branch. Apply that commit to canonical dotfiles only if it does not disturb unrelated changes, then build/install from the canonical path.

## Decisions

- D1: BB owns thread facts; SQLite owns only annotations and ownership mode.
- D2: One configured manager thread; exact-parent membership is cross-project.
- D3: One guarded manager-thread panel; normal same-pane child navigation.
- D4: `firstmate_queue_update` is the only Firstmate annotation writer.
- D5: User-managed idle means Needs; no user-managed Done override.
- D6: One validated backend archive RPC, optimistic row removal, and no plugin confirmation.
- D7: Event invalidation plus full reconciliation, not an event-sourced status mirror.
- D8: Agent writes stay disabled until explicit cutover; UI validation does not create competing manager instructions.
- D9: Include hidden direct children; root-owned decisions must use a direct child, and automatic manager rotation is outside version 1.
- D10: Archive and reparent remove rows from view but do not destroy retained annotations.
- D11: No prior-store, global-panel, core, or multi-manager scope.
