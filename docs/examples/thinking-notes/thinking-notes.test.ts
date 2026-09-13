import test from "node:test";
import assert from "node:assert/strict";
import { __testing } from "./thinking-notes.ts";

test("splitThinkingBlocks preserves content indexes and ignores text blocks", () => {
	assert.deepEqual(
		__testing.splitThinkingBlocks([
			{ type: "text", text: "answer" },
			{ type: "thinking", thinking: "先观察\n\n再判断" },
			{ type: "text", text: "more" },
			{ type: "thinking", thinking: "最后检查" },
		]),
		[
			{ index: 1, text: "先观察\n\n再判断" },
			{ index: 3, text: "最后检查" },
		],
	);
});

test("getThinkingStats counts paragraphs, lines, and Unicode characters", () => {
	assert.deepEqual(__testing.getThinkingStats("第一段\n\n第二段🙂"), {
		paragraphs: 2,
		characters: 9,
		lines: 3,
	});
	assert.deepEqual(__testing.getThinkingStats(""), { paragraphs: 0, characters: 0, lines: 0 });
});

test("mergeConfig applies a project enabled override without dropping the base", () => {
	assert.deepEqual(__testing.mergeConfig({ enabled: true }, { enabled: false }), { enabled: false });
	assert.deepEqual(__testing.mergeConfig({ enabled: false }, { unrelated: "ignored" }), { enabled: false });
});

test("getConfigPaths resolves global before project configuration", () => {
	assert.deepEqual(__testing.getConfigPaths("/workspace/demo", "/tmp/example-home"), [
		{
			scope: "global",
			path: "/tmp/example-home/.pi/agent/thinking-notes.json",
			exists: false,
		},
		{
			scope: "project",
			path: "/workspace/demo/.pi/thinking-notes.json",
			exists: false,
		},
	]);
});
