import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import type { ExtensionAPI, Theme } from "@earendil-works/pi-coding-agent";
import { Box, Text, type Component } from "@earendil-works/pi-tui";

const CONFIG_FILE_NAME = "thinking-notes.json";
const ENTRY_TYPE = "thinking-notes";
const DEFAULT_CONFIG: ThinkingNotesConfig = { enabled: true };

type RawThinkingNotesConfig = {
	enabled?: boolean;
};

export type ThinkingNotesConfig = {
	enabled: boolean;
};

export type ThinkingBlock = {
	index: number;
	text: string;
};

export type ThinkingStats = {
	paragraphs: number;
	characters: number;
	lines: number;
};

export type ThinkingNotesEntry = ThinkingStats & {
	key: string;
	index: number;
	ordinal: number;
	text: string;
	complete: boolean;
};

type ConfigPath = {
	scope: "global" | "project";
	path: string;
	exists: boolean;
};

type ConfigState = {
	config: ThinkingNotesConfig;
	paths: ConfigPath[];
	errors: string[];
};

type ThinkingStreamEvent = Extract<
	AssistantMessageEvent,
	{ type: "thinking_start" | "thinking_delta" | "thinking_end" }
>;

/** 从 assistant content 中取出真实的 thinking block；index 是 Pi 的 contentIndex。 */
export function splitThinkingBlocks(content: ReadonlyArray<AssistantMessage["content"][number]>): ThinkingBlock[] {
	return content.flatMap((block, index) => (block.type === "thinking" ? [{ index, text: block.thinking }] : []));
}

/** 统计原文字符（按 Unicode code point）、非空段落和换行行数。 */
export function getThinkingStats(text: string): ThinkingStats {
	const trimmed = text.trim();
	return {
		paragraphs: trimmed.length === 0 ? 0 : trimmed.split(/\n\s*\n/).length,
		characters: Array.from(text).length,
		lines: text.length === 0 ? 0 : text.split(/\r?\n/).length,
	};
}

/** 项目层只覆盖已知字段；未知或非布尔 enabled 不会污染已解析配置。 */
export function mergeConfig(base: ThinkingNotesConfig, override: unknown): ThinkingNotesConfig {
	if (typeof override !== "object" || override === null || Array.isArray(override)) return { ...base };
	if (!("enabled" in override)) return { ...base };
	const enabled = override.enabled;
	return typeof enabled === "boolean" ? { enabled } : { ...base };
}

function parseConfig(raw: unknown): RawThinkingNotesConfig {
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new Error("配置根节点必须是对象");
	}
	if (!("enabled" in raw)) return {};
	const enabled = raw.enabled;
	if (typeof enabled !== "boolean") throw new Error("enabled 必须是布尔值");
	return { enabled };
}

export function getConfigPaths(cwd: string, homeDir = homedir()): ConfigPath[] {
	const globalPath = join(homeDir, ".pi", "agent", CONFIG_FILE_NAME);
	const projectPath = join(cwd, ".pi", CONFIG_FILE_NAME);
	return [
		{ scope: "global", path: globalPath, exists: existsSync(globalPath) },
		{ scope: "project", path: projectPath, exists: existsSync(projectPath) },
	];
}

function loadConfig(cwd: string): ConfigState {
	const paths = getConfigPaths(cwd);
	let config = { ...DEFAULT_CONFIG };
	const errors: string[] = [];

	for (const pathInfo of paths) {
		if (!pathInfo.exists) continue;
		try {
			const parsed: unknown = JSON.parse(readFileSync(pathInfo.path, "utf8"));
			config = mergeConfig(config, parseConfig(parsed));
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errors.push(`${pathInfo.scope} ${pathInfo.path}: ${message}`);
		}
	}

	return {
		config: errors.length > 0 ? { ...config, enabled: false } : config,
		paths,
		errors,
	};
}

function formatConfigStatus(state: ConfigState, effectiveEnabled: boolean, hasSessionOverride: boolean): string {
	const sources = state.paths.map((entry) => `${entry.scope}=${entry.exists ? "found" : "missing"}`).join(", ");
	const override = hasSessionOverride ? "，当前会话覆盖配置文件" : "";
	const errors = state.errors.length > 0 ? `；配置错误：${state.errors.join(" | ")}` : "";
	return `thinking-notes: ${effectiveEnabled ? "on" : "off"}${override}；${sources}${errors}`;
}

function isThinkingStreamEvent(event: AssistantMessageEvent): event is ThinkingStreamEvent {
	return event.type === "thinking_start" || event.type === "thinking_delta" || event.type === "thinking_end";
}

function readThinkingText(event: ThinkingStreamEvent): string | undefined {
	if (event.type === "thinking_end") return event.content;
	const block = event.partial.content[event.contentIndex];
	return block?.type === "thinking" ? block.thinking : undefined;
}

class ThinkingNotesComponent implements Component {
	private readonly text = new Text();
	private readonly box: Box;
	private readonly initial: ThinkingNotesEntry;
	private readonly liveEntries: ReadonlyMap<string, ThinkingNotesEntry>;
	private readonly theme: Theme;

	constructor(initial: ThinkingNotesEntry, liveEntries: ReadonlyMap<string, ThinkingNotesEntry>, theme: Theme) {
		this.initial = initial;
		this.liveEntries = liveEntries;
		this.theme = theme;
		this.box = new Box(1, 1, (line) => theme.bg("customMessageBg", line));
		this.box.addChild(this.text);
	}

	render(width: number): string[] {
		const current = this.liveEntries.get(this.initial.key) ?? this.initial;
		const state = current.complete ? "完成" : "流式";
		const title = this.theme.fg("accent", `思考块 ${current.ordinal} · ${state}`);
		const details = this.theme.fg(
			"muted",
			`段落 ${current.paragraphs}  字符 ${current.characters}  行 ${current.lines}`,
		);
		this.text.setText(`${title}\n${details}`);
		return this.box.render(width);
	}

	invalidate(): void {
		this.box.invalidate();
		this.text.invalidate();
	}
}

export default function thinkingNotes(pi: ExtensionAPI): void {
	const sessionNonce = randomUUID();
	const liveEntries = new Map<string, ThinkingNotesEntry>();
	let configState: ConfigState | undefined;
	let sessionEnabled: boolean | undefined;
	let activeStreamId: string | undefined;
	let streamSerial = 0;
	let thinkingOrdinal = 0;

	const refreshConfig = (cwd: string): ConfigState => {
		configState = loadConfig(cwd);
		return configState;
	};

	const effectiveEnabled = (): boolean => sessionEnabled ?? configState?.config.enabled ?? true;

	pi.registerEntryRenderer<ThinkingNotesEntry>(ENTRY_TYPE, (entry, _options, theme) => {
		const initial = entry.data ?? {
			key: "missing-entry-data",
			index: 0,
			ordinal: 1,
			text: "",
			complete: true,
			...getThinkingStats(""),
		};
		return new ThinkingNotesComponent(initial, liveEntries, theme);
	});

	pi.registerCommand("thinking-notes", {
		description: "查看或切换 thinking-notes（status/on/off）",
		getArgumentCompletions: (prefix) => {
			const values = ["status", "on", "off"];
			const matches = values.filter((value) => value.startsWith(prefix));
			return matches.length > 0 ? matches.map((value) => ({ value, label: value })) : null;
		},
		handler: async (args, ctx) => {
			const command = args.trim().toLowerCase() || "status";
			const state = refreshConfig(ctx.cwd);
			if (command === "on" || command === "off") {
				sessionEnabled = command === "on";
				ctx.ui.notify(`thinking-notes: ${command}（仅当前会话，不修改 JSON 配置）`, "info");
				return;
			}
			if (command !== "status") {
				ctx.ui.notify("用法：/thinking-notes status | on | off", "warning");
				return;
			}
			ctx.ui.notify(formatConfigStatus(state, effectiveEnabled(), sessionEnabled !== undefined), "info");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		configState = refreshConfig(ctx.cwd);
		sessionEnabled = undefined;
		activeStreamId = undefined;
		streamSerial = 0;
		thinkingOrdinal = 0;
		liveEntries.clear();
	});

	pi.on("message_start", (event) => {
		if (event.message.role === "assistant") {
			activeStreamId = `${sessionNonce}:${++streamSerial}`;
			thinkingOrdinal = 0;
		}
	});

	pi.on("message_update", (event) => {
		if (!effectiveEnabled() || !isThinkingStreamEvent(event.assistantMessageEvent)) return;
		if (!activeStreamId) activeStreamId = `${sessionNonce}:${++streamSerial}`;

		const streamEvent = event.assistantMessageEvent;
		const text = readThinkingText(streamEvent);
		if (text === undefined) return;
		const key = `${activeStreamId}:${streamEvent.contentIndex}`;
		const existing = liveEntries.get(key);
		const next: ThinkingNotesEntry = {
			key,
			index: streamEvent.contentIndex,
			ordinal: existing?.ordinal ?? ++thinkingOrdinal,
			text,
			complete: streamEvent.type === "thinking_end",
			...getThinkingStats(text),
		};
		if (existing) {
			Object.assign(existing, next);
		} else {
			liveEntries.set(key, next);
			pi.appendEntry<ThinkingNotesEntry>(ENTRY_TYPE, next);
		}
	});

	pi.on("message_end", (event) => {
		if (event.message.role === "assistant") activeStreamId = undefined;
	});
}

export const __testing = {
	getThinkingStats,
	getConfigPaths,
	mergeConfig,
	splitThinkingBlocks,
};
