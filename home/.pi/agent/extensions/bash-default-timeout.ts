/**
 * Gives Pi's `bash` tool a default timeout.
 *
 * The built-in `bash` tool has no timeout when the model does not give one, so a slow command can
 * stop a turn for many minutes. This extension sets `timeout` to `DEFAULT_TIMEOUT_SECONDS` when the
 * model omits it, and adds advice to the result when the timeout stops the command.
 */
import { type ExtensionAPI, isBashToolResult, isToolCallEventType } from "@earendil-works/pi-coding-agent";

const DEFAULT_TIMEOUT_SECONDS = 120;

const TIMEOUT_ADVICE =
	"Consider whether this command really needs to run this long. If it does, run it again as a BB terminal job (see the terminal-jobs skill: `bb terminal-job run`). If it does not, run a narrower or faster command instead.";

export default function (pi: ExtensionAPI) {
	pi.on("tool_call", (event) => {
		if (isToolCallEventType("bash", event) && event.input.timeout === undefined) {
			event.input.timeout = DEFAULT_TIMEOUT_SECONDS;
		}
	});

	pi.on("tool_result", (event) => {
		if (!isBashToolResult(event) || !event.isError) return;
		const timedOut = event.content.some(
			(part) => part.type === "text" && /Command timed out after \d+ seconds/.test(part.text),
		);
		if (!timedOut) return;
		return { content: [...event.content, { type: "text", text: TIMEOUT_ADVICE }] };
	});
}
