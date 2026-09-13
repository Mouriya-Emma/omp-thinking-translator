# 文档索引

面向本仓库维护者的 Pi 扩展开发资料。全部结论以本机全局安装的 Pi **0.85.1**
（`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent`）为准，并附 `path:line` 证据。
注意仓库 `node_modules` 是 0.75.3，比运行时旧，不要用它推断可用 API。

| 文档 | 回答什么问题 |
|---|---|
| [`pi-extension-api.md`](./pi-extension-api.md) | **能做什么。** `ExtensionAPI` 全部成员（36 个事件 overload + 24 个方法）、`ExtensionContext` / `ExtensionCommandContext`、`ctx.ui` 能力矩阵、工具定义、三种渲染 hook、provider 注册、可用 imports，以及 API 明确做不到的事。 |
| [`pi-extension-events.md`](./pi-extension-events.md) | **什么时候能介入，介入后会不会污染模型输入。** 一轮对话的真实事件时序、每个事件的返回值语义、`AssistantMessageEvent` 12 个 variant、session entry 的落盘/context/compaction 边界表、多扩展合并与错误隔离、生命周期与 `/reload`、interactive/print/RPC 差异。 |
| [`extension-development-guide.md`](./extension-development-guide.md) | **怎么从零做完一个扩展。** 选接入点 → 项目布局 → 本地加载 → 类型检查与单测 → 用 faux provider 在真实 Pi 里做运行时验证 → 调试 → 发布，每步都有真实命令与真实输出，附交付清单。 |

## 可运行示例

| 路径 | 内容 |
|---|---|
| [`examples/thinking-notes/thinking-notes.ts`](./examples/thinking-notes/thinking-notes.ts) | 完整示例扩展：给每个 assistant thinking block 一个持久化 TUI 框，流式期间就地刷新统计，带 `/thinking-notes status\|on\|off` 和全局/项目两层配置。 |
| [`examples/thinking-notes/thinking-notes.test.ts`](./examples/thinking-notes/thinking-notes.test.ts) | 纯逻辑单测：`node --test docs/examples/thinking-notes/thinking-notes.test.ts` |
| [`examples/faux-harness/faux-harness.ts`](./examples/faux-harness/faux-harness.ts) | 可复用验证夹具：注册 faux provider，无需任何凭据即可产出真实的 `thinking_start/delta/end` 流事件。 |

两个扩展一起加载即可复现示例（隔离 `HOME` 与 `PI_CODING_AGENT_DIR`，避免碰到真实配置）：

```bash
HOME=/tmp/ptn-demo/home PI_CODING_AGENT_DIR=/tmp/ptn-demo/agent PI_OFFLINE=1 \
pi --provider thinking-notes-faux --model thinking-notes-demo --thinking low \
  --no-context-files --no-extensions --no-skills --approve \
  -e docs/examples/faux-harness/faux-harness.ts \
  -e docs/examples/thinking-notes/thinking-notes.ts
```

`docs/` 不进入 npm tarball：`package.json` 的 `files` 只包含 `extensions` 和 `README.md`。

## 官方资料位置

本机安装目录下还有上游原始资料，升版后应优先复核它们：

- 官方文档：`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/docs/`
  （`extensions.md`、`packages.md`、`sessions.md`、`session-format.md`、`compaction.md`、`tui.md`、`custom-provider.md`、`sdk.md`、`rpc.md`、`development.md`）
- 官方示例：`/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/`（70 个 `.ts`）
- 类型声明：同目录 `dist/core/extensions/types.d.ts`
