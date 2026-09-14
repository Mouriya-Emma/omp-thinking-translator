# omp-thinking-translator

An omp extension that translates visible assistant thinking blocks into another language for display only.

It renders one translation box directly below each visible assistant thinking block. Translations stay in extension memory: they are never written to the session file, never part of the next model request, and never part of compaction input. See [Context Boundary](#context-boundary) for the mechanism, the runtime evidence, and what is explicitly not covered.

## Features

- Translates the lines the host actually displays. The renderer receives the display text of each visible thinking block, and that text is the single source of truth for both what gets translated and where each translation is drawn — so a line the host rewrote (prose-only fence elision, empty reasoning-summary comments, streaming reveal) can no longer end up with no slot. That contract is pinned by a test that runs the host's own `formatThinkingForDisplay` over fenced and comment-bearing thinking and requires every still-displayed line to resolve back to its raw line.
- Gates per line, not per block: a line is translated when it contains Latin letters and more Latin letters than Chinese characters. A one-sentence thinking block right before a tool call is translated like any other.
- Translates while the block is still streaming. The host recreates the renderer on every display-text change, so each completed line is dispatched as soon as it appears — measured at 3 ms after `thinking_end` for a one-line block. The trailing line is withheld while the block is open, and a display line is dispatched only once it is a complete line of that block's raw thinking, because the host keeps revealing text after `thinking_end` and every revealed prefix would otherwise become its own request.
- Dispatches only blocks of the message being produced, matched against that message's raw thinking (`isCompleteBlockLine`). Replayed history is rendered but not re-translated.
- Each box shows a `思考翻译 · 块 N · done/total` title (N counts thinking blocks within the same message) plus per-line status: waiting, streaming partial text, final text, or a failure message. Translation updates repaint through the host-provided `requestRender` for as long as the host still renders that component.
- Falls back to a persistent widget above the editor for translations that arrive too late to be painted. The host commits a thinking block's rows to native scrollback once the assistant message reaches its tool call, after which no extension repaint can rewrite them; a translation that lands after that would be invisible. The extension marks a cell painted whenever the box draws its text, and a cell still unpainted 700 ms after completion is mirrored into `思考翻译 · 已滚出可重绘区域` (last three lines) through `ctx.ui.setWidget`, which stays repaintable for the rest of the session.
- Supports a global config with per-project overrides.

## Requirements

- omp (`@oh-my-pi/pi-coding-agent`), verified with 18.1.19. The host build must provide `registerAssistantThinkingRenderer`.

This extension is omp-only, not a pi extension. It is built on omp's extension API: the translation box attaches through `pi.registerAssistantThinkingRenderer`, which upstream pi does not provide, and every import resolves against omp's `@oh-my-pi/*` packages rather than pi's own. Running it on pi would mean a different display surface, not a configuration change.

## Install

This extension is installed from git; it is not published to any package registry.

```bash
omp install git:github.com/Mouriya-Emma/omp-thinking-translator
```

For local development, either load the extension file directly:

```bash
omp -e /absolute/path/to/omp-thinking-translator/extensions/thinking-translator.ts
```

or install from a local checkout:

```bash
omp install /absolute/path/to/omp-thinking-translator
```

The manifest key is `omp.extensions`, and the pinned `@oh-my-pi/*` 18.1.19 packages live in `devDependencies` only: the host already provides them, so installing this extension adds no `@oh-my-pi` packages under the plugin directory.

## Quick Start

1. Install the extension:

   ```bash
   omp install git:github.com/Mouriya-Emma/omp-thinking-translator
   ```

2. Create a global config template from inside omp:

   ```text
   /thinking-translator init --global
   ```

3. Edit the generated file:

   ```text
   ~/.omp/agent/thinking-translator.json
   ```

4. Point the extension at a translator model and enable it:

   ```json
   {
     "enabled": true,
     "translatorModel": {
       "provider": "deepseek",
       "id": "deepseek-v4-flash"
     }
   }
   ```

5. Check the effective config:

   ```text
   /thinking-translator status
   ```

The `provider` and `id` must match a model visible to omp, for example a model from the host model registry. Under `omp --profile <name>`, omp points the agent directory at `~/.omp/profiles/<name>/agent`, so the global config for that profile lives there instead.

## Commands

```text
/thinking-translator
/thinking-translator status
/thinking-translator init
/thinking-translator init --global
/thinking-translator init --project
```

- `/thinking-translator` and `/thinking-translator status` show the effective config, config file paths, and translator model availability.
- `/thinking-translator init` creates the global config, same as `/thinking-translator init --global`.
- `/thinking-translator init --global` creates `<agentDir>/thinking-translator.json` (default `~/.omp/agent/thinking-translator.json`) if it does not already exist.
- `/thinking-translator init --project` creates `<cwd>/.omp/thinking-translator.json` in the current project if it does not already exist.

The init commands write a disabled template and do not choose a model. You must explicitly set `translatorModel` and set `enabled` to `true`.

## Configuration

The extension never writes config files on its own; files are created only by the `init` commands, and built-in defaults apply until you override them. Files hold partial overrides that merge over the defaults:

1. Built-in defaults
2. Global config: `<agentDir>/thinking-translator.json`, where `<agentDir>` is `$PI_CODING_AGENT_DIR` when set, otherwise `~/.omp/agent` (default `~/.omp/agent/thinking-translator.json`)
3. Project config: `<cwd>/.omp/thinking-translator.json`

The project file is read after the global file, so it wins on every field it sets, including individual `translatorModel` subfields.

A complete config looks like this:

```json
{
  "enabled": true,
  "targetLanguage": "Simplified Chinese",
  "translatorModel": {
    "provider": "deepseek",
    "id": "deepseek-v4-flash"
  }
}
```

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Enables translation processing. If no `translatorModel` is configured, translation is skipped with a warning. |
| `targetLanguage` | string | `"Simplified Chinese"` | Target language passed to the translator model. Must be a non-empty string. |
| `translatorModel` | object | unset | Translator model reference: `{ "provider": "...", "id": "..." }`. Both fields are required for the reference to take effect. |

`contentTypes` and `minLatinChars`, left over from older config shapes, are silently ignored: only thinking blocks are translated, and translatability is decided per line rather than by a block-length threshold.

If any config file fails to parse, the extension shows a one-time warning naming that path and forces `enabled` to `false`, so nothing is translated under a broken config. If translation is enabled but `translatorModel` is missing or cannot be found in the host model registry, the extension warns once and skips translation without affecting the main assistant message. A failed translation request leaves the original thinking untouched and surfaces the error inside that line's slot.

## How It Works

1. The extension tracks the message in flight: `message_start` resets its per-message state, `message_update` records each thinking block's raw text (and marks the block closed on `thinking_end`), and `message_end` closes whatever the provider left open.
2. The host resolves the display text of every visible thinking block and calls the registered renderer factory with it, again on every change to that text.
3. On each render the extension splits that display text on newlines, trims the lines, and keeps those with Latin letters. While the block is still open it withholds the trailing line, because a half-written line changes on every repaint and would be translated as a stream of throwaway fragments.
4. Each remaining line is checked against the per-line gate and against the current message's raw thinking: it must be a complete line of that block, so revealed prefixes, other messages, and replayed history are not dispatched.
5. Each line text is translated at most once per translator model and target language: the first dispatch creates its slot and fires one independent streaming request, and every later render reuses that slot. Slow lines never block their siblings, and every line lands back in original order.
6. `render()` looks each displayed line up in the table and draws the box beneath that block with a `done/total` title and per-line status. Every translation arrival or failure calls the host-provided `requestRender`, so a box the host still renders keeps filling in and recounting.
7. A translation whose rows the host already committed to scrollback cannot be painted there. Such a cell is never drawn again, so 700 ms after it completes the extension mirrors it into the persistent widget above the editor instead.
8. Translations live only in an in-memory table and are dropped on session start, session switch, and session shutdown, together with the widget. Nothing is appended to the session transcript and no translation is ever fed back as model input; see [Context Boundary](#context-boundary).

## Context Boundary

The translation box is presentation output, not conversation content. The canonical assistant thinking — what omp persists, sends on the next turn, and feeds to compaction — stays the original text the model produced.

Mechanism:

- Translations live in a module-local `Map` keyed by displayed line text plus translator model and target language (`extensions/thinking-translator.ts:47`, `:272-275`), read only by the component returned from `pi.registerAssistantThinkingRenderer` and by the widget fallback. Those rows flow into the TUI container tree and terminate at the terminal write; on host 18.1.19 no consumer of them reaches a session writer, the provider request builder, or compaction (`assistant-message.ts:841-860` → `pi-tui/src/tui.ts:486-513` → `tui.ts:2735-2781`).
- The `context.text` handed to the renderer is a resolved display string in a freshly allocated object (`assistant-message.ts:841-852`), not a reference into the stored `AgentMessage`, so a renderer cannot mutate the message through it.
- Persistence writes typed `SessionEntry.message` values to the session JSONL (`session-manager.ts:2288-2305`, `:817-818`); the next request is rebuilt from those entries (`session-context.ts:216-272`, `agent-loop.ts:1627-1673`); compaction partitions the same branch entries (`compaction.ts:1328-1382`). None of the three reads rendered rows.
- The hooks that can change model-visible data in this host are `context`, `before_provider_request`, `before_agent_start`, `session_before_compact`, and `session_stop`. The extension registers none of them; its only handlers are session reset, per-message state tracking, and the thinking-block bookkeeping in `message_update`/`message_end` (`extensions/thinking-translator.ts:104-214`).

Verified at runtime on omp 18.1.19, driving the real TUI with a throwaway read-only observer extension attached to `before_provider_request` (the final pre-send payload hook) and `session_before_compact`, using high-entropy fragments of the rendered Chinese plus the box labels `思考翻译` / `等待翻译` / `翻译失败` as canaries:

- **Next turn, before any compaction.** The provider payload of the turn that directly followed a completed translation box carried the assistant `thinking` part unchanged (5209 chars, SHA-256 `068c357d54f0d1b0b84453a10c2a3c5c2acc445d2d116b1f39d1dd34f1923b55`) plus its text; a recursive scan of every string in the serialized payload counted 0 occurrences of every canary. This request was observed before any compaction ran, so nothing ephemeral could have been stripped by it; a second run showed the same for its own pre-compaction turn (assistant `thinking` 4491 chars, SHA-256 `e9cb8a43…`, 0 canaries).
- **Compaction input.** A `/compact` whose summarized set contained the translated block — `messagesToSummarize` = 13, `messagesToSummarize[0]` the same assistant message with the identical thinking hash — had 0 canary occurrences in the whole `CompactionPreparation`, in the 3958-char summary omp then persisted, and in the following provider payload.
- **Session store.** Structural scan of every record, message, and content part of the target session JSONL: 0 canary occurrences, and the persisted thinking hash equals the one sent to the provider. `agent.db` holds settings/auth/usage tables, not transcript messages, and its raw file plus WAL/SHM also had 0 occurrences.

Minimal reproduction:

1. Write a throwaway extension that registers `pi.on("before_provider_request", ...)` and `pi.on("session_before_compact", ...)`, appends `JSON.stringify` of the payload and of `event.preparation` to two files, and returns `undefined` from both handlers.
2. Start `omp -e /path/to/extensions/thinking-translator.ts -e /path/to/observer.ts` in a scratch directory.
3. Send an English prompt that produces a multi-line thinking block, and wait until the box reads `思考翻译 · 块 N · M/M`. Copy two distinctive fragments of the rendered Chinese — they must not occur in the prompt or in the thinking itself.
4. Send another turn, then search the newest `before_provider_request` payload recursively for those fragments and for the three box labels. Expect zero, and expect the assistant `thinking` string to hash to the same value the session JSONL stores.
5. Add filler turns until `/compact` reports a non-empty `messagesToSummarize`, run it, and search the recorded `preparation` and the persisted compaction summary the same way. Expect zero while the summarized assistant message still carries the original thinking hash.
6. Parse the session JSONL and search every content part. Expect zero.

Not covered by this boundary:

- **The translation request itself.** Each eligible thinking line is sent to the configured translator model as its own standalone request (`extensions/thinking-translator.ts:232-269`), separate from the agent conversation. "Not in the agent context" does not mean "not sent to any model": that provider sees your thinking text and retains it under its own policy.
- **Display-derived artifacts.** Terminal scrollback, a terminal recorder, the late-translation widget, and omp's own `/debug-transcript` (which dumps rendered rows to a temp file, `command-controller.ts:225-236`) contain translated rows by design. That is an observability surface, not conversation context.
- **Untested paths.** The compaction check ran on a resumed persisted session, so resume is covered to the extent that its canonical messages, provider payloads, and compaction input were inspected — not that historical translations re-render or that every resume UI path was exercised. Session export/import serializers and branch switching were not exercised at all.
- **Version scope.** The evidence is for this extension revision on omp 18.1.19. The guarantee rests on the host renderer contract and on the request/compaction paths cited above, not on a documented API promise, so re-verify after a host upgrade.

## Limitations

- If a thinking block is not visible (for example folded away by the host so it never renders), the host never invokes the translation renderer and no box appears for it.
- Terminal scrollback is immutable. The host commits a thinking block's rows once the assistant message reaches its tool call, and after that the box is frozen at whatever it showed — measured: a 998 ms translation landed in the box, a 1567 ms one did not. The widget above the editor is the fallback for exactly that case, so the translation is still readable, just not under its own block.
- Translations exist only in memory: quitting omp or switching sessions discards them, and previously shown messages are not backfilled when a session reopens.
- Within one session, two identical lines share a single translation as long as the translator model and target language are unchanged.

## Security Notes

omp extensions run with full system permissions. Review extension source before installing third-party packages.

Translation backends receive the eligible thinking lines, so use a local model if that content should not leave your machine.

## Development

```bash
pnpm install
pnpm check
```

`pnpm check` runs the TypeScript check plus the test file. Tests run under Bun because the host packages expose TypeScript sources as their entries.

## Package Layout

- `extensions/thinking-translator.ts` — the extension: renderer registration, event handling, translation fan-out, and config commands.
- `tests/thinking-translator.test.ts` — unit tests for config handling and the translation helpers.
- `package.json` — manifest declaring the `omp.extensions` entry and pinned `devDependencies`.
- `README.md` — this file.
