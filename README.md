# Pi Thinking Translator

Translate Pi assistant thinking blocks for display without sending those translations back into future model context.

This package is a Pi extension for users who prefer to inspect visible assistant thinking/reasoning summaries in another language. By default, it only translates `thinking` blocks and does not choose a translator model automatically.

## Features

- Translates configured visible assistant content blocks during assistant streaming.
- Uses a model already configured in Pi's model registry.
- Shows translations in a fixed widget above the editor instead of notifications, persistent session messages, or message-stream entries.
- For `thinking`, splits content by paragraph using a `short title + blank line + body` heuristic, then translates the previous completed paragraph as soon as the next paragraph begins.
- Accumulates translations in a scrolling widget (last 8 lines visible); clears automatically 30 seconds after the last update.
- Does not modify assistant messages, future model context, compaction input, or provider cache keys.
- Supports optional translation of normal assistant `text` answers when explicitly enabled.
- Supports global config with project-level overrides.

## Install

Install from npm:

```bash
pi install npm:pi-thinking-translator
```

Install from GitHub:

```bash
pi install git:github.com/wplct/pi-thinking-translator@v0.1.7
```

For local development from a checkout:

```bash
pi -e /absolute/path/to/pi-thinking-translator
```

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
/thinking-translator clear
/thinking-translator init
/thinking-translator init --global
/thinking-translator init --project
```

- `/thinking-translator` and `/thinking-translator status` show the effective config, config file paths, and translator model availability.
- `/thinking-translator clear` clears the current temporary translation widget.
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
  "minLatinChars": 24
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

When `text` is enabled, the translated answer is shown in the same temporary widget. The extension still leaves the original assistant answer unchanged.

### Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `enabled` | boolean | `true` | Enables translation processing. If no `translatorModel` is configured, translation is skipped with a warning. |
| `targetLanguage` | string | `"Simplified Chinese"` | Target language passed to the translator model. |
| `contentTypes` | string[] | `["thinking"]` | Visible assistant block types to translate. Supported values: `thinking`, `reasoning`, `reasoning_summary`, `text`. |
| `minLatinChars` | number | `250` | Minimum number of Latin letters required before a block is considered translatable. |
| `translatorModel` | object | unset | Pi model reference: `{ "provider": "...", "id": "..." }`. |

If translation is enabled but `translatorModel` is missing, cannot be found, or the Pi model registry is unavailable, the extension shows a warning and skips translation without affecting the main assistant message. If a configured model request or credential lookup fails, the extension keeps the original assistant message unchanged and shows a warning for the first occurrence of that error.

## How It Works

1. During an agent turn, the extension listens to assistant streaming events.
2. For `thinking`, it detects paragraph starts using a `short title + blank line` heuristic and treats each `title + body` group as one translatable paragraph.
3. When the next paragraph starts, it sends the previous completed paragraph to the configured Pi model with strict JSON-output instructions.
4. It parses only `{ "translation": "..." }`; non-JSON or malformed outputs are rejected instead of displayed.
5. It appends the cleaned translation to a fixed scrolling widget above the editor.
6. It clears the widget automatically 30 seconds after the last translated update.
7. It does not call `sendMessage`, append a custom message, or return a modified assistant message, so translations are not written to the session file or future context.

This design lets you inspect translations during streaming while avoiding display translations becoming future model input or provider cache material.

## Security Notes

Pi extensions run with full system permissions. Review extension source before installing third-party packages.

Translation backends may receive the visible blocks enabled by `contentTypes`, including final assistant answers if `text` is enabled. Use a local model if that content should not leave your machine.

The current implementation displays translations through a temporary widget instead of assistant messages, so display translations do not enter future model context or compaction summaries.

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
- Add more runtime validation around context and compaction isolation.
