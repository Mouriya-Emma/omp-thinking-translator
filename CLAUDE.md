# 版本策略

`@oh-my-pi/*` 永远跟最新发布版，不问、不讨论、不保留旧版兼容。

宿主会自更新，扩展在运行时永远对着用户机器上的那一版；`devDependencies` 落后只会让类型检查和
`tests/thinking-translator.test.ts` 里那条引用宿主 `formatThinkingForDisplay` 的契约测试
对着一个不再运行的版本作证。

发现版本落后时直接执行，不必确认：

```bash
# 取 dist-tags.latest，三个包对齐同一版本
pnpm install
pnpm check   # 契约测试跑在新宿主源码上，这是升级的验证点
```

契约测试因此失败说明宿主改了展示改写规则，那就修扩展去适配新行为，不要把依赖钉回旧版。
