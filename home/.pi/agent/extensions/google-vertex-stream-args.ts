/**
 * Streams Gemini tool-call arguments on Google Vertex.
 *
 * Pi's built-in `google-vertex` stream does not set
 * `toolConfig.functionCallingConfig.streamFunctionCallArguments`, so Vertex sends no bytes while the
 * model writes tool arguments. A large `write` call can then exceed `httpIdleTimeoutMs`.
 * This extension replaces the stream for the `google-vertex` API with a port of pi-ai's
 * `dist/api/google-vertex.js` that requests streamed arguments and assembles `partialArgs`.
 * It loads pi-ai's internal helpers and `@google/genai` from the running Pi installation, so they
 * match Pi's version.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import {
	type Api,
	type AssistantMessage,
	type AssistantMessageEventStream,
	calculateCost,
	clampThinkingLevel,
	collapseSystemMessages,
	createAssistantMessageEventStream,
	getCurrentTools,
	getIdentityHeaders,
	getInitialSystemMessage,
	getSystemMessageText,
	type Model,
	type SimpleStreamOptions,
	type TextContent,
	type ThinkingContent,
	type ToolCall,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { type ExtensionAPI, getPackageDir } from "@earendil-works/pi-coding-agent";

type GoogleShared = typeof import("@earendil-works/pi-ai/api/google-shared");
type SimpleOptions = typeof import("@earendil-works/pi-ai/api/simple-options");
type ErrorBody = typeof import("@earendil-works/pi-ai/utils/error-body");
type Headers = typeof import("@earendil-works/pi-ai/utils/headers");
type ProviderEnv = typeof import("@earendil-works/pi-ai/utils/provider-env");
type SanitizeUnicode = typeof import("@earendil-works/pi-ai/utils/sanitize-unicode");
type GenAI = typeof import("@google/genai");

interface Internals {
	shared: GoogleShared;
	simple: SimpleOptions;
	errors: ErrorBody;
	headers: Headers;
	env: ProviderEnv;
	unicode: SanitizeUnicode;
	genai: GenAI;
}

interface VertexOptions {
	[key: string]: any;
	toolChoice?: "auto" | "none" | "any";
	thinking?: { enabled: boolean; budgetTokens?: number; level?: string };
	project?: string;
	location?: string;
}

const API_VERSION = "v1";
const GCP_VERTEX_CREDENTIALS_MARKER = "gcp-vertex-credentials";

let toolCallCounter = 0;

function findPackageDir(startDir: string, name: string): string {
	for (let dir = startDir; ; dir = dirname(dir)) {
		const candidate = join(dir, "node_modules", name);
		if (existsSync(join(candidate, "package.json"))) return candidate;
		if (dirname(dir) === dir) throw new Error(`Cannot find ${name} from ${startDir}`);
	}
}

async function loadInternals(): Promise<Internals> {
	const piAiDir = findPackageDir(getPackageDir(), "@earendil-works/pi-ai");
	const genaiDir = findPackageDir(piAiDir, "@google/genai");
	const genaiEntry = JSON.parse(readFileSync(join(genaiDir, "package.json"), "utf8")).exports["."].node.import;
	const load = (dir: string, file: string) => import(pathToFileURL(join(dir, file)).href);
	const [shared, simple, errors, headers, env, unicode, genai] = await Promise.all([
		load(piAiDir, "dist/api/google-shared.js"),
		load(piAiDir, "dist/api/simple-options.js"),
		load(piAiDir, "dist/utils/error-body.js"),
		load(piAiDir, "dist/utils/headers.js"),
		load(piAiDir, "dist/utils/provider-env.js"),
		load(piAiDir, "dist/utils/sanitize-unicode.js"),
		load(genaiDir, genaiEntry),
	]);
	return { shared, simple, errors, headers, env, unicode, genai };
}

type PathSegment = string | number;

interface ParsedPath {
	segments: PathSegment[];
	/** Set when the path ends in `[]` or `{}`, which Vertex sends to declare a container. */
	container?: "array" | "object";
}

/** Parses the RFC 9535 subset that Vertex sends in `PartialArg.jsonPath`, such as `$.edits[0].oldText`. */
function parseJsonPath(path: string): ParsedPath {
	if (!path.startsWith("$")) throw new Error(`Unsupported jsonPath: ${path}`);
	const segments: PathSegment[] = [];
	let i = 1;
	while (i < path.length) {
		const rest = path.slice(i);
		if (rest === "[]") return { segments, container: "array" };
		if (rest === "{}") return { segments, container: "object" };
		if (path[i] === ".") {
			const match = /^\.([^.[{]+)/.exec(rest);
			if (!match) throw new Error(`Unsupported jsonPath: ${path}`);
			segments.push(match[1]);
			i += match[0].length;
			continue;
		}
		const index = /^\[(\d+)\]/.exec(rest);
		if (index) {
			segments.push(Number(index[1]));
			i += index[0].length;
			continue;
		}
		const quoted = /^\[(?:'((?:[^'\\]|\\.)*)'|"((?:[^"\\]|\\.)*)")\]/.exec(rest);
		if (!quoted) throw new Error(`Unsupported jsonPath: ${path}`);
		segments.push((quoted[1] ?? quoted[2]).replace(/\\(.)/g, "$1"));
		i += quoted[0].length;
	}
	return { segments };
}

type PartialArg = {
	jsonPath?: string;
	stringValue?: string;
	numberValue?: number;
	boolValue?: boolean;
	nullValue?: unknown;
};

interface OpenContainer {
	segment: PathSegment | null;
	kind: "array" | "object";
	members: number;
}

/**
 * Builds a tool call's arguments from Vertex `partialArgs`, and the JSON text that the
 * arguments add, so that the concatenated toolcall_delta text is the arguments' JSON.
 * Vertex sends each container's members together, so the writer closes a container when a
 * path leaves it.
 */
class PartialArgsAssembler {
	readonly args: Record<string, any> = {};
	private stack: OpenContainer[] = [{ segment: null, kind: "object", members: 0 }];
	private openStringPath: string | undefined;
	private started = false;

	apply(partialArgs: PartialArg[]): string {
		let json = "";
		if (!this.started) {
			this.started = true;
			json += "{";
		}
		for (const arg of partialArgs) {
			const { segments, container } = parseJsonPath(arg.jsonPath ?? "$");
			if (container) {
				this.ensureContainer(segments, container);
				json += this.openContainers(segments, container);
				continue;
			}
			if (segments.length === 0) throw new Error(`partialArg without a key: ${arg.jsonPath}`);
			if (arg.stringValue !== undefined) {
				const pathKey = JSON.stringify(segments);
				const existing = this.get(segments);
				this.set(segments, (typeof existing === "string" ? existing : "") + arg.stringValue);
				const escaped = JSON.stringify(arg.stringValue).slice(1, -1);
				if (this.openStringPath === pathKey) {
					json += escaped;
					continue;
				}
				json += `${this.openContainers(segments.slice(0, -1))}${this.member(segments.at(-1)!)}"${escaped}`;
				this.openStringPath = pathKey;
				continue;
			}
			const value =
				arg.numberValue !== undefined ? arg.numberValue : arg.boolValue !== undefined ? arg.boolValue : null;
			this.set(segments, value);
			json += `${this.openContainers(segments.slice(0, -1))}${this.member(segments.at(-1)!)}${JSON.stringify(value)}`;
		}
		return json;
	}

	finish(): string {
		let json = this.started ? "" : "{";
		this.started = true;
		json += this.closeString();
		while (this.stack.length > 0) json += this.stack.pop()!.kind === "object" ? "}" : "]";
		return json;
	}

	private closeString(): string {
		if (this.openStringPath === undefined) return "";
		this.openStringPath = undefined;
		return '"';
	}

	/** Closes containers outside `target` and opens the containers of `target` that are not open. */
	private openContainers(target: PathSegment[], lastKind?: "array" | "object"): string {
		let json = this.closeString();
		let common = 0;
		while (common < this.stack.length - 1 && common < target.length && this.stack[common + 1].segment === target[common]) {
			common++;
		}
		while (this.stack.length - 1 > common) json += this.stack.pop()!.kind === "object" ? "}" : "]";
		for (let i = common; i < target.length; i++) {
			const next = target[i + 1];
			const kind = next === undefined ? (lastKind ?? "object") : typeof next === "number" ? "array" : "object";
			json += `${this.member(target[i])}${kind === "object" ? "{" : "["}`;
			this.stack.push({ segment: target[i], kind, members: 0 });
		}
		return json;
	}

	private member(segment: PathSegment): string {
		const parent = this.stack.at(-1)!;
		const separator = parent.members++ > 0 ? "," : "";
		return parent.kind === "object" ? `${separator}${JSON.stringify(String(segment))}:` : separator;
	}

	private get(segments: PathSegment[]): unknown {
		let node: any = this.args;
		for (const segment of segments) {
			if (node === null || typeof node !== "object") return undefined;
			node = node[segment];
		}
		return node;
	}

	private set(segments: PathSegment[], value: unknown): void {
		let node: any = this.args;
		for (let i = 0; i < segments.length - 1; i++) {
			const segment = segments[i];
			if (node[segment] === null || typeof node[segment] !== "object") {
				node[segment] = typeof segments[i + 1] === "number" ? [] : {};
			}
			node = node[segment];
		}
		node[segments.at(-1)!] = value;
	}

	private ensureContainer(segments: PathSegment[], kind: "array" | "object"): void {
		if (segments.length === 0) return;
		const existing = this.get(segments);
		if (existing === null || typeof existing !== "object") this.set(segments, kind === "array" ? [] : {});
	}
}

function createStream(internals: Internals) {
	const { shared, errors, headers, env, unicode, genai } = internals;

	const stream = (model: Model<Api>, context: TranscriptContext, options?: VertexOptions): AssistantMessageEventStream => {
		const stream = createAssistantMessageEventStream();
		const normalizedContext = collapseSystemMessages(context);
		(async () => {
			const output: AssistantMessage = {
				role: "assistant",
				content: [],
				api: "google-vertex",
				provider: model.provider,
				model: model.id,
				usage: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					totalTokens: 0,
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
				},
				stopReason: "pending",
				timestamp: Date.now(),
			};
			try {
				if (options?.fetch && options.fetch !== globalThis.fetch) {
					throw new Error("Custom fetch is not supported by the Google Vertex adapter");
				}
				const apiKey = resolveApiKey(options);
				const client = apiKey
					? createClientWithApiKey(model, apiKey, options?.headers, options?.identity)
					: createClient(
							model,
							resolveProject(options),
							resolveLocation(options),
							options?.headers,
							options?.env,
							options?.identity,
						);
				let params: any = buildParams(model, normalizedContext, options);
				const nextParams = await options?.onPayload?.(params, model);
				if (nextParams !== undefined) {
					params = nextParams;
				}
				const googleStream = await shared.retryGoogleRequest(
					() => client.models.generateContentStream(params),
					options as any,
				);
				stream.push({ type: "start", partial: output });
				let currentBlock: TextContent | ThinkingContent | null = null;
				let streamingToolCall: { block: ToolCall; assembler: PartialArgsAssembler } | null = null;
				const blocks = output.content;
				const blockIndex = () => blocks.length - 1;
				const endCurrentBlock = () => {
					if (!currentBlock) return;
					if (currentBlock.type === "text") {
						stream.push({ type: "text_end", contentIndex: blockIndex(), content: currentBlock.text, partial: output });
					} else {
						stream.push({
							type: "thinking_end",
							contentIndex: blockIndex(),
							content: currentBlock.thinking,
							partial: output,
						});
					}
					currentBlock = null;
				};
				const endStreamingToolCall = () => {
					if (!streamingToolCall) return;
					const { block, assembler } = streamingToolCall;
					streamingToolCall = null;
					const delta = assembler.finish();
					stream.push({ type: "toolcall_delta", contentIndex: blockIndex(), delta, partial: output });
					stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall: block, partial: output });
				};
				for await (const chunk of googleStream) {
					await options?.onProviderStreamEvent?.(chunk, model);
					output.responseId ||= chunk.responseId;
					const candidate = chunk.candidates?.[0];
					if (candidate?.content?.parts) {
						for (const part of candidate.content.parts) {
							if (part.text !== undefined) {
								endStreamingToolCall();
								const isThinking = shared.isThinkingPart(part);
								if (
									!currentBlock ||
									(isThinking && currentBlock.type !== "thinking") ||
									(!isThinking && currentBlock.type !== "text")
								) {
									endCurrentBlock();
									if (isThinking) {
										currentBlock = { type: "thinking", thinking: "", thinkingSignature: undefined };
										output.content.push(currentBlock);
										stream.push({ type: "thinking_start", contentIndex: blockIndex(), partial: output });
									} else {
										currentBlock = { type: "text", text: "" };
										output.content.push(currentBlock);
										stream.push({ type: "text_start", contentIndex: blockIndex(), partial: output });
									}
								}
								const block = currentBlock as TextContent | ThinkingContent;
								if (block.type === "thinking") {
									block.thinking += part.text;
									block.thinkingSignature = shared.retainThoughtSignature(
										block.thinkingSignature,
										part.thoughtSignature,
									);
									stream.push({
										type: "thinking_delta",
										contentIndex: blockIndex(),
										delta: part.text,
										partial: output,
									});
								} else {
									block.text += part.text;
									block.textSignature = shared.retainThoughtSignature(block.textSignature, part.thoughtSignature);
									stream.push({ type: "text_delta", contentIndex: blockIndex(), delta: part.text, partial: output });
								}
							}
							const functionCall = part.functionCall;
							if (!functionCall) continue;
							endCurrentBlock();
							// Parts after the first part of a streamed call carry no name.
							if (streamingToolCall && functionCall.name === undefined) {
								const active: { block: ToolCall; assembler: PartialArgsAssembler } = streamingToolCall;
								active.block.thoughtSignature = shared.retainThoughtSignature(
									active.block.thoughtSignature,
									part.thoughtSignature,
								);
								const delta = active.assembler.apply(functionCall.partialArgs ?? []);
								if (delta) {
									stream.push({ type: "toolcall_delta", contentIndex: blockIndex(), delta, partial: output });
								}
								if (!functionCall.willContinue) endStreamingToolCall();
								continue;
							}
							endStreamingToolCall();
							const providedId = functionCall.id;
							const needsNewId =
								!providedId || output.content.some((b) => b.type === "toolCall" && b.id === providedId);
							const toolCallId = needsNewId ? `${functionCall.name}_${Date.now()}_${++toolCallCounter}` : providedId;
							if (functionCall.willContinue || functionCall.partialArgs) {
								const assembler = new PartialArgsAssembler();
								const toolCall: ToolCall = {
									type: "toolCall",
									id: toolCallId,
									name: functionCall.name || "",
									arguments: assembler.args,
									...(part.thoughtSignature && { thoughtSignature: part.thoughtSignature }),
								};
								output.content.push(toolCall);
								stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
								streamingToolCall = { block: toolCall, assembler };
								const delta = assembler.apply(functionCall.partialArgs ?? []);
								stream.push({ type: "toolcall_delta", contentIndex: blockIndex(), delta, partial: output });
								if (!functionCall.willContinue) endStreamingToolCall();
								continue;
							}
							const toolCall: ToolCall = {
								type: "toolCall",
								id: toolCallId,
								name: functionCall.name || "",
								arguments: (functionCall.args ?? {}) as ToolCall["arguments"],
								...(part.thoughtSignature && { thoughtSignature: part.thoughtSignature }),
							};
							output.content.push(toolCall);
							stream.push({ type: "toolcall_start", contentIndex: blockIndex(), partial: output });
							stream.push({
								type: "toolcall_delta",
								contentIndex: blockIndex(),
								delta: JSON.stringify(toolCall.arguments),
								partial: output,
							});
							stream.push({ type: "toolcall_end", contentIndex: blockIndex(), toolCall, partial: output });
						}
					}
					if (candidate?.finishReason) {
						output.rawStopReason = candidate.finishReason;
						output.stopReason = shared.mapStopReason(candidate.finishReason);
						if (output.content.some((b) => b.type === "toolCall") && output.stopReason === "stop") {
							output.stopReason = "toolUse";
						}
					}
					if (chunk.usageMetadata) {
						output.usage = {
							input: (chunk.usageMetadata.promptTokenCount || 0) - (chunk.usageMetadata.cachedContentTokenCount || 0),
							output: (chunk.usageMetadata.candidatesTokenCount || 0) + (chunk.usageMetadata.thoughtsTokenCount || 0),
							cacheRead: chunk.usageMetadata.cachedContentTokenCount || 0,
							cacheWrite: 0,
							reasoning: chunk.usageMetadata.thoughtsTokenCount || 0,
							totalTokens: chunk.usageMetadata.totalTokenCount || 0,
							cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
						};
						calculateCost(model, output.usage);
					}
				}
				endStreamingToolCall();
				endCurrentBlock();
				if (options?.signal?.aborted) {
					throw new Error("Request was aborted");
				}
				if (output.stopReason === "pending") {
					throw new Error("Google Vertex stream ended without a finish reason");
				}
				if (output.stopReason === "aborted" || output.stopReason === "error") {
					const errorMessage = output.rawStopReason
						? `Provider stopped with: ${output.rawStopReason}`
						: "An unknown error occurred";
					throw new Error(errorMessage);
				}
				stream.push({ type: "done", reason: output.stopReason, message: output });
				stream.end();
			} catch (error) {
				output.stopReason = options?.signal?.aborted ? "aborted" : "error";
				output.errorMessage = errors.formatProviderError(errors.normalizeProviderError(error));
				stream.push({ type: "error", reason: output.stopReason, error: output });
				stream.end();
			}
		})();
		return stream;
	};

	const streamSimple = (
		model: Model<Api>,
		context: TranscriptContext,
		options?: SimpleStreamOptions,
	): AssistantMessageEventStream => {
		const base = {
			...internals.simple.buildBaseOptions(model, context, options, undefined),
			toolChoice: options?.toolChoice as VertexOptions["toolChoice"],
		};
		if (!options?.reasoning) {
			return stream(model, context, { ...base, thinking: { enabled: false } });
		}
		const clampedReasoning = clampThinkingLevel(model, options.reasoning);
		if (clampedReasoning === "off") {
			return stream(model, context, { ...base, thinking: { enabled: false } });
		}
		const resolvedLevel = shared.resolveGoogleThinkingLevel(model as any, clampedReasoning);
		if (shared.usesGoogleThinkingLevel(model as any)) {
			return stream(model, context, {
				...base,
				thinking: { enabled: true, level: shared.toGoogleThinkingLevel(resolvedLevel) },
			});
		}
		return stream(model, context, {
			...base,
			thinking: {
				enabled: true,
				budgetTokens: getGoogleBudget(model, resolvedLevel, options.thinkingBudgets as Record<string, number>),
			},
		});
	};

	function createClient(
		model: Model<Api>,
		project: string,
		location: string,
		optionsHeaders: unknown,
		providerEnv: unknown,
		identity: unknown,
	) {
		const keyFilename = env.getProviderEnvValue("GOOGLE_APPLICATION_CREDENTIALS", providerEnv as any);
		return new genai.GoogleGenAI({
			vertexai: true,
			project,
			location,
			apiVersion: API_VERSION,
			...(keyFilename ? { googleAuthOptions: { keyFilename } } : {}),
			httpOptions: buildHttpOptions(model, optionsHeaders, identity),
		});
	}

	function createClientWithApiKey(model: Model<Api>, apiKey: string, optionsHeaders: unknown, identity: unknown) {
		return new genai.GoogleGenAI({
			vertexai: true,
			apiKey,
			apiVersion: API_VERSION,
			httpOptions: buildHttpOptions(model, optionsHeaders, identity),
		});
	}

	function buildHttpOptions(model: Model<Api>, optionsHeaders: unknown, identity: unknown) {
		const httpOptions: Record<string, unknown> = {};
		const baseUrl = resolveCustomBaseUrl(model.baseUrl);
		if (baseUrl) {
			httpOptions.baseUrl = baseUrl;
			httpOptions.baseUrlResourceScope = genai.ResourceScope.COLLECTION;
			if (baseUrlIncludesApiVersion(baseUrl)) {
				httpOptions.apiVersion = "";
			}
		}
		const requestHeaders = headers.providerHeadersToRecord(
			getIdentityHeaders(model, identity as any),
			model.headers,
			optionsHeaders as any,
		);
		if (requestHeaders) {
			httpOptions.headers = requestHeaders;
		}
		return Object.keys(httpOptions).length > 0 ? httpOptions : undefined;
	}

	function resolveProject(options?: VertexOptions): string {
		const project =
			options?.project ||
			env.getProviderEnvValue("GOOGLE_CLOUD_PROJECT", options?.env) ||
			env.getProviderEnvValue("GCLOUD_PROJECT", options?.env);
		if (!project) {
			throw new Error(
				"Vertex AI requires a project ID. Set GOOGLE_CLOUD_PROJECT/GCLOUD_PROJECT or pass project in options.",
			);
		}
		return project;
	}

	function resolveLocation(options?: VertexOptions): string {
		const location = options?.location || env.getProviderEnvValue("GOOGLE_CLOUD_LOCATION", options?.env);
		if (!location) {
			throw new Error("Vertex AI requires a location. Set GOOGLE_CLOUD_LOCATION or pass location in options.");
		}
		return location;
	}

	function buildParams(model: Model<Api>, context: TranscriptContext, options: VertexOptions = {}) {
		const contents = shared.convertMessages(model as any, context);
		const initialSystemMessage = getInitialSystemMessage(context.messages);
		const currentTools = getCurrentTools(context.messages);
		const generationConfig: Record<string, unknown> = {};
		if (options.temperature !== undefined) {
			generationConfig.temperature = options.temperature;
		}
		if (options.maxTokens !== undefined) {
			generationConfig.maxOutputTokens = options.maxTokens;
		}
		const supportsStrictMode = shared.supportsGoogleStrictToolSampling(model.id);
		const functionCallingMode =
			currentTools.length > 0
				? shared.resolveGoogleFunctionCallingMode(currentTools, options.toolChoice, supportsStrictMode)
				: undefined;
		const systemInstruction = initialSystemMessage ? getSystemMessageText(initialSystemMessage) : "";
		const config: Record<string, any> = {
			...(Object.keys(generationConfig).length > 0 && generationConfig),
			...(systemInstruction && { systemInstruction: unicode.sanitizeSurrogates(systemInstruction) }),
			...(currentTools.length > 0 && {
				tools: shared.convertTools(currentTools, false, supportsStrictMode),
				toolConfig: {
					functionCallingConfig: {
						...(functionCallingMode !== undefined && { mode: functionCallingMode }),
						streamFunctionCallArguments: true,
					},
				},
			}),
		};
		if (options.thinking?.enabled && model.reasoning) {
			const thinkingConfig: Record<string, unknown> = { includeThoughts: true };
			if (options.thinking.level !== undefined) {
				thinkingConfig.thinkingLevel = shared.toGoogleSdkThinkingLevel(options.thinking.level as any);
			} else if (options.thinking.budgetTokens !== undefined) {
				thinkingConfig.thinkingBudget = options.thinking.budgetTokens;
			}
			config.thinkingConfig = thinkingConfig;
		} else if (model.reasoning && options.thinking && !options.thinking.enabled) {
			config.thinkingConfig = shared.getDisabledGoogleThinkingConfig(model as any);
		}
		if (options.signal) {
			if (options.signal.aborted) {
				throw new Error("Request aborted");
			}
			config.abortSignal = options.signal;
		}
		return { model: model.id, contents, config };
	}

	return streamSimple;
}

function resolveCustomBaseUrl(baseUrl: string): string | undefined {
	const trimmed = baseUrl.trim();
	if (!trimmed || trimmed.includes("{location}")) {
		return undefined;
	}
	return trimmed;
}

function baseUrlIncludesApiVersion(baseUrl: string): boolean {
	try {
		const url = new URL(baseUrl);
		return url.pathname.split("/").some((part) => /^v\d+(?:beta\d*)?$/.test(part));
	} catch {
		return /(?:^|\/)v\d+(?:beta\d*)?(?:\/|$)/.test(baseUrl);
	}
}

function resolveApiKey(options?: VertexOptions): string | undefined {
	const apiKey = options?.apiKey?.trim();
	if (!apiKey || apiKey === GCP_VERTEX_CREDENTIALS_MARKER || /^<[^>]+>$/.test(apiKey)) {
		return undefined;
	}
	return apiKey;
}

function getGoogleBudget(model: Model<Api>, level: string, customBudgets?: Record<string, number>): number {
	if (customBudgets?.[level] !== undefined) {
		return customBudgets[level];
	}
	if (model.id.includes("2.5-pro")) {
		return ({ minimal: 128, low: 2048, medium: 8192, high: 32768 } as Record<string, number>)[level];
	}
	if (model.id.includes("2.5-flash")) {
		return ({ minimal: 128, low: 2048, medium: 8192, high: 24576 } as Record<string, number>)[level];
	}
	return -1;
}

export default async function (pi: ExtensionAPI) {
	const streamSimple = createStream(await loadInternals());
	pi.registerProvider("google-vertex", { api: "google-vertex", streamSimple });
}
