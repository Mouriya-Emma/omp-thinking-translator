import test from "node:test";
import assert from "node:assert/strict";
import { __testing } from "../extensions/thinking-translator.ts";

test("config paths honor the active omp agent directory and project root", () => {
	assert.equal(__testing.getGlobalConfigPath("/profiles/work/agent", "/home/user"), "/profiles/work/agent/thinking-translator.json");
	assert.equal(__testing.getGlobalConfigPath(undefined, "/home/user"), "/home/user/.omp/agent/thinking-translator.json");
	assert.equal(__testing.getProjectConfigPath("/projects/demo"), "/projects/demo/.omp/thinking-translator.json");
	assert.equal(__testing.getProjectConfigPath(undefined), undefined);
});

test("thinking identity normalizes visible boundaries without merging distinct blocks", () => {
	const key = __testing.thinkingTextKey;
	assert.equal(key("\nfirst\r\nsecond \n"), key("first\nsecond"));
	assert.notEqual(key("first\nsecond"), key("first\nthird"));
	assert.notEqual(key("first"), key("first\nsecond"));
	assert.notEqual(key("first  second"), key("first second"));
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
	for (const value of [null, [], { enabled: "yes" }, { minLatinChars: -1 }, { targetLanguage: "" }]) {
		assert.throws(() => __testing.mergeConfig(__testing.DEFAULT_CONFIG, value));
	}
});

test("mergeConfig layers targetLanguage and minLatinChars overrides", () => {
	const base = { ...__testing.DEFAULT_CONFIG };
	const layered = __testing.mergeConfig(base, { targetLanguage: "English", minLatinChars: 5 });
	assert.equal(layered.targetLanguage, "English");
	assert.equal(layered.minLatinChars, 5);
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

test("line requests preserve order and duplicates while omitting non-Latin lines", () => {
	assert.deepEqual(__testing.splitTranslationLines("\n first\r\n\n中文\n123\nsecond\nfirst\n"), [
		{ index: 0, source: "first" },
		{ index: 1, source: "second" },
		{ index: 2, source: "first" },
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

