import type Database from "better-sqlite3";
import type { IdleDisposition } from "./contract.js";
import type { Annotation } from "./projection.js";

interface AnnotationRow {
  thread_id: string;
  summary_markdown: string | null;
  idle_disposition: IdleDisposition | null;
  reviewed_through_seq: number;
  user_managed: number;
  summary_updated_at: number | null;
  disposition_updated_at: number | null;
  mode_updated_at: number | null;
}

export const INITIAL_SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS queue_annotations (
    thread_id TEXT PRIMARY KEY,
    summary_markdown TEXT,
    idle_disposition TEXT CHECK (idle_disposition IN ('needs_response', 'done')),
    reviewed_through_seq INTEGER NOT NULL DEFAULT 0 CHECK (reviewed_through_seq >= 0),
    user_managed INTEGER NOT NULL DEFAULT 0 CHECK (user_managed IN (0, 1)),
    summary_updated_at INTEGER,
    disposition_updated_at INTEGER,
    mode_updated_at INTEGER
  )`,
];

function fromRow(row: AnnotationRow): Annotation {
  return {
    threadId: row.thread_id,
    summaryMarkdown: row.summary_markdown,
    idleDisposition: row.idle_disposition,
    reviewedThroughSeq: row.reviewed_through_seq,
    userManaged: row.user_managed === 1,
    summaryUpdatedAt: row.summary_updated_at,
    dispositionUpdatedAt: row.disposition_updated_at,
    modeUpdatedAt: row.mode_updated_at,
  };
}

export class AnnotationStore {
  constructor(private readonly db: Database.Database) {}

  get(threadId: string): Annotation | null {
    const row = this.db
      .prepare("SELECT * FROM queue_annotations WHERE thread_id = ?")
      .get(threadId) as AnnotationRow | undefined;
    return row === undefined ? null : fromRow(row);
  }

  list(threadIds: readonly string[]): Map<string, Annotation> {
    const result = new Map<string, Annotation>();
    const get = this.db.prepare(
      "SELECT * FROM queue_annotations WHERE thread_id = ?",
    );
    for (const threadId of threadIds) {
      const row = get.get(threadId) as AnnotationRow | undefined;
      if (row !== undefined) result.set(threadId, fromRow(row));
    }
    return result;
  }

  setUserManaged(
    threadId: string,
    userManaged: boolean,
    now = Date.now(),
  ): Annotation {
    this.immediate(() => {
      this.db
        .prepare(
          `INSERT INTO queue_annotations (
            thread_id, idle_disposition, reviewed_through_seq, user_managed,
            disposition_updated_at, mode_updated_at
          ) VALUES (?, 'needs_response', 0, ?, ?, ?)
          ON CONFLICT(thread_id) DO UPDATE SET
            idle_disposition = 'needs_response',
            user_managed = excluded.user_managed,
            disposition_updated_at = excluded.disposition_updated_at,
            mode_updated_at = excluded.mode_updated_at`,
        )
        .run(threadId, userManaged ? 1 : 0, now, now);
    });
    return this.get(threadId)!;
  }

  writeReview(
    threadId: string,
    summaryMarkdown: string,
    disposition: IdleDisposition,
    reviewedThroughSeq: number,
    now = Date.now(),
  ): { outcome: "written"; annotation: Annotation } | { outcome: "user_managed" } {
    const result: { outcome: "written" | "user_managed" } = {
      outcome: "written",
    };
    this.immediate(() => {
      if (this.get(threadId)?.userManaged === true) {
        result.outcome = "user_managed";
        return;
      }
      this.db
        .prepare(
          `INSERT INTO queue_annotations (
            thread_id, summary_markdown, idle_disposition,
            reviewed_through_seq, user_managed,
            summary_updated_at, disposition_updated_at
          ) VALUES (?, ?, ?, ?, 0, ?, ?)
          ON CONFLICT(thread_id) DO UPDATE SET
            summary_markdown = excluded.summary_markdown,
            idle_disposition = excluded.idle_disposition,
            reviewed_through_seq = excluded.reviewed_through_seq,
            summary_updated_at = excluded.summary_updated_at,
            disposition_updated_at = excluded.disposition_updated_at`,
        )
        .run(
          threadId,
          summaryMarkdown,
          disposition,
          reviewedThroughSeq,
          now,
          now,
        );
    });
    return result.outcome === "user_managed"
      ? { outcome: result.outcome }
      : { outcome: result.outcome, annotation: this.get(threadId)! };
  }

  restoreReviewIfUnchanged(
    threadId: string,
    written: Annotation,
    previous: Annotation | null,
  ): boolean {
    let restored = false;
    this.immediate(() => {
      const prior = previous ?? {
        summaryMarkdown: null,
        idleDisposition: null,
        reviewedThroughSeq: 0,
        summaryUpdatedAt: null,
        dispositionUpdatedAt: null,
      };
      const summary = this.db
        .prepare(
          `UPDATE queue_annotations SET
             summary_markdown = ?,
             reviewed_through_seq = ?,
             summary_updated_at = ?
           WHERE thread_id = ?
             AND summary_markdown IS ?
             AND reviewed_through_seq = ?
             AND summary_updated_at IS ?`,
        )
        .run(
          prior.summaryMarkdown,
          prior.reviewedThroughSeq,
          prior.summaryUpdatedAt,
          threadId,
          written.summaryMarkdown,
          written.reviewedThroughSeq,
          written.summaryUpdatedAt,
        );
      const disposition = this.db
        .prepare(
          `UPDATE queue_annotations SET
             idle_disposition = ?,
             disposition_updated_at = ?
           WHERE thread_id = ?
             AND idle_disposition IS ?
             AND disposition_updated_at IS ?
             AND mode_updated_at IS ?`,
        )
        .run(
          prior.idleDisposition,
          prior.dispositionUpdatedAt,
          threadId,
          written.idleDisposition,
          written.dispositionUpdatedAt,
          written.modeUpdatedAt,
        );
      this.db
        .prepare(
          `DELETE FROM queue_annotations
           WHERE thread_id = ?
             AND summary_markdown IS NULL
             AND idle_disposition IS NULL
             AND reviewed_through_seq = 0
             AND user_managed = 0
             AND summary_updated_at IS NULL
             AND disposition_updated_at IS NULL
             AND mode_updated_at IS NULL`,
        )
        .run(threadId);
      restored = summary.changes === 1 || disposition.changes === 1;
    });
    return restored;
  }

  private immediate(work: () => void): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      work();
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}
