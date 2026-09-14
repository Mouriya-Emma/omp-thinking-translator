import test from "node:test";
import assert from "node:assert/strict";
import { __testing } from "../extensions/thinking-translator.ts";

test("config paths honor the active omp agent directory and project root", () => {
	assert.equal(__testing.getGlobalConfigPath("/profiles/work/agent", "/home/user"), "/profiles/work/agent/thinking-translator.json");
	assert.equal(__testing.getGlobalConfigPath(undefined, "/home/user"), "/home/user/.omp/agent/thinking-translator.json");
	assert.equal(__testing.getProjectConfigPath("/projects/demo"), "/projects/demo/.omp/thinking-translator.json");
	assert.equal(__testing.getProjectConfigPath(undefined), undefined);
});

test("a short single-line thinking block is translatable", () => {
	// 复现用户报告：短 thinking 紧接工具调用时整块长度门槛把它整块跳过了。
	const line = "Let me check the session_init entry in the child, it might contain agent info.";
	assert.equal(__testing.shouldTranslateLine(line), true);
	assert.deepEqual(__testing.splitTranslationLines(line), [line]);
});

test("legacy and unknown fields are ignored without losing valid overrides", () => {
	const config = __testing.mergeConfig(__testing.DEFAULT_CONFIG, {
		contentTypes: ["text"], extra: 123, targetLanguage: "Japanese",
		translatorModel: { provider: "faux", id: "translator" },
	});
	assert.equal(config.targetLanguage, "Japanese");
	assert.deepEqual(config.translatorModel, { provider: "faux", id: "translator" });
	assert.equal("contentTypes" in config, false);
	assert.equal("extra" in config, false);
});

test("invalid known fields fail closed instead of enabling unexpected requests", () => {
	for (const value of [null, [], { enabled: "yes" }, { targetLanguage: "" }]) {
		assert.throws(() => __testing.mergeConfig(__testing.DEFAULT_CONFIG, value));
	}
});

test("the removed minLatinChars key is ignored instead of gating translation", () => {
	const layered = __testing.mergeConfig(__testing.DEFAULT_CONFIG, { targetLanguage: "English", minLatinChars: 250 });
	assert.equal(layered.targetLanguage, "English");
	assert.equal("minLatinChars" in layered, false);
});

test("mergeConfig supports partial translatorModel overlay and null clears", () => {
	const baseWithModel = __testing.mergeConfig(__testing.DEFAULT_CONFIG, {
		translatorModel: { provider: "ollama", id: "qwen2.5:7b" },
	});
	const providerOverlay = __testing.mergeConfig(baseWithModel, {
		translatorModel: { provider: "openai" },
	});
	assert.deepEqual(providerOverlay.translatorModel, { provider: "openai", id: "qwen2.5:7b" });
	const idOverlay = __testing.mergeConfig(baseWithModel, {
		translatorModel: { id: "gpt-4o-mini" },
	});
	assert.deepEqual(idOverlay.translatorModel, { provider: "ollama", id: "gpt-4o-mini" });
	const cleared = __testing.mergeConfig(baseWithModel, { translatorModel: null });
	assert.equal(cleared.translatorModel, undefined);
	const preserved = __testing.mergeConfig(baseWithModel, {});
	assert.deepEqual(preserved.translatorModel, { provider: "ollama", id: "qwen2.5:7b" });
});

test("normalizeTranslatorModel falls back on undefined and clears on null", () => {
	const fallback = { provider: "ollama", id: "qwen2.5:7b" };
	assert.deepEqual(__testing.normalizeTranslatorModel(undefined, fallback), fallback);
	assert.equal(__testing.normalizeTranslatorModel(undefined), undefined);
	assert.equal(__testing.normalizeTranslatorModel(null, fallback), undefined);
	assert.equal(__testing.normalizeTranslatorModel(null), undefined);
	assert.deepEqual(
		__testing.normalizeTranslatorModel({ provider: "openai" }, fallback),
		{ provider: "openai", id: "qwen2.5:7b" },
	);
	assert.deepEqual(
		__testing.normalizeTranslatorModel({ id: "gpt-4o-mini" }, fallback),
		{ provider: "ollama", id: "gpt-4o-mini" },
	);
});

test("normalizeTranslatorModel rejects incomplete or non-object models", () => {
	assert.equal(__testing.normalizeTranslatorModel({ provider: "ollama" }), undefined);
	assert.equal(__testing.normalizeTranslatorModel({ id: "qwen2.5:7b" }), undefined);
	assert.equal(__testing.normalizeTranslatorModel({}), undefined);
	assert.equal(__testing.normalizeTranslatorModel("ollama"), undefined);
	assert.equal(__testing.normalizeTranslatorModel(123), undefined);
	assert.deepEqual(__testing.normalizeTranslatorModel({ provider: "ollama", id: "qwen2.5:7b" }), {
		provider: "ollama",
		id: "qwen2.5:7b",
	});
});

test("shouldTranslateLine accepts foreign lines of any length and rejects the rest", () => {
	assert.equal(__testing.shouldTranslateLine("OK."), true);
	assert.equal(__testing.shouldTranslateLine("abcde你好"), true);
	assert.equal(__testing.shouldTranslateLine("abcde你好啊你好"), false);
	assert.equal(__testing.shouldTranslateLine("已经确认过了。"), false);
	assert.equal(__testing.shouldTranslateLine("123 —— 456"), false);
	assert.equal(__testing.shouldTranslateLine(""), false);
});

test("isCompleteBlockLine accepts host rewrites and rejects reveal prefixes", () => {
	const raw = "Check the parser first.\n```ts\nconst x = 1;\n```\nThen run the tests.";
	assert.equal(__testing.isCompleteBlockLine(raw, "Check the parser first."), true);
	assert.equal(__testing.isCompleteBlockLine(raw, "Then run the tests."), true);
	// 宿主折叠代码围栏时会把前一行改成省略号收尾，有时还吃掉句末句号。
	assert.equal(__testing.isCompleteBlockLine(raw, "Check the parser first...."), true);
	assert.equal(__testing.isCompleteBlockLine(raw, "Check the parser first…"), true);
	// 流式揭示的前缀每次重绘都是新键，必须挡住，否则一行会被翻译成好几份。
	assert.equal(__testing.isCompleteBlockLine(raw, "Check the par"), false);
	assert.equal(__testing.isCompleteBlockLine(raw, "Then run the te"), false);
	// 历史消息的行不属于当前块，不会被重新分发。
	assert.equal(__testing.isCompleteBlockLine(raw, "A line from an older message."), false);
	// 块尾没有换行时末行仍然算完整。
	assert.equal(__testing.isCompleteBlockLine("Only one line here.", "Only one line here."), true);
});

test("cellKey separates translator model and target language", () => {
	const base = { ...__testing.DEFAULT_CONFIG, translatorModel: { provider: "ollama", id: "qwen2.5:7b" } };
	const line = "Check the parser first.";
	assert.notEqual(__testing.cellKey(base, line), __testing.cellKey({ ...base, targetLanguage: "Japanese" }, line));
	assert.notEqual(__testing.cellKey(base, line), __testing.cellKey({ ...base, translatorModel: { provider: "ollama", id: "other" } }, line));
	assert.equal(__testing.cellKey(base, line), __testing.cellKey({ ...base }, line));
});

test("cleanTranslation removes common model wrappers", () => {
	assert.equal(__testing.cleanTranslation("```markdown\n你好\n```"), "你好");
	assert.equal(__testing.cleanTranslation("<thinking>\n你好\n</thinking>"), "你好");
	assert.equal(__testing.cleanTranslation("<text>\n你好\n</text>"), "你好");
});

test("cleanTranslation preserves normal internal text", () => {
	assert.equal(__testing.cleanTranslation("hello   world"), "hello   world");
	assert.equal(__testing.cleanTranslation("first line\nsecond   line"), "first line\nsecond   line");
	assert.equal(__testing.cleanTranslation("  hello   world  "), "hello   world");
});

test("line requests preserve order and duplicates while omitting non-Latin lines", () => {
	assert.deepEqual(__testing.splitTranslationLines("\n first\r\n\n中文\n123\nsecond\nfirst\n"), ["first", "second", "first"]);
});

test("splitTranslationLines returns empty for all-whitespace input", () => {
	assert.deepEqual(__testing.splitTranslationLines("   \n \t \n  "), []);
	assert.deepEqual(__testing.splitTranslationLines(""), []);
});

test("splitTranslationLines trims outer indent but keeps internal spacing", () => {
	assert.deepEqual(__testing.splitTranslationLines("  hello   world  "), ["hello   world"]);
	assert.deepEqual(__testing.splitTranslationLines("  foo  bar  \n  baz   qux  "), ["foo  bar", "baz   qux"]);
});

