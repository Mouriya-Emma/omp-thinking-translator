import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type {
	fauxAssistantMessage,
	fauxProvider,
	fauxText,
	fauxThinking,
} from "@earendil-works/pi-ai/providers/faux";

/**
 * 0.85.1 的 faux provider 位于 Pi 安装自身的 node_modules；本仓库 node_modules
 * 是 0.75.3，且 exports 不暴露 providers/faux，因此这里在运行时按 Pi 可执行文件
 * 位置载入 0.85.1。类型直接复用公开声明，避免把签名写成猜测。
 */
type FauxModule = {
	fauxAssistantMessage: typeof fauxAssistantMessage;
	fauxProvider: typeof fauxProvider;
	fauxText: typeof fauxText;
	fauxThinking: typeof fauxThinking;
};

const PROVIDER_ID = "thinking-notes-faux";
const MODEL_ID = "thinking-notes-demo";

function findRuntimeFauxModule(): string {
	const executablePath = process.argv[1];
	if (!executablePath) throw new Error("无法确定 Pi 可执行文件位置");
	const executableDir = dirname(realpathSync(executablePath));
	const packageTail = join("node_modules", "@earendil-works", "pi-ai", "dist", "providers", "faux.js");
	const candidates = [join(executableDir, "..", "..", packageTail), join(executableDir, "..", packageTail)];
	const modulePath = candidates.find((candidate) => existsSync(candidate));
	if (!modulePath) {
		throw new Error(`无法从 Pi 可执行文件位置找到 0.85.1 faux provider：${candidates.join(" | ")}`);
	}
	return modulePath;
}

async function loadRuntimeFauxModule(): Promise<FauxModule> {
	// 动态载入是为了绕过仓库 0.75.3 的 exports；目标模块路径由 Pi 运行时位置决定。
	const loaded: unknown = await import(pathToFileURL(findRuntimeFauxModule()).href);
	if (typeof loaded !== "object" || loaded === null) throw new Error("faux provider 模块不是对象");
	const candidate = loaded as {
		fauxAssistantMessage?: unknown;
		fauxProvider?: unknown;
		fauxText?: unknown;
		fauxThinking?: unknown;
	};
	if (
		typeof candidate.fauxAssistantMessage !== "function" ||
		typeof candidate.fauxProvider !== "function" ||
		typeof candidate.fauxText !== "function" ||
		typeof candidate.fauxThinking !== "function"
	) {
		throw new Error("0.85.1 faux provider 未导出 fauxProvider/fauxAssistantMessage/fauxText/fauxThinking");
	}
	return {
		fauxAssistantMessage: candidate.fauxAssistantMessage as FauxModule["fauxAssistantMessage"],
		fauxProvider: candidate.fauxProvider as FauxModule["fauxProvider"],
		fauxText: candidate.fauxText as FauxModule["fauxText"],
		fauxThinking: candidate.fauxThinking as FauxModule["fauxThinking"],
	};
}

/** 注册无凭据 faux provider，按固定内容输出两个彼此分开的 thinking block。 */
export default async function fauxHarness(pi: ExtensionAPI): Promise<void> {
	const { fauxAssistantMessage, fauxProvider, fauxText, fauxThinking } = await loadRuntimeFauxModule();
	const faux = fauxProvider({
		provider: PROVIDER_ID,
		models: [
			{
				id: MODEL_ID,
				name: "Thinking Notes Faux",
				reasoning: true,
				input: ["text"],
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
				contextWindow: 128_000,
				maxTokens: 512,
			},
		],
		tokenSize: { min: 1, max: 1 },
		tokensPerSecond: 20,
	});

	const response = fauxAssistantMessage([
		fauxThinking("第一块先观察输入。\n\n第一块再计算统计。"),
		fauxText("这是两个 thinking block 之间的普通回答。"),
		fauxThinking("第二块继续核对边界。\n\n第二块完成检查。"),
		fauxText("faux harness done。"),
	]);
	faux.setResponses([response, response]);

	pi.registerProvider(faux.provider);
}
