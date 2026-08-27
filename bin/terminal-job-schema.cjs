"use strict";

const ARTIFACT_SCHEMA_VERSION = 1;

const launchFields = Object.freeze([
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
]);

const outcomeFields = Object.freeze([
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
]);

module.exports = { ARTIFACT_SCHEMA_VERSION, launchFields, outcomeFields };
