import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Markdown,
  definePluginApp,
  experimental_useSidebarThreads,
  useBbNavigate,
  useRealtime,
  useRealtimeConnectionState,
  useRpc,
  useSettings,
  type PluginThreadPanelProps,
} from "@get-bb/plugin-sdk/app";
import { toast } from "sonner";
import type { QueueRow, rpcContract } from "./contract.js";

const DISCLOSURE_STORAGE_PREFIX = "firstmate-queue.row-disclosure.";
const INVALIDATION_DEBOUNCE_MS = 100;
const REFRESH_INTERVAL_MS = 15_000;
const PLUGIN_ID = "firstmate-queue";

interface Snapshot {
  managerThreadId: string;
  agentWritesEnabled: boolean;
  rows: QueueRow[];
}

type LoadState =
  | { status: "loading" }
  | { status: "ready"; snapshot: Snapshot }
  | { status: "error"; message: string };

function formatUpdatedAt(timestamp: number): string {
  return new Date(timestamp).toLocaleString(undefined, {
    dateStyle: "short",
    timeStyle: "short",
  });
}

function boundedError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.length <= 240 ? message : `${message.slice(0, 239)}…`;
}

async function actionMayOpen(threadId: string): Promise<boolean> {
  try {
    const response = await fetch(`/api/v1/plugins/${PLUGIN_ID}/rpc/canOpen`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ surfaceThreadId: threadId }),
    });
    const envelope = (await response.json()) as {
      ok?: boolean;
      result?: { canOpen?: boolean };
      error?: { message?: string };
    };
    if (response.ok && envelope.ok === true) {
      return envelope.result?.canOpen === true;
    }
    const reason = boundedError(
      envelope.error?.message ?? "The authorization request failed.",
    );
    toast.error(`Could not open Firstmate queue: ${reason}`);
  } catch (cause) {
    toast.error(`Could not open Firstmate queue: ${boundedError(cause)}`);
  }
  return false;
}

function StateBox({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground">
      {children}
    </div>
  );
}

function useQueueSnapshot(threadId: string) {
  const rpc = useRpc<typeof rpcContract>();
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const requestSequence = useRef(0);

  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const snapshot = await rpc.call("queueSnapshot", {
        surfaceThreadId: threadId,
      });
      if (sequence === requestSequence.current) {
        setState({ status: "ready", snapshot });
      }
    } catch (cause) {
      if (sequence === requestSequence.current) {
        setState({ status: "error", message: boundedError(cause) });
      }
    }
  }, [rpc, threadId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const invalidationTimeout = useRef<number | undefined>(undefined);
  const scheduleInvalidationRefresh = useCallback(() => {
    if (invalidationTimeout.current !== undefined) {
      window.clearTimeout(invalidationTimeout.current);
    }
    invalidationTimeout.current = window.setTimeout(() => {
      invalidationTimeout.current = undefined;
      void refresh();
    }, INVALIDATION_DEBOUNCE_MS);
  }, [refresh]);
  useEffect(
    () => () => {
      if (invalidationTimeout.current !== undefined) {
        window.clearTimeout(invalidationTimeout.current);
      }
    },
    [],
  );
  useRealtime("queue-invalidated", scheduleInvalidationRefresh);

  const connection = useRealtimeConnectionState();
  const wasDisconnected = useRef(false);
  useEffect(() => {
    if (connection !== "connected") {
      wasDisconnected.current = true;
      return;
    }
    if (!wasDisconnected.current) return;
    wasDisconnected.current = false;
    void refresh();
  }, [connection, refresh]);

  useEffect(() => {
    let cancelled = false;
    let timeout: number | undefined;
    const schedule = () => {
      timeout = window.setTimeout(() => {
        void refresh().finally(() => {
          if (!cancelled) schedule();
        });
      }, REFRESH_INTERVAL_MS);
    };
    schedule();
    return () => {
      cancelled = true;
      if (timeout !== undefined) window.clearTimeout(timeout);
    };
  }, [refresh]);

  const sidebar = experimental_useSidebarThreads();
  const sidebarFingerprint = useMemo(
    () =>
      sidebar.threads
        .filter((thread) => thread.parentThreadId === threadId)
        .map(
          (thread) =>
            `${thread.id}\u0000${thread.title ?? ""}\u0000${thread.titleFallback ?? ""}\u0000${thread.isArchived}`,
        )
        .sort()
        .join("\u0001"),
    [sidebar.threads, threadId],
  );
  const priorFingerprint = useRef(sidebarFingerprint);
  useEffect(() => {
    if (priorFingerprint.current === sidebarFingerprint) return;
    priorFingerprint.current = sidebarFingerprint;
    scheduleInvalidationRefresh();
  }, [scheduleInvalidationRefresh, sidebarFingerprint]);

  const supersedeRefresh = useCallback(() => {
    requestSequence.current += 1;
  }, []);

  return { rpc, state, setState, refresh, supersedeRefresh };
}

interface RowDisclosureState {
  collapsed: boolean;
  fingerprint: string;
}

function rowContentFingerprint(row: QueueRow): string {
  return JSON.stringify([row.detail, row.summaryMarkdown]);
}

function disclosureStorageKey(threadId: string): string {
  return `${DISCLOSURE_STORAGE_PREFIX}${threadId}`;
}

function readRowDisclosure(
  threadId: string,
  fingerprint: string,
): RowDisclosureState {
  try {
    const stored = JSON.parse(
      window.localStorage.getItem(disclosureStorageKey(threadId)) ?? "null",
    ) as Partial<RowDisclosureState> | null;
    if (
      stored?.fingerprint === fingerprint &&
      typeof stored.collapsed === "boolean"
    ) {
      return { collapsed: stored.collapsed, fingerprint };
    }
  } catch {
    // Local state remains available when browser storage is unavailable.
  }
  return { collapsed: false, fingerprint };
}

function writeRowDisclosure(
  threadId: string,
  disclosure: RowDisclosureState,
): void {
  try {
    window.localStorage.setItem(
      disclosureStorageKey(threadId),
      JSON.stringify(disclosure),
    );
  } catch {
    // Local state remains available when browser storage is unavailable.
  }
}

function QueueRowView({
  row,
  mutation,
  onNavigate,
  onToggle,
  onArchive,
}: {
  row: QueueRow;
  mutation: string | null;
  onNavigate: () => void;
  onToggle: () => void;
  onArchive: () => void;
}) {
  const busy = mutation !== null;
  const fingerprint = rowContentFingerprint(row);
  const [disclosure, setDisclosure] = useState<RowDisclosureState>(() =>
    readRowDisclosure(row.id, fingerprint),
  );
  const collapsed =
    disclosure.fingerprint === fingerprint && disclosure.collapsed;
  useEffect(() => {
    writeRowDisclosure(row.id, { collapsed, fingerprint });
  }, [collapsed, fingerprint, row.id]);
  const toggleDisclosure = () => {
    const next = { collapsed: !collapsed, fingerprint };
    setDisclosure(next);
    writeRowDisclosure(row.id, next);
  };
  const contentId = `firstmate-queue-row-content-${row.id}`;

  return (
    <li className="rounded-lg border border-border bg-card px-3 py-2.5">
      <div className="flex min-w-0 flex-wrap items-start gap-2">
        <button
          type="button"
          className="prompt-mention-pill inline-flex min-h-7 min-w-0 max-w-full cursor-pointer items-center gap-1 rounded-full border py-1 pl-1.5 pr-2 text-start text-sm font-normal leading-5 no-underline hover:bg-state-hover focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          onClick={onNavigate}
        >
          <svg
            aria-hidden="true"
            className="-ml-px size-4 shrink-0 self-center"
            fill="none"
            viewBox="0 0 24 24"
          >
            <path
              d="M17 8.5C17 5.73858 14.7614 3.5 12 3.5C9.23858 3.5 7 5.73858 7 8.5C7 11.2614 9.23858 13.5 12 13.5C14.7614 13.5 17 11.2614 17 8.5Z"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
            <path
              d="M19 20.5C19 16.634 15.866 13.5 12 13.5C8.13401 13.5 5 16.634 5 20.5"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
            />
          </svg>
          <span className="min-w-0 break-words">{row.title}</span>
        </button>
        {row.section === "needs_response" ? (
          <time
            className="self-center text-[11px] text-muted-foreground"
            dateTime={new Date(row.updatedAt).toISOString()}
          >
            Updated {formatUpdatedAt(row.updatedAt)}
          </time>
        ) : null}
        <div className="ml-auto flex shrink-0 items-center gap-2">
          <button
            type="button"
            aria-controls={contentId}
            aria-expanded={!collapsed}
            aria-label={`${collapsed ? "Expand" : "Collapse"} details for ${row.title}`}
            className="inline-flex size-6 cursor-pointer items-center justify-center rounded-md text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            onClick={toggleDisclosure}
          >
            <svg
              aria-hidden="true"
              className="size-3.5"
              fill="none"
              viewBox="0 0 24 24"
            >
              <path
                d={collapsed ? "M9 6L15 12L9 18" : "M6 9L12 15L18 9"}
                stroke="currentColor"
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth="1.75"
              />
            </svg>
          </button>
          <span className="text-xs text-muted-foreground">
            {row.statusLabel}
          </span>
          <button
            type="button"
            disabled={busy}
            onClick={onArchive}
            className="inline-flex min-h-6 cursor-pointer items-center rounded-md border border-border bg-background px-1.5 text-xs font-medium text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
            aria-label={`Archive ${row.title}`}
          >
            Archive
          </button>
        </div>
      </div>
      <div id={contentId} hidden={collapsed}>
        {row.state === "error" || row.state === "queued_failed" ? (
          <div className="mt-2 space-y-2">
            <p className="break-words text-sm text-destructive">{row.detail}</p>
            {row.summaryMarkdown === null ? null : (
              <Markdown
                content={row.summaryMarkdown}
                className="break-words text-sm text-muted-foreground"
              />
            )}
          </div>
        ) : row.state === "new_result" ? (
          <div className="mt-2 space-y-2">
            <p className="text-sm font-medium text-foreground">New result</p>
            {row.summaryMarkdown === null ? null : (
              <Markdown
                content={row.summaryMarkdown}
                className="break-words text-sm text-muted-foreground"
              />
            )}
          </div>
        ) : row.summaryMarkdown === null ? (
          <p className="mt-2 break-words text-sm text-muted-foreground">
            {row.detail}
          </p>
        ) : (
          <Markdown
            content={row.detail}
            className="mt-2 break-words text-sm text-muted-foreground"
          />
        )}
      </div>
      <div className="mt-2 flex justify-end">
        <button
          type="button"
          role="switch"
          aria-checked={row.userManaged}
          disabled={busy}
          onClick={onToggle}
          className="min-h-7 cursor-pointer rounded-full border border-border/60 px-2 text-[11px] text-muted-foreground hover:bg-surface-hover hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
        >
          User managed: {row.userManaged ? "On" : "Off"}
        </button>
      </div>
    </li>
  );
}

const SECTIONS = [
  { id: "needs_response", title: "Needs your response" },
  { id: "in_progress", title: "In progress" },
  { id: "done", title: "Done" },
] as const;

function QueuePanelContent({ threadId }: { threadId: string }) {
  const navigate = useBbNavigate();
  const { rpc, state, setState, refresh, supersedeRefresh } =
    useQueueSnapshot(threadId);
  const [mutation, setMutation] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);

  if (state.status === "loading") {
    return (
      <StateBox>
        <span role="status" aria-busy="true">
          Loading Firstmate queue…
        </span>
      </StateBox>
    );
  }
  if (state.status === "error") {
    return (
      <StateBox>
        <span role="alert">Could not load the queue: {state.message}</span>
      </StateBox>
    );
  }

  const { snapshot } = state;
  const setUserManaged = async (row: QueueRow) => {
    if (mutation !== null) return;
    setMutation(row.id);
    setMutationError(null);
    try {
      await rpc.call("setUserManaged", {
        surfaceThreadId: threadId,
        childThreadId: row.id,
        userManaged: !row.userManaged,
      });
      await refresh();
    } catch (cause) {
      setMutationError(boundedError(cause));
    } finally {
      setMutation(null);
    }
  };
  const archive = async (row: QueueRow) => {
    if (mutation !== null) return;
    supersedeRefresh();
    setMutation(row.id);
    setMutationError(null);
    setState({
      status: "ready",
      snapshot: {
        ...snapshot,
        rows: snapshot.rows.filter((candidate) => candidate.id !== row.id),
      },
    });
    try {
      await rpc.call("archiveThread", {
        surfaceThreadId: threadId,
        childThreadId: row.id,
      });
    } catch (cause) {
      setMutationError(boundedError(cause));
      await refresh();
    } finally {
      setMutation(null);
    }
  };

  return (
    <div className="space-y-5">
      {!snapshot.agentWritesEnabled ? (
        <div role="status" className="rounded-lg border border-border px-3 py-2 text-sm">
          Firstmate annotation writes are disabled. Queue reading and manual controls remain available.
        </div>
      ) : null}
      {mutationError === null ? null : (
        <p role="alert" className="break-words text-sm text-destructive">
          {mutationError}
        </p>
      )}
      {snapshot.rows.length === 0 ? (
        <StateBox>
          <span role="status">
            The queue is empty. Direct child threads appear here when Firstmate creates them.
          </span>
        </StateBox>
      ) : SECTIONS.map((section) => {
        const rows = snapshot.rows.filter((row) => row.section === section.id);
        const headingId = `firstmate-queue-${section.id}`;
        return (
          <section key={section.id} aria-labelledby={headingId}>
            <h2 id={headingId} className="text-sm font-semibold text-foreground">
              {section.title}
            </h2>
            {rows.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No threads.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {rows.map((row) => (
                  <QueueRowView
                    key={row.id}
                    row={row}
                    mutation={mutation}
                    onNavigate={() => navigate.toThread(row.id)}
                    onToggle={() => void setUserManaged(row)}
                    onArchive={() => void archive(row)}
                  />
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function QueuePanel({ threadId }: PluginThreadPanelProps) {
  const { values, isLoading } = useSettings();
  const managerThreadId =
    typeof values?.managerThreadId === "string"
      ? values.managerThreadId.trim()
      : "";
  if (isLoading || managerThreadId !== threadId) return null;
  return <QueuePanelContent threadId={threadId} />;
}

export default definePluginApp((app) => {
  app.slots.threadPanelAction({
    id: "firstmate-queue",
    title: "Firstmate queue",
    icon: "ListTodo",
    layout: "padded",
    component: QueuePanel,
    run: async ({ threadId, openPanel }) => {
      if (await actionMayOpen(threadId)) {
        openPanel({ title: "Firstmate queue" });
      }
    },
  });
});
