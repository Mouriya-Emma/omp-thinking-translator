# 从零开发 Pi 扩展：`thinking-notes`

本文用一个可以直接运行的扩展走完从需求、接入点、开发、测试、TUI 验证到发布的完整流程。示例代码位于：

- `./examples/thinking-notes/thinking-notes.ts`：真正的扩展；
- `./examples/thinking-notes/thinking-notes.test.ts`：纯函数单测；
- `./examples/faux-harness/faux-harness.ts`：不需要凭据的流式验证夹具。

## 证据约定与版本前提

本文的首要信息源是本机全局安装的 Pi `0.85.1`。本文出现的 `dist/...`、`docs/...`、`examples/...` 路径，除非另有说明，均相对于此前缀：

```text
/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/
```

证据分四级：

- **官方文档**：明确写在安装目录下 `docs/*.md` 的指定小节；
- **dist 代码观察**：直接阅读同一安装目录的编译产物，路径和行号会写出；
- **已实测运行时观察**：在本仓库中用 Pi `0.85.1`、隔离环境和 PTY 实际运行得到；
- **Unverified**：当前没有足够证据，不把推测写成结论。

先确认版本，避免把仓库里的旧依赖当成运行时 API：

```bash
$ pi --version
0.85.1

$ node -e 'const fs=require("node:fs"); const runtime=JSON.parse(fs.readFileSync("/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/package.json","utf8")); const local=JSON.parse(fs.readFileSync("node_modules/@earendil-works/pi-coding-agent/package.json","utf8")); console.log(JSON.stringify({runtime:runtime.version,local:local.version},null,2))'
{
  "runtime": "0.85.1",
  "local": "0.75.3"
}
```

仓库锁文件也记录了本地 `@earendil-works/pi-ai` 和 `@earendil-works/pi-coding-agent` 的 `0.75.3`（仓库 `pnpm-lock.yaml:11-16`）。`registerEntryRenderer`、新版 faux provider 等能力按全局 `0.85.1` 验证；不要用旧的本地声明推断运行时能力。

## 1. 先选对接入点：需求决定事件和展示路线

### 1.1 把需求拆成四个可验证的结果

`thinking-notes` 的需求不是“改写 assistant 文本”，而是：

1. 只观察 assistant 的流式 thinking 事件；
2. 每个 thinking block 单独产生一个持久化的 TUI 条目；
3. 同一个条目在 delta 到来时刷新统计，不产生第二个框；
4. 条目不进入下一轮模型上下文，并提供 `/thinking-notes status|on|off`。

官方文档 `docs/extensions.md` 的 **Events**、**message_start / message_update / message_end** 小节明确：`message_update` 用于 assistant 流式更新，事件同时提供 `event.message` 和 `event.assistantMessageEvent`。全局类型也明确了 `MessageUpdateEvent` 的字段（`dist/core/extensions/types.d.ts:591-600`），而 `AssistantMessageEvent` 的 `thinking_start`、`thinking_delta`、`thinking_end` 携带 `contentIndex` 和 `partial`（`node_modules/@earendil-works/pi-ai/dist/types.d.ts:410-463`）。

因此本示例的接入点是：

```mermaid
flowchart TD
    Requirement[需求：观察 assistant thinking 流] --> Event[message_update]
    Event --> Start[thinking_start：为 contentIndex 建立条目]
    Event --> Delta[thinking_delta：从 partial 读取当前全文]
    Event --> End[thinking_end：标记完成并读取权威全文]
    Start --> Entry[pi.appendEntry：持久化一条 custom entry]
    Delta --> Live[共享 Map：更新同一条目状态]
    End --> Live
    Entry --> Renderer[pi.registerEntryRenderer：TUI 框]
    Live --> Renderer
    Command[/thinking-notes status on off] --> Config[读取全局后项目配置]
```

### 1.2 为什么用 `appendEntry`，不用 `sendMessage`

展示内容不应污染模型上下文，所以选择 `pi.appendEntry` + `pi.registerEntryRenderer`：

- 官方文档 `docs/extensions.md` 的 **pi.appendEntry(customType, data?)** 小节明确：custom entry 持久化，但不参与 LLM context；配合 `registerEntryRenderer` 后可以显示在交互式聊天记录中；
- 官方文档 `docs/extensions.md` 的 **pi.sendMessage(message, options?)** 小节明确：custom message 会参与 LLM context；
- 全局声明中 `registerEntryRenderer`、`appendEntry` 的契约见 `dist/core/extensions/types.d.ts:964-985`。

展示 API、上下文投影、compaction 边界的完整对照见 `./pi-extension-api.md` 和 `./pi-extension-events.md`，本文只说明本示例的选择，不复制它们的参考表。

`thinking-notes.ts` 的核心逻辑是：首次看到某个 `(本次 assistant stream, contentIndex)` 时调用一次 `appendEntry`；之后只更新闭包里的 `Map`。renderer 工厂返回的组件每次 `render()` 都从这个可变状态读取统计。这样不会把第一次 delta 的快照冻结在组件里。

Unverified 边界：Pi 没有公开的“更新某条 custom entry”API；`appendEntry` 和 `sendMessage` 都返回 `void`，没有 entry id 或 update/anchor 参数（`dist/core/extensions/types.d.ts:970-985`）。所以本示例保证**当前运行中的同一框实时刷新**，而不是假装可以改写已经写入 JSONL 的历史行。

## 2. 项目布局：先做单文件，再决定是否发布 package

### 2.1 单文件扩展

从零试验时，一个默认导出工厂函数就够了：

```typescript
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function myExtension(pi: ExtensionAPI): void {
	pi.registerCommand("hello", {
		description: "Say hello",
		handler: async (_args, ctx) => {
			ctx.ui.notify("hello", "info");
		},
	});
}
```

官方文档 `docs/extensions.md` 的 **Quick Start**、**Writing an Extension** 小节给出同样的工厂函数、事件、命令和工具注册方式。TypeScript 不需要先编译：Pi 通过 jiti 加载扩展，见 **Writing an Extension**。

### 2.2 可发布 Pi package

要发布时，把扩展放在 package 目录中，并在 `package.json` 明确资源白名单：

```json
{
	"name": "my-pi-extension",
	"version": "1.0.0",
	"keywords": ["pi-package"],
	"files": ["extensions", "README.md"],
	"peerDependencies": {
		"@earendil-works/pi-coding-agent": "*",
		"@earendil-works/pi-ai": "*",
		"@earendil-works/pi-tui": "*"
	},
	"pi": {
		"extensions": ["./extensions"]
	}
}
```

官方文档 `docs/packages.md` 的 **Creating a Pi Package**、**Package Structure**、**Dependencies** 小节规定：

- `pi.extensions` 的路径相对 package 根目录，数组可以使用 glob；
- `files` 决定 npm tarball 实际包含什么；
- Pi 核心包由 Pi 提供，扩展只应在 `peerDependencies` 中声明 `*`，不能把它们打进自己的 tarball；
- 其他运行时依赖应放 `dependencies`，需要随 tarball 带上时再使用 `bundledDependencies`。

### 2.3 本仓库的真实形状

用命令直接查看本仓库当前清单：

```bash
$ node -e 'const p=require("./package.json"); console.log(JSON.stringify({files:p.files,pi:p.pi,peerDependencies:p.peerDependencies},null,2))'
{
  "files": [
    "extensions",
    "README.md"
  ],
  "pi": {
    "extensions": [
      "./extensions/thinking-translator.ts"
    ]
  },
  "peerDependencies": {
    "@earendil-works/pi-ai": "*",
    "@earendil-works/pi-coding-agent": "*"
  }
}
```

这就是发布 package 时应参照的真实结构：现有 `extensions/thinking-translator.ts` 是仓库根下的单一扩展，纯逻辑测试通过 `__testing` 导出对象暴露（仓库 `extensions/thinking-translator.ts:466-479`）。本次示例放在 `docs/examples/` 是文档示例，不会因为放在那里就自动成为当前 package 的发布资源。

## 3. 本地加载与热重载

官方文档 `docs/extensions.md` 开头的 **Extensions** 小节已经给出关键规则：

- `pi -e <path>` / `--extension <path>`：快速试验，显式加载文件；
- `~/.pi/agent/extensions/*.ts`：全局自动发现；
- `.pi/extensions/*.ts`：项目自动发现；
- 只有自动发现位置的扩展适合用 `/reload` 热重载；
- 项目资源第一次加载前可能需要 project trust。

Pi 自身的帮助输出也确认 `-e` 可以重复，且 `--no-extensions` 不会禁用显式 `-e`：

```bash
$ pi --help | sed -n '30,58p'
  --extension, -e <path>         Load an extension file (can be used multiple times)
  --no-extensions, -ne           Disable extension discovery (explicit -e paths still work)
  --skill <path>                 Load a skill file or directory (can be used multiple times)
  --no-skills, -ns               Disable skills discovery and loading
  --no-context-files, -nc        Disable AGENTS.md and CLAUDE.md discovery and loading
  --offline                      Disable startup network operations (same as PI_OFFLINE=1)
```

本示例的快速运行入口就是：

```bash
pi --no-extensions --no-context-files --no-skills \
  -e docs/examples/faux-harness/faux-harness.ts \
  -e docs/examples/thinking-notes/thinking-notes.ts
```

实际运行时启动输出包含：

```text
 pi v0.85.1
[Extensions]
  faux-harness.ts, thinking-notes.ts
```

要开发 `/reload` 工作流，把正在编辑的扩展复制或链接到 `~/.pi/agent/extensions/` 或项目 `.pi/extensions/`，再启动普通 `pi`；`-e` 适合一次性实验，不把它当成热重载入口。官方文档 `docs/extensions.md` 的 **ctx.reload()** 小节还说明，reload 会先发出 `session_shutdown`，再以 `reason: "reload"` 发出 `session_start`；旧的内存状态不会自动保留。

## 4. 开发循环：类型检查和纯逻辑单测

### 4.1 先按仓库约定做类型检查

仓库 `package.json:26-29` 的既有写法是：

```bash
./node_modules/.bin/tsc --noEmit --skipLibCheck \
  --moduleResolution node --module esnext --target es2022 --types node \
  extensions/thinking-translator.ts
```

这条命令针对仓库的现有扩展。示例目标是 Pi `0.85.1`，而本地依赖是 `0.75.3`，所以直接把示例追加到同一条命令会真实失败：

```text
$ ./node_modules/.bin/tsc --noEmit --skipLibCheck --allowSyntheticDefaultImports --allowImportingTsExtensions --moduleResolution node --module esnext --target es2022 --types node docs/examples/thinking-notes/thinking-notes.ts docs/examples/thinking-notes/thinking-notes.test.ts docs/examples/faux-harness/faux-harness.ts
 docs/examples/faux-harness/faux-harness.ts(10,8): error TS2307: Cannot find module '@earendil-works/pi-ai/providers/faux' or its corresponding type declarations.
 docs/examples/faux-harness/faux-harness.ts(94,5): error TS2554: Expected 2 arguments, but got 1.
 docs/examples/thinking-notes/thinking-notes.ts(188,5): error TS2339: Property 'registerEntryRenderer' does not exist on type 'ExtensionAPI'.
```

这是版本证据，不是示例代码的成功输出：旧声明没有 `registerEntryRenderer`，旧 provider 注册签名也不同。针对本示例，使用一次性的临时 `tsconfig` 把三个 Pi 包的类型明确指向全局 `0.85.1`，然后马上删除它：

```bash
set -e
cfg="/tmp/pi-thinking-translator-example-tsconfig.json"
trap 'rm -f "$cfg"' EXIT
cat > "$cfg" <<'JSON'
{
  "compilerOptions": {
    "noEmit": true,
    "skipLibCheck": true,
    "allowSyntheticDefaultImports": true,
    "allowImportingTsExtensions": true,
    "moduleResolution": "node",
    "module": "esnext",
    "target": "es2022",
    "types": ["node"],
    "typeRoots": ["/Users/mouriya/Ext/code/pi-thinking-translator/node_modules/@types"],
    "baseUrl": "/Users/mouriya/Ext/code/pi-thinking-translator",
    "paths": {
      "@earendil-works/pi-coding-agent": ["/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/index.d.ts"],
      "@earendil-works/pi-ai": ["/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/index.d.ts"],
      "@earendil-works/pi-ai/providers/faux": ["/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-ai/dist/providers/faux.d.ts"],
      "@earendil-works/pi-tui": ["/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/index.d.ts"]
    }
  },
  "files": [
    "/Users/mouriya/Ext/code/pi-thinking-translator/docs/examples/thinking-notes/thinking-notes.ts",
    "/Users/mouriya/Ext/code/pi-thinking-translator/docs/examples/thinking-notes/thinking-notes.test.ts",
    "/Users/mouriya/Ext/code/pi-thinking-translator/docs/examples/faux-harness/faux-harness.ts"
  ]
}
JSON
./node_modules/.bin/tsc --project "$cfg"
echo 'TypeScript: 0 errors'
```

本次实际输出：

```text
TypeScript: 0 errors
```

### 4.2 只给值得保留的纯逻辑写单测

`thinking-notes.test.ts` 只测试三类不需要 Pi runtime 的逻辑：

- `splitThinkingBlocks` 是否保留 Pi 的 `contentIndex` 并忽略普通 text block；
- `getThinkingStats` 的 Unicode 字符、段落和行数边界；
- `mergeConfig` 以及全局路径先于项目路径的确定性规则。

运行命令和本次输出：

```bash
$ node --test docs/examples/thinking-notes/thinking-notes.test.ts
✔ splitThinkingBlocks preserves content indexes and ignores text blocks (0.98375ms)
✔ getThinkingStats counts paragraphs, lines, and Unicode characters (0.147167ms)
✔ mergeConfig applies a project enabled override without dropping the base (0.071375ms)
✔ getConfigPaths resolves global before project configuration (0.094209ms)
ℹ tests 4
ℹ suites 0
ℹ pass 4
ℹ fail 0
ℹ cancelled 0
```

输出中的耗时会随机器变化；四个测试和 `pass 4` 是本次实际结果。

### 4.3 为什么这两步仍然不算验证完成

TypeScript 只能证明声明和语法能通过，单测只能证明纯函数。它们不会证明：

- Pi 是否真的加载了扩展工厂；
- `message_update` 是否在真实 provider 流中到达；
- TUI 是否给每个 entry 建立了框并且重绘了同一框；
- `appendEntry` 是否落入真实 session JSONL；
- 下一次 provider 调用的 `context.messages` 是否排除了 custom entry。

必须继续做下一节的真实 Pi 运行时验证。

## 5. 运行时验证：faux harness + 隔离 Pi + PTY

### 5.1 faux harness 为什么这样写

全局 `0.85.1` 的 `node_modules/@earendil-works/pi-ai/dist/providers/faux.d.ts:3-101` 和实现 `node_modules/@earendil-works/pi-ai/dist/providers/faux.js:214-295,296-380` 给出了实际契约：

- `fauxProvider(options)` 返回带 `.provider`、`.models`、`.setResponses()` 的 handle；
- `RegisterFauxProviderOptions` 支持 `provider`、`models`、`tokenSize`、`tokensPerSecond`；
- `fauxThinking()`、`fauxText()` 构造内容块；
- 流实现会发出 `thinking_start`、多个 `thinking_delta`、`thinking_end`，再发普通 text block。

`faux-harness.ts` 用 `pi.registerProvider(faux.provider)` 注册名为 `thinking-notes-faux` 的 provider，并把 `tokenSize` 固定为 `{ min: 1, max: 1 }`，因此每个 thinking block 会按固定的约四字符片段增长。它排入两份相同响应，第二轮 prompt 可以用于观察下一次 `context`。

#### 真实失败与修法

最初直接写静态运行时 import：

```typescript
import { fauxProvider } from "@earendil-works/pi-ai/providers/faux";
```

在本仓库用 Pi 启动时真实报错：

```text
Error: Failed to load extension "/Users/mouriya/Ext/code/pi-thinking-translator/docs/examples/faux-harness/faux-harness.ts": Failed to load extension: Package subpath './providers/faux' is not defined by "exports" in /Users/mouriya/Ext/code/pi-thinking-translator/node_modules/@earendil-works/pi-ai/package.json
Error: Unknown provider "thinking-notes-faux". Use --list-models to see available providers/models.
```

根因是当前仓库的本地 `0.75.3` package exports 和全局 `0.85.1` 运行时不一致；不是 faux 参数猜错。随后将函数声明改为**类型导入**，并在 `faux-harness.ts` 中根据 `realpathSync(process.argv[1])` 找到正在运行的 Pi 安装，再动态载入该安装里的 `dist/providers/faux.js`。这样运行时使用的是已验证的 `0.85.1` 实现，参数仍直接来自公开 d.ts。Pi loader 的内置别名行为可由 `dist/core/extensions/loader.js:85-112,416-427` 观察到。

如果把一个直接静态导入该子路径的扩展随意放进 `/tmp`，扩展目录上级没有可解析的 `@earendil-works/pi-ai`，会报 `Cannot find module '@earendil-works/pi-ai/providers/faux'`。这就是“扩展文件所在目录必须能解析依赖”的边界；本示例放在仓库内且针对全局运行时显式处理了版本冲突，不把 `/tmp` 当成可直接运行的扩展目录。

### 5.2 隔离环境和完整启动命令

不要把验证写进真实用户的 `~/.pi` 会话。实际使用以下隔离目录和变量：

- `HOME`：隔离全局配置路径；
- `PI_CODING_AGENT_DIR`：隔离 Pi agent 目录和 session；
- `PI_OFFLINE=1`：禁止启动时网络操作；
- `PI_CONTEXT_CAPTURE`：仅供临时 context 捕获扩展写入 NDJSON。

先创建隔离目录：

```bash
$ rm -rf /tmp/pi-thinking-notes-smoke-home /tmp/pi-thinking-notes-smoke-agent /tmp/pi-thinking-notes-context.jsonl
$ mkdir -p /tmp/pi-thinking-notes-smoke-home /tmp/pi-thinking-notes-smoke-agent
```

实际的 PTY `hub start` 参数如下（`hub` 是本 harness 的进程控制工具，不是 shell 子命令）：

```text
name: thinking-notes-smoke
application: env
args:
  HOME=/tmp/pi-thinking-notes-smoke-home
  PI_CODING_AGENT_DIR=/tmp/pi-thinking-notes-smoke-agent
  PI_CONTEXT_CAPTURE=/tmp/pi-thinking-notes-context.jsonl
  PI_OFFLINE=1
  pi
  --provider thinking-notes-faux
  --model thinking-notes-demo
  --thinking low
  --no-context-files
  --no-extensions
  --no-skills
  --approve
  -e docs/examples/faux-harness/faux-harness.ts
  -e docs/examples/thinking-notes/thinking-notes.ts
  -e /tmp/pi-thinking-notes-context-capture.ts
cwd: /Users/mouriya/Ext/code/pi-thinking-translator
```

对应的完整 shell 命令（不用 hub 时也可作为启动记录）是：

```bash
HOME=/tmp/pi-thinking-notes-smoke-home \
PI_CODING_AGENT_DIR=/tmp/pi-thinking-notes-smoke-agent \
PI_CONTEXT_CAPTURE=/tmp/pi-thinking-notes-context.jsonl \
PI_OFFLINE=1 \
pi --provider thinking-notes-faux --model thinking-notes-demo --thinking low \
  --no-context-files --no-extensions --no-skills --approve \
  -e docs/examples/faux-harness/faux-harness.ts \
  -e docs/examples/thinking-notes/thinking-notes.ts \
  -e /tmp/pi-thinking-notes-context-capture.ts
```

本次 `hub start` 的真实结果：

```text
Started thinking-notes-smoke: ready pid=27114 uptime=374ms restarts=0
Ready log matched: pi v0.85.1
```

启动界面也实际显示：

```text
 pi v0.85.1
[Extensions]
  faux-harness.ts, pi-thinking-notes-context-capture.ts, thinking-notes.ts
```

`--approve` 只用于本次隔离运行，避免 project trust 对 PTY 驱动造成额外交互；它不改变仓库文件。

### 5.3 用 hub 驱动命令和 prompt

按顺序使用 `hub send`、`hub logs`、`hub wait`：

```text
hub send
  name: thinking-notes-smoke
  text: /thinking-notes status
  enter: true
```

真实输出：

```text
thinking-notes: on；global=missing, project=missing
```

接着发送第一轮 prompt：

```text
hub send
  name: thinking-notes-smoke
  text: 演示 thinking notes 第一轮
  enter: true
```

需要等待流结束时，使用：

```text
hub wait
  name: thinking-notes-smoke
  for: exit
  timeout: 1
```

这是交互式进程，不应真的退出；本次真实返回：

```text
thinking-notes-smoke: ready pid=27114 uptime=21.8s restarts=0
Wait timed out.
```

因此再用：

```text
hub logs
  name: thinking-notes-smoke
  follow: true
  cursor: 4622
  lines: 260
  timeout: 20
```

### 5.4 真实 UI 观察：两个 block，两个框，同一框增长

本次 `hub logs` 捕获到的关键片段如下；中间的 `Working` 和终端重绘行已省略，但每一行都来自同一个 PTY 输出：

```text
思考块 1 · 流式
段落 0  字符 0  行 0

段落 1  字符 4  行 1

段落 1  字符 8  行 1

段落 2  字符 16  行 3

思考块 1 · 完成
段落 2  字符 20  行 3

思考块 2 · 流式
段落 0  字符 0  行 0

段落 1  字符 4  行 1

段落 1  字符 8  行 1

段落 2  字符 16  行 3

思考块 2 · 完成
段落 2  字符 20  行 3
```

这是本示例验收的关键观察：

- 两个 thinking block 分别获得 `思考块 1` 和 `思考块 2`，不是把两个 block 合并成一个框；
- 每个框都从 `字符 0` 增长到 `字符 20`，说明同一框在重复 render 中读取了共享状态；
- 普通文本 `这是两个 thinking block 之间的普通回答。` 位于两个框之间，说明条目按流中的 append 时刻进入聊天记录；
- 第一块在当前 streaming assistant 组件之前出现，后续块也在当前流中进入 transcript，而不是固定在 editor 上方的 widget。

位置规则的 dist 证据是 `dist/modes/interactive/interactive-mode.js:2590-2594,2895-2913`：流式时 `appendEntry` 插入 streaming assistant 组件之前；流结束后 append 才会落到聊天流末尾。每个 entry renderer 工厂只建立一次组件，但组件的 `render()` 会重复调用，证据为 `dist/modes/interactive/components/custom-entry.js:12-50`。`message_update` 末尾无条件请求重绘，证据为 `dist/modes/interactive/interactive-mode.js:2623-2646`；这也是示例没有用 status hack 触发每个 delta 的原因。

### 5.5 JSONL 落盘与 context 隔离

临时捕获扩展使用的是以下逻辑；它只写 role 和 customType，不改 messages：

```typescript
import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

export default function contextCapture(pi: ExtensionAPI): void {
	pi.on("context", (event, ctx) => {
		const path = process.env.PI_CONTEXT_CAPTURE;
		if (!path) return;
		const messages = event.messages.map((message) =>
			message.role === "custom"
				? { role: message.role, customType: message.customType }
				: { role: message.role },
		);
		appendFileSync(path, `${JSON.stringify({ session: ctx.sessionManager.getSessionFile(), messages })}\n`, "utf8");
	});
}
```

第一轮 response 完成后，再用 `hub send` 发第二轮：

```text
hub send
  name: thinking-notes-smoke
  text: 演示 thinking notes 第二轮
  enter: true
```

本次 context 捕获文件的真实内容：

```json
{"session":"/tmp/pi-thinking-notes-smoke-agent/sessions/--Users-mouriya-Ext-code-pi-thinking-translator--/2026-09-13T16-56-32-274Z_01a09bb2-f712-706d-8f32-375a52745691.jsonl","messages":[{"role":"user"}]}
{"session":"/tmp/pi-thinking-notes-smoke-agent/sessions/--Users-mouriya-Ext-code-pi-thinking-translator--/2026-09-13T16-56-32-274Z_01a09bb2-f712-706d-8f32-375a52745691.jsonl","messages":[{"role":"user"},{"role":"assistant"},{"role":"user"}]}
```

第二次 `context` 已经发生在第一轮四个 custom entry 落盘之后，但 messages 中仍没有 `custom`。这是真实的“下一轮发给模型的 messages 没有污染”证据，不是从代码里“没有调用 sendMessage”推断出来的。

对应的 session JSONL 真实片段：

```text
5: {"type":"custom","customType":"thinking-notes","data":{"key":"4a97a4fe-e20d-422d-92d8-9088964e30b3:1:0","index":0,"ordinal":1,"text":"第一块先观察输入。\n\n第一块再计算统计。","complete":true,"paragraphs":2,"characters":20,"lines":3},...}
6: {"type":"custom","customType":"thinking-notes","data":{"key":"4a97a4fe-e20d-422d-92d8-9088964e30b3:1:2","index":2,"ordinal":2,"text":"第二块继续核对边界。\n\n第二块完成检查。","complete":true,"paragraphs":2,"characters":20,"lines":3},...}
7: {"type":"message","message":{"role":"assistant",...}}
9: {"type":"custom","customType":"thinking-notes","data":{"key":"4a97a4fe-e20d-422d-92d8-9088964e30b3:2:0","index":0,"ordinal":1,"text":"","complete":false,"paragraphs":0,"characters":0,"lines":0},...}
10:{"type":"custom","customType":"thinking-notes","data":{"key":"4a97a4fe-e20d-422d-92d8-9088964e30b3:2:2","index":2,"ordinal":2,"text":"","complete":false,"paragraphs":0,"characters":0,"lines":0},...}
11:{"type":"message","message":{"role":"assistant",...}}
```

这同时验证两条边界：

- `type: "custom"`、`customType: "thinking-notes"` 确实写入 session JSONL；
- 没有 `type: "custom_message"` 的 thinking-notes 记录，且第二轮 provider context 没有 custom role。

本次计数命令的真实输出：

```bash
$ python3 - <<'PY'
import json, glob
for path in glob.glob('/tmp/pi-thinking-notes-smoke-agent/sessions/**/*.jsonl', recursive=True):
    rows=[json.loads(line) for line in open(path)]
    print(f'custom thinking-notes={sum(r.get("type")=="custom" and r.get("customType")=="thinking-notes" for r in rows)}')
    print(f'custom_message thinking-notes={sum(r.get("type")=="custom_message" and r.get("customType")=="thinking-notes" for r in rows)}')
PY
custom thinking-notes=4
custom_message thinking-notes=0
```

官方文档 `docs/session-format.md` 的 **CustomEntry**、**CustomMessageEntry** 小节给出这两种 JSONL entry 的区别；context/compaction 的完整投影规则见 `./pi-extension-events.md`。

注意一个有意保留的 API 边界：第二轮的 custom entry 在 append 时先写入了空快照。当前运行中的框仍然更新到最终 `字符 20`，但 `appendEntry` 没有 update API，不能把已经写出的旧 JSONL 行当成可变数据库记录。全局首次 assistant 尚未 flush 时，内存对象会随运行更新并在本次观察中写出最终快照；这不是可依赖的历史更新契约。

### 5.6 清理验证环境

停止 PTY 后清理所有临时文件：

```bash
hub stop
  name: thinking-notes-smoke

$ rm -rf \
  /tmp/pi-thinking-notes-smoke-home \
  /tmp/pi-thinking-notes-smoke-agent \
  /tmp/pi-thinking-notes-context.jsonl \
  /tmp/pi-thinking-notes-context-capture.ts \
  /tmp/pi-thinking-translator-example-tsconfig.json
```

本次验证完成后，隔离 HOME、agent/session 目录、context NDJSON、临时 context 扩展和临时 TypeScript 配置均已清理；仓库没有写入运行日志或临时文件。

## 6. 常见坑与调试方式

### 6.1 扩展报错如何显现

加载失败会在 Pi 启动输出中显示扩展路径、原始错误和后续连带错误。上面 faux 静态导入的真实错误就是一个完整例子：

```text
Error: Failed to load extension ".../docs/examples/faux-harness/faux-harness.ts": Failed to load extension: Package subpath './providers/faux' is not defined by "exports" ...
Error: Unknown provider "thinking-notes-faux" ...
```

不要只修第二行的 `Unknown provider`；第一行才是扩展没有加载的根因。官方文档 `docs/extensions.md` 的 **Error Handling** 小节说明，扩展异常会被宿主收集并显示；RPC 场景也会以 `extension_error` 事件报告，见 `docs/rpc.md` 的 **extension_error** 小节。

### 6.2 TUI 下不要把 `console.log` 当日志方案

TUI 会重绘终端，普通 stdout 不适合作为可读日志。稳定做法是写追加式文件或 NDJSON：

```typescript
import { appendFileSync } from "node:fs";

function debug(path: string, event: unknown): void {
	appendFileSync(path, `${JSON.stringify({ at: Date.now(), event })}\n`, "utf8");
}
```

上节的 `PI_CONTEXT_CAPTURE` 夹具就是实际使用的 NDJSON 模式。需要 Pi 自身诊断时，官方文档 `docs/development.md` 的 **Debug Command** 小节说明 `/debug` 会写 `~/.pi/agent/pi-debug.log`，包括带 ANSI 的 TUI 行和最近发送给 LLM 的 messages；在隔离验证中应把 `HOME` 和 `PI_CODING_AGENT_DIR` 一起隔离后再查看该文件。

### 6.3 模块级状态和 `/reload`

`thinking-notes` 的 `liveEntries`、stream nonce、`sessionEnabled` 都在 extension factory 闭包中。它们的生命周期是当前 extension runtime，而不是整个 Pi 进程：

- `/reload` 会先触发 `session_shutdown`，再建立新 runtime 并触发 `session_start`（官方文档 `docs/extensions.md` 的 **ctx.reload()**、**session_start**、**session_shutdown** 小节）；
- 新 runtime 重新读全局和项目配置；
- 旧的 live `Map` 不会自动迁移；
- 已写入的 custom entry 仍可以通过 `entry.data` 显示，但没有实时 Map 时只能显示持久化快照；
- `on/off` 是当前会话覆盖，不写 JSON；reload 后会重新以 JSON 配置为准。

因此 renderer 必须在 `render()` 中读取当前共享状态，而不是在 renderer 工厂创建时复制一份 stats。这个结论有运行时证据：本次日志中同一框从 `字符 0` 变到 `字符 20`，且同一 entry 只创建一次。

## 7. 发布前检查与三种安装路径

### 7.1 先看 tarball 里到底有什么

官方文档 `docs/packages.md` 的 **Package Filtering** 和 **Creating a Pi Package** 小节强调：`files` 白名单和 `pi.extensions` 共同决定实际发布内容。真实运行命令：

```bash
$ pnpm pack --dry-run
package: pi-thinking-translator@0.1.8
Tarball Contents
extensions/.gitkeep
extensions/thinking-translator.ts
package.json
README.md
Tarball Details
pi-thinking-translator-0.1.8.tgz
```

注意当前输出**没有** `docs/`，因为现有 `package.json:31-38` 的 `files` 只包含 `extensions` 和 `README.md`。本次 docs 示例是开发指南和验证材料，不应在没有明确发布设计的情况下偷偷改变 package manifest。

### 7.2 npm、git、本地路径分别何时用

官方文档 `docs/packages.md` 的 **Install and Manage**、**Package Sources**、**Local Paths** 小节给出的三条路径是：

```bash
# npm：版本化发布包，适合稳定分发
pi install npm:my-pi-extension@1.0.0

# git：标签或 commit 固定的源码包，适合内部/预发布
pi install git:github.com/user/my-pi-extension@v1

# 本地：不复制文件，适合本地开发和快速迭代
pi -e /absolute/path/to/my-pi-extension/extensions/thinking-notes.ts
```

本机 `pi install --help` 的实际输出确认了这些 source 形式和 `-l` 项目安装开关：

```text
Usage:
  pi install <source> [-l] [--approve|--no-approve]

Options:
  -l, --local       Install project-locally (.pi/settings.json)
  -a, --approve     Trust project-local files for this command
  -na, --no-approve Ignore project-local files for this command

Examples:
  pi install npm:@foo/bar
  pi install git:github.com/user/repo
  pi install git:git@github.com:user/repo
  pi install https://github.com/user/repo
  pi install ssh://git@github.com/user/repo
  pi install ./local/path
```

适用边界：

- `npm:`：发布版本和依赖由 package registry 管理；版本化 spec 会被 Pi 更新逻辑固定；
- `git:`：源码和 tag/commit 可审阅、可固定；不需要把开发 checkout 复制进用户目录；
- `pi -e <本地>`：只对当前运行加载，官方文档明确把它定位为 quick test，不会自动变成 `/reload` 的发现来源；
- `pi install -l`：把安装记录写到项目 `.pi/settings.json`；不带 `-l` 则写全局 `~/.pi/agent/settings.json`（官方文档 `docs/packages.md` 的 **Install and Manage** 小节）。

第三方 Pi package 具有完整系统权限；安装前必须审阅源码。官方文档 `docs/packages.md` 开头的安全提示明确说明 extensions 会执行任意代码。

## 8. 交付清单

- [ ] 先确认实际运行时版本：`pi --version`，并核对仓库本地依赖是否落后。
- [ ] 需求已经映射到合适事件：本例使用 `message_update` 的 `thinking_start/delta/end`。
- [ ] TUI-only durable 内容使用 `appendEntry` + `registerEntryRenderer`，没有误用 `sendMessage`。
- [ ] renderer 工厂只建立一个组件实例；组件 `render()` 每次读取共享 live state。
- [ ] entry key 包含一次 stream/session 和 `contentIndex`，不会让相邻请求的同索引 block 碰撞。
- [ ] 全局 `~/.pi/agent/thinking-notes.json` 先读，项目 `.pi/thinking-notes.json` 后读并覆盖。
- [ ] `/thinking-notes status` 可读；`on/off` 的会话覆盖行为已说明且不偷偷写配置。
- [ ] 纯逻辑已用 `node --test` 验证；测试没有为了凑数覆盖 Pi wiring。
- [ ] 类型检查明确指向目标 Pi `0.85.1`，没有把旧 `0.75.3` 声明当成成功证据。
- [ ] 用 faux provider 在无凭据、`PI_OFFLINE=1`、隔离 `HOME` 和 `PI_CODING_AGENT_DIR` 的真实 Pi PTY 中跑过。
- [ ] 观察到每个 thinking block 一个框、同一框统计随 delta 变化、框在 streaming transcript 中的位置符合 append 时序。
- [ ] session JSONL 中确认 `type: "custom"` 已落盘，并确认没有 `custom_message` 替代品。
- [ ] 用 `pi.on("context")` 捕获下一轮真实 messages，确认没有 custom role/context 污染。
- [ ] 调试输出写文件/NDJSON；没有依赖 TUI 中不可读的 `console.log`。
- [ ] `pnpm pack --dry-run` 已审查 tarball 内容；`files` 没有漏掉真正要发布的资源。
- [ ] 发布前选择 npm、git 或本地 `-e` 路径，并审阅第三方 package 源码。
- [ ] 停止 PTY，删除隔离 HOME、agent/session、context capture 和临时配置；仓库只留下预期的 `docs/` 文件。
