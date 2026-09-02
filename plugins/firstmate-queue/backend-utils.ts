export const STALE_MANAGER_MESSAGE =
  "The configured Firstmate manager is archived, deleted, or missing.";

export function isMissingThreadError(cause: unknown): boolean {
  if (typeof cause !== "object" || cause === null || !("status" in cause)) {
    return false;
  }
  const status = (cause as { status?: unknown }).status;
  return status === 404 || status === 410;
}

export function boundedErrorText(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : String(cause);
  return message.length <= 240 ? message : `${message.slice(0, 239)}…`;
}
