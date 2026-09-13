# Thinking Translator

An omp extension that translates visible assistant thinking blocks into another language for display only.

It renders one translation box directly below each visible assistant thinking block. Translations stay in memory: they are never written to the session file and never enter model context.

## Features

- Watches `message_update` events and acts only when a thinking block completes (`thinking_end`), using the event's full text.
- Applies a whole-block gate first: the block must contain at least `minLatinChars` Latin letters, and more Latin letters than Chinese characters.
- Splits a translatable block on newlines, trims each line, and drops empty lines and lines without Latin letters.
- Sends every remaining line to the configured translator model as its own concurrent streaming request; lines fill in as they arrive and are placed back in original line order.
- Renders one translation box below the thinking block it belongs to, via `pi.registerAssistantThinkingRenderer`. Block identity is the normalized full text (uniform newlines, trimmed ends), so the box always attaches to the right block.
- Each box shows a `思考翻译 · 块 N · done/total` title (N counts thinking blocks within the same message) plus per-line status: waiting, streaming partial text, final text, or a failure message. Late translation updates repaint through the host-provided `requestRender`.
- Uses a model already configured in omp's model registry; credentials come from the host registry, never from extension-side configuration.
- Supports a global config with per-project overrides.

## Requirements

- omp (`@oh-my-pi/pi-coding-agent`), verified with 18.1.19. The host build must provide `registerAssistantThinkingRenderer`.

## Install

This extension is private and is installed from git; it is not published to any package registry.

```bash
omp install git:github.com/mouriya-s-lab/pi-thinking-translator
```

For local development, either load the extension file directly:

```bash
omp -e /absolute/path/to/pi-thinking-translator/extensions/thinking-translator.ts
```

or install from a local checkout:

```bash
omp install /absolute/path/to/pi-thinking-translator
```

The manifest key is `omp.extensions`, and the pinned `@oh-my-pi/*` 18.1.19 packages live in `devDependencies` only: the host already provides them, so installing this extension adds no `@oh-my-pi` packages under the plugin directory.

## Quick Start

1. Install the extension:

   ```bash
   omp install git:github.com/mouriya-s-lab/pi-thinking-translator
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
  "minLatinChars": 250,
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
| `minLatinChars` | number | `250` | Minimum number of Latin letters in the whole thinking block required before the block is considered translatable. The block must also contain more Latin letters than Chinese characters. |
| `translatorModel` | object | unset | Translator model reference: `{ "provider": "...", "id": "..." }`. Both fields are required for the reference to take effect. |

A `contentTypes` key left over from an older config shape is silently ignored; only thinking blocks are translated.

If any config file fails to parse, the extension shows a one-time warning naming that path and forces `enabled` to `false`, so nothing is translated under a broken config. If translation is enabled but `translatorModel` is missing or cannot be found in the host model registry, the extension warns once and skips translation without affecting the main assistant message. A failed translation request leaves the original thinking untouched and surfaces the error inside that line's slot.

## How It Works

1. During an agent turn, the extension listens to `message_update` events and ignores everything except `thinking_end`.
2. It applies the whole-block gate (`minLatinChars` plus the Latin-over-Chinese majority check) to the event's full text.
3. It splits the text on newlines, trims each line, and keeps only non-empty lines containing Latin letters.
4. Unless an identical normalized block is already tracked, it records the block under its normalized-text key and fires one independent streaming request per line; each line consumes its own incremental deltas, so a slow line never blocks its siblings, and every line lands back in original order.
5. The renderer registered with `pi.registerAssistantThinkingRenderer` looks up the visible thinking text by the same normalized key and draws the translation box beneath that block, with a `done/total` title and per-line status.
6. Every translation arrival or failure calls the host-provided `requestRender`, so boxes that appear while their thinking block is already on screen still fill in and recount automatically.
7. Translations live only in an in-memory table keyed by normalized text and are dropped on session start, session switch, and session shutdown. Nothing is appended to the session transcript and no translation is ever fed back as model input.

## Limitations

- If a thinking block is not visible (for example folded away by the host so it never renders), the host never invokes the translation renderer and no box appears for it.
- Translations exist only in memory: quitting omp or switching sessions discards them, and previously shown messages are not backfilled when a session reopens.
- Within one session, two blocks with identical normalized text share a single stored translation.

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
- `package.json` — private manifest declaring the `omp.extensions` entry and pinned `devDependencies`.
- `README.md` — this file.
