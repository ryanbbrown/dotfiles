export const ARTIFACT_SCHEMA_VERSION = 1;
export const LAUNCH_ARTIFACT_FIELDS = [
  "schemaVersion",
  "jobId",
  "terminalId",
  "ownerThreadId",
  "argv",
  "startedAt",
  "artifactRoot",
  "jobDirectory",
  "launchPath",
  "logPath",
  "outcomePath",
] as const;
export const OUTCOME_ARTIFACT_FIELDS = [
  "schemaVersion",
  "jobId",
  "terminalId",
  "ownerThreadId",
  "commandExitCode",
  "signal",
  "status",
  "result",
  "startedAt",
  "finishedAt",
  "durationMs",
  "logPath",
] as const;

export interface LaunchArtifact {
  schemaVersion: 1;
  jobId: string;
  terminalId: string | null;
  ownerThreadId: string;
  argv: string[];
  startedAt: string;
  artifactRoot: string;
  jobDirectory: string;
  launchPath: string;
  logPath: string;
  outcomePath: string;
}

export type OutcomeResult =
  | "success"
  | "failure"
  | "signaled"
  | "launch-failed";

export interface OutcomeArtifact {
  schemaVersion: 1;
  jobId: string;
  terminalId: string | null;
  ownerThreadId: string;
  commandExitCode: number | null;
  signal: string | null;
  status: number;
  result: OutcomeResult;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  logPath: string;
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
    throw new Error(`${label} has unexpected fields`);
  }
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  return value;
}

function nullableText(value: unknown, field: string): string | null {
  if (value !== null && typeof value !== "string") {
    throw new Error(`${field} must be a string or null`);
  }
  return value;
}

function integer(value: unknown, field: string, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (!Number.isInteger(value)) throw new Error(`${field} must be an integer`);
  return value as number;
}

function iso(value: unknown, field: string): string {
  const result = text(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(result)) {
    throw new Error(`${field} must be an ISO-8601 UTC timestamp`);
  }
  return result;
}

export function decodeLaunchArtifact(content: string): LaunchArtifact {
  const value = record(JSON.parse(content), "launch artifact");
  exactKeys(value, LAUNCH_ARTIFACT_FIELDS, "launch artifact");
  if (value.schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    throw new Error("unsupported launch schema version");
  }
  if (!Array.isArray(value.argv) || value.argv.some((item) => typeof item !== "string")) {
    throw new Error("argv must be an array of strings");
  }
  return {
    schemaVersion: 1,
    jobId: text(value.jobId, "jobId"),
    terminalId: nullableText(value.terminalId, "terminalId"),
    ownerThreadId: text(value.ownerThreadId, "ownerThreadId"),
    argv: value.argv as string[],
    startedAt: iso(value.startedAt, "startedAt"),
    artifactRoot: text(value.artifactRoot, "artifactRoot"),
    jobDirectory: text(value.jobDirectory, "jobDirectory"),
    launchPath: text(value.launchPath, "launchPath"),
    logPath: text(value.logPath, "logPath"),
    outcomePath: text(value.outcomePath, "outcomePath"),
  };
}

export function decodeOutcomeArtifact(content: string): OutcomeArtifact {
  const value = record(JSON.parse(content), "outcome artifact");
  exactKeys(value, OUTCOME_ARTIFACT_FIELDS, "outcome artifact");
  if (value.schemaVersion !== ARTIFACT_SCHEMA_VERSION) {
    throw new Error("unsupported outcome schema version");
  }
  if (!["success", "failure", "signaled", "launch-failed"].includes(String(value.result))) {
    throw new Error("invalid outcome result");
  }
  const durationMs = integer(value.durationMs, "durationMs");
  if (durationMs === null || durationMs < 0) throw new Error("durationMs must be non-negative");
  return {
    schemaVersion: 1,
    jobId: text(value.jobId, "jobId"),
    terminalId: nullableText(value.terminalId, "terminalId"),
    ownerThreadId: text(value.ownerThreadId, "ownerThreadId"),
    commandExitCode: integer(value.commandExitCode, "commandExitCode", true),
    signal: nullableText(value.signal, "signal"),
    status: integer(value.status, "status") as number,
    result: value.result as OutcomeResult,
    startedAt: iso(value.startedAt, "startedAt"),
    finishedAt: iso(value.finishedAt, "finishedAt"),
    durationMs,
    logPath: text(value.logPath, "logPath"),
  };
}
