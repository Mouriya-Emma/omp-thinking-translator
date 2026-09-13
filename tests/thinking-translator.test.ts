import test from "node:test";
import assert from "node:assert/strict";
import { __testing } from "../extensions/thinking-translator.ts";

test("normalizeContentTypes defaults invalid/empty/all-invalid to thinking", () => {
	assert.deepEqual(__testing.normalizeContentTypes(undefined), ["thinking"]);
	assert.deepEqual(__testing.normalizeContentTypes([]), ["thinking"]);
	assert.deepEqual(__testing.normalizeContentTypes(null), ["thinking"]);
	assert.deepEqual(__testing.normalizeContentTypes("thinking"), ["thinking"]);
	assert.deepEqual(__testing.normalizeContentTypes(["image"]), ["thinking"]);
	assert.deepEqual(__testing.normalizeContentTypes(["unknown", "other"]), ["thinking"]);
});

test("normalizeContentTypes keeps only thinking/text and dedupes", () => {
	assert.deepEqual(__testing.normalizeContentTypes(["thinking", "reasoning", "text"]), ["thinking", "text"]);
	assert.deepEqual(__testing.normalizeContentTypes(["reasoning"]), ["thinking"]);
	assert.deepEqual(__testing.normalizeContentTypes(["reasoning_summary"]), ["thinking"]);
	assert.deepEqual(__testing.normalizeContentTypes(["reasoning", "reasoning_summary"]), ["thinking"]);
	assert.deepEqual(__testing.normalizeContentTypes(["text", "text", "thinking", "text"]), ["text", "thinking"]);
	assert.deepEqual(__testing.normalizeContentTypes(["thinking", "image", "text", "reasoning"]), ["thinking", "text"]);
});

test("mergeConfig layers targetLanguage and minLatinChars overrides", () => {
	const base = { ...__testing.DEFAULT_CONFIG };
	const layered = __testing.mergeConfig(base, { targetLanguage: "English", minLatinChars: 5 });
	assert.equal(layered.targetLanguage, "English");
	assert.equal(layered.minLatinChars, 5);
	assert.deepEqual(layered.contentTypes, base.contentTypes);
	assert.deepEqual(layered.translatorModel, base.translatorModel);
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

test("shouldTranslate passes at threshold and fails below", () => {
	const config = { ...__testing.DEFAULT_CONFIG, minLatinChars: 10 };
	assert.equal(__testing.shouldTranslate("a".repeat(10), config), true);
	assert.equal(__testing.shouldTranslate("a".repeat(9), config), false);
	assert.equal(__testing.shouldTranslate("", config), false);
});

test("shouldTranslate requires Latin dominance over CJK", () => {
	const config = { ...__testing.DEFAULT_CONFIG, minLatinChars: 5 };
	assert.equal(__testing.shouldTranslate("abcde你好", config), true);
	assert.equal(__testing.shouldTranslate("abcde你好啊你好", config), false);
	assert.equal(__testing.shouldTranslate("abcde你好啊你好啊", config), false);
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

test("splitTranslationLines drops blank lines and re-indexes from zero", () => {
	assert.deepEqual(__testing.splitTranslationLines("first\n\nsecond\n   \nthird"), [
		{ index: 0, source: "first" },
		{ index: 1, source: "second" },
		{ index: 2, source: "third" },
	]);
});

test("splitTranslationLines handles CRLF and leading/trailing blank lines", () => {
	assert.deepEqual(__testing.splitTranslationLines("first\r\nsecond\r\n\r\nthird"), [
		{ index: 0, source: "first" },
		{ index: 1, source: "second" },
		{ index: 2, source: "third" },
	]);
	assert.deepEqual(__testing.splitTranslationLines("\n\n  first  \nsecond\n\n"), [
		{ index: 0, source: "first" },
		{ index: 1, source: "second" },
	]);
});

test("splitTranslationLines returns empty for all-whitespace input", () => {
	assert.deepEqual(__testing.splitTranslationLines("   \n \t \n  "), []);
	assert.deepEqual(__testing.splitTranslationLines(""), []);
});

test("splitTranslationLines trims outer indent but keeps internal spacing", () => {
	assert.deepEqual(__testing.splitTranslationLines("  hello   world  "), [{ index: 0, source: "hello   world" }]);
	assert.deepEqual(__testing.splitTranslationLines("  foo  bar  \n  baz   qux  "), [
		{ index: 0, source: "foo  bar" },
		{ index: 1, source: "baz   qux" },
	]);
});

test("resolveTranslatorModel skips safely with diagnostic when unconfigured or unavailable", () => {
	const modelRef = { provider: "ollama", id: "qwen2.5:7b" };
	const base = { ...__testing.DEFAULT_CONFIG, translatorModel: modelRef };

	const unconfiguredNotices: string[] = [];
	const unconfiguredCtx = {
		ui: { notify: (message: string) => unconfiguredNotices.push(message) },
		modelRegistry: { find: () => ({}), getApiKeyAndHeaders: async () => ({ ok: true }) },
	};
	assert.equal(
		__testing.resolveTranslatorModel(unconfiguredCtx, { ...base, translatorModel: undefined }),
		undefined,
	);
	assert.match(unconfiguredNotices.at(-1) ?? "", /translation skipped/);

	const registryNotices: string[] = [];
	const noRegistryCtx = { ui: { notify: (message: string) => registryNotices.push(message) } };
	assert.equal(__testing.resolveTranslatorModel(noRegistryCtx, base), undefined);
	assert.match(registryNotices.at(-1) ?? "", /translation skipped/);

	const missingNotices: string[] = [];
	const missingCtx = {
		ui: { notify: (message: string) => missingNotices.push(message) },
		modelRegistry: { find: () => undefined, getApiKeyAndHeaders: async () => ({ ok: true }) },
	};
	assert.equal(__testing.resolveTranslatorModel(missingCtx, base), undefined);
	assert.match(missingNotices.at(-1) ?? "", /translation skipped/);
	assert.match(missingNotices.at(-1) ?? "", /ollama\/qwen2.5:7b/);
});
