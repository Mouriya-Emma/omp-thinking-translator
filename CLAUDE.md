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

# 每次要安装的改动都必须动 `version`

`package.json` 的 `version` 在这里不是 npm 发布元数据（本包 `private`，不发布），而是**已安装副本的身份**：
`omp plugin list` 和 `~/.omp/plugins/omp-plugins.lock.json` 的 `version` 取自它
（`manager.ts:613,625`），`omp plugin upgrade` 的更新判定是
`Bun.semver.order(catalogVersion, installed.version) > 0`（`marketplace/manager.ts:665`）。

版本不变的后果：升级检查永远报"已是最新"，改动只能靠整包 `plugin install` 重新 pin git ref 才会落地，
而"装上的到底是哪一版"只能去 grep 安装目录的源码——用户和我都无法从插件状态分辨。

规则：任何会被安装的提交（扩展代码、依赖、行为或文案）在提交前先改 `version`，1.0 前按
行为可见变化取 minor、纯修复取 patch；提交后 `omp plugin install` 并用 `omp plugin list`
核对显示的是新版本号。
