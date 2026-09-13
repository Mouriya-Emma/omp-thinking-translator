# Pi Thinking Translator

Translate Pi assistant thinking blocks for display without sending those translations back into future model context.

This package is a Pi extension for users who prefer to inspect visible assistant thinking blocks in another language. By default, it only translates `thinking` blocks and does not choose a translator model automatically.

## Features

- Translates a completed `thinking` block when its `thinking_end` event arrives, using the event's full text.
- Splits the block on newlines, drops empty lines and lines without Latin letters, then translates each remaining line with its own concurrent model request; lines fill in as they arrive and render in original line order.
- Uses a model already configured in Pi's model registry.
- Shows one translation box per block below the original assistant message, rendered from a session `custom` entry via `registerEntryRenderer`.
- Each box shows a `done/total` title plus per-line status: waiting, partial translation while streaming, final translation, or a failure message.
- Translation entries are written to the session file but never enter future model context, compaction input, or provider cache keys.
- Supports optional translation of normal assistant `text` answers when explicitly enabled.
- Supports global config with project-level overrides.

## Install

Install from npm:

```bash
pi install npm:pi-thinking-translator
```

Install from GitHub:

```bash
pi install git:github.com/mouriya-s-lab/pi-thinking-translator@v0.2.0
```

For local development from a checkout:

```bash
pi -e /absolute/path/to/pi-thinking-translator
```

Requires a Pi build that provides `registerEntryRenderer` (verified with 0.85.1).

## Quick Start

1. Install the extension:

   ```bash
   pi install npm:pi-thinking-translator
   ```

2. Create a global config template from inside Pi:

   ```text
   /thinking-translator init --global
   ```

3. Edit the generated file:

   ```text
   ~/.pi/agent/thinking-translator.json
   ```

4. Enable translation and point the extension at a Pi model:

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

The `provider` and `id` must match a model visible to Pi, for example a model configured in `~/.pi/agent/models.json` or provided by a built-in provider.

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
- `/thinking-translator init --global` creates `~/.pi/agent/thinking-translator.json` if it does not already exist.
- `/thinking-translator init --project` creates `.pi/thinking-translator.json` in the current project if it does not already exist.

The init commands create a disabled template and do not write a default model. You must explicitly set `translatorModel` and enable translation.

## Configuration

The extension does not create a config file automatically and does not choose a default translator model. Built-in defaults are used unless you explicitly override them:

```json
{
  "enabled": true,
  "targetLanguage": "Simplified Chinese",
  "contentTypes": ["thinking"],
  "minLatinChars": 250
}
```

Configuration files are optional partial overrides. They follow Pi's global/project convention:

1. Built-in defaults
2. Global config: `~/.pi/agent/thinking-translator.json`
3. Project config: `.pi/thinking-translator.json`

Project config overrides global config.

### Example: global translator model

```json
{
  "enabled": true,
  "translatorModel": {
    "provider": "deepseek",
    "id": "deepseek-v4-flash"
  }
}
```

### Example: enable normal answer translation for one project

Create `.pi/thinking-translator.json` in that project:

```json
{
  "contentTypes": ["thinking", "text"]
}
```

When `text` is enabled, the translated answer is shown in the same per-block translation box below the assistant message. The extension still leaves the original assistant answer unchanged.

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Enables translation processing. If no `translatorModel` is configured, translation is skipped with a warning. |
| `targetLanguage` | string | `"Simplified Chinese"` | Target language passed to the translator model. |
| `contentTypes` | string[] | `["thinking"]` | Visible assistant block types to translate. Supported values: `thinking`, `text`. |
| `minLatinChars` | number | `250` | Minimum number of Latin letters in the whole block text required before the block is considered translatable. |
| `translatorModel` | object | unset | Pi model reference: `{ "provider": "...", "id": "..." }`. |

If translation is enabled but `translatorModel` is missing, cannot be found, or the Pi model registry is unavailable, the extension shows a warning and skips translation without affecting the main assistant message. If a configured model request or credential lookup fails, the extension keeps the original assistant message unchanged and shows a warning for the first occurrence of that error.

## How It Works

1. During an agent turn, the extension listens to assistant streaming events and acts only on completed blocks: `thinking_end`, plus `text_end` when `text` is in `contentTypes`.
2. It first applies the whole-block gate: the block must contain at least `minLatinChars` Latin letters, more than its CJK characters.
3. It splits the block text on newlines, trims each line, and drops empty lines and lines without Latin letters.
4. It sends every remaining line to the configured Pi model as its own concurrent plain-text translation request; lines fill in as they arrive and render in original line order.
5. When the assistant message ends, it appends one `thinking-translation` custom entry per block, so each translation box appears below the original assistant message in the session transcript.
6. Each box shows a `done/total` title plus per-line status: waiting, partial translation while streaming, final translation, or a failure message.
7. It does not call `sendMessage` or modify the assistant message, so translation entries are written to the session file but never enter future model context, compaction summaries, or branch summaries.

This design lets you inspect translations after each block completes while avoiding display translations becoming future model input or provider cache material.

## Security Notes

Pi extensions run with full system permissions. Review extension source before installing third-party packages.

Translation backends may receive the visible blocks enabled by `contentTypes`, including final assistant answers if `text` is enabled. Use a local model if that content should not leave your machine.

The current implementation stores translations as session `custom` entries (written to the session file but excluded from model context) instead of assistant messages, so display translations do not enter future model context, compaction summaries, or branch summaries.

## Documentation

Pi extension development notes for this repository live in [`docs/`](./docs/README.md):

- [`docs/pi-extension-api.md`](./docs/pi-extension-api.md) — what the Pi extension API can do (every `ExtensionAPI` member, contexts, UI, renderers, providers, and explicit limits).
- [`docs/pi-extension-events.md`](./docs/pi-extension-events.md) — event timing plus session, LLM context, and compaction boundaries.
- [`docs/extension-development-guide.md`](./docs/extension-development-guide.md) — end-to-end development flow with a runnable example under [`docs/examples/`](./docs/examples).

All three are written against the locally installed Pi runtime and cite `path:line` evidence. They are excluded from the npm tarball by the `files` whitelist.

## Development

```bash
pnpm install
pnpm check
```

## Package Layout

```text
pi-thinking-translator/
  package.json
  README.md
  TODO.md
  extensions/
    thinking-translator.ts
  tests/
    thinking-translator.test.ts
  docs/
    README.md
    pi-extension-api.md
    pi-extension-events.md
    extension-development-guide.md
    examples/
      thinking-notes/
      faux-harness/
```

## Roadmap

- Add optional API translator backends.
