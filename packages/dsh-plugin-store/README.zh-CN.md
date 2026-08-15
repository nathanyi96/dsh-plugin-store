# dsh-plugin-store — DeepSeek Harness 的 Plugin Store

[English](README.md) · [中文](README.zh-CN.md)

在 Web GUI 里浏览、搜索、安装 / 卸载 DSH 插件，不用再跑 `dsh plugin add ...` 命令行。
宿主半区挂 `/api/dsh-app-store/*` loopback 路由 + pnpm 安装器；浏览器半区注入侧边栏「App Store」入口 + 中心列目录面板；另向 agent 暴露只读的 `appstore_search` 工具。

## 能力

| 能力 | 说明 |
|---|---|
| 目录浏览 | 合并三类来源：内置种子、可配置 curated manifest、npm registry 搜索 |
| 搜索 | 按插件名 / 描述 / tags 过滤 |
| 安装 / 卸载 | 宿主进程跑 `pnpm add/remove`，NDJSON 流式回传进度日志 |
| 已装状态 | 从 profile 的 `dependencies` 标注 `installedVersion` |
| agent 工具 | `appstore_search`（只读）；安装/卸载仅限 GUI 人工点击 |
| 重启提示 | host 插件安装后提示重启 `dsh web` 生效 |

## 怎么知道生态里有哪些插件（目录来源）

DSH **没有中心 registry**，所以本插件的目录由三层合并，从可靠到新鲜依次是：

1. **内置种子**（`src/catalog.ts` 的 `SEED`）——目前**为空**：本包不附带任何硬编码的插件数据，避免看起来像是"官方认证"或"从来源仓库直接拉取"的条目实际上是手写的。离线场景下目录会是空的，这是有意的取舍；
2. **curated manifest**——一个你维护的 JSON（`{ plugins: [...] }`），通过配置 `manifestUrl` 指向（例如 GitHub raw，比如本仓库的 [`catalog.json`](../../catalog.json)）。**这是规模化后的正解**：更新目录只需改这个文件，无需重新发布插件。**注意**：`manifestUrl` 默认未配置——要让 `catalog.json` 实际生效，必须由部署方在 profile 配置里显式指向它的 raw URL；
3. **npm 搜索**（默认启用）——三类查询：
   - free-text 查询（`npmSearchQueries`，默认 `dsh-plugin` / `deepseek-harness` / `dsh-web-ui` / `deepsafe` / `safety-eval`）——有噪声，按名称粗筛；
   - `keywords:` 自标签查询（`npmKeywordQueries`，默认 `deepseek-harness` / `dsh-plugin`）——对包的 `keywords[]` 精确匹配，高精度；
   - scope 枚举（`npmScopes`，默认 `@linxin666` / `@ai45lab`）——registry 搜索 API 的 `scope:` 限定符不可靠，改为直接搜裸 scope 名。

   所有候选最终都要过 `dsh` 字段（`dsh.bundle` 或 `dsh.client`）这道关——这个字段就是「这是 DSH 插件」的指纹。name / description / author / repository / homepage 全部从 npm registry 实时读取，不做任何人工加工。

想让自己插件被发现，三条路任选：把它加进某个 curated manifest；发布到 npm 并带上 `dsh` manifest 字段 + 相关关键词/scope（这条无需任何人审核，自动生效）；或直接 PR 进本仓库的种子清单（当前为空，等你来填）。

## 为什么目录曾经看着像只有一家，怎么让更多人上架

目录如实反映 npm registry 当前的真实内容。早期能自动发现的、带 `dsh` 字段的第三方插件确实集中在某一家（`@linxin666/*`），**不是限制，而是现状**：Store 里没有「只许某个人」的逻辑——它只是如实反映「现在存在什么」，且不做任何策展加工（没有自定义 logo、没有手写 highlights、没有把多个包打包成一个"套件"卡片——这些信息 npm 元数据里没有，硬编码等于编造）。随着更多作者带 `dsh` 字段 + 匹配关键词/scope 发布，插件会自动浮出。

要「破到所有人」，按从自动到人工排序，就这三条，代码里都已支持：

1. **npm 关键词/scope 搜索（自动发现，默认开启）**——任何人把插件发布到 npm、`package.json` 里带上 `dsh` 字段（`dsh.bundle` 或 `dsh.client`）、描述/关键词里含 `dsh-plugin` / `deepseek-harness` 等（或在被扫描的 scope 下），就会被搜到，展示信息全部来自 npm registry 真实数据。这是「检测」机制，但依赖对方遵守命名/关键词约定，所以有漏网。
2. **curated manifest / 本仓库的 `catalog.json`（上架，正解，但需要先接线）**——根目录的 [`catalog.json`](../../catalog.json) 是「registry index」的模板，目前 `plugins: []` 为空。任何人 PR 一个条目进来，**并且**有人把某个部署的 `manifestUrl` 配置指向它的 raw URL，PR 的条目才会真的显示出来——这两步都要做到，只 PR 不配置是不会生效的。
3. **先发布 Plugin Store 本身**——把本仓库推到 GitHub、把 `dsh-plugin-store` 发到 npm，它才成为别人能装上、能看到的入口。

一句话：**没有中心 registry 是 DSH 现在的现实，Plugin Store 用「npm 关键词/scope 检测（已生效）+ 可 PR 但需手动接线的 catalog.json」两条腿补上；目录里的每一条都直接来自 npm registry 的真实包数据，没有编造的展示信息。**

## 架构（双半区）

- **宿主半区**（`src/`，导出 `.`）：`CatalogService`（目录）+ `InstallerService`（pnpm + bundle reconcile）+ `makeRoutes`（loopback 路由）+ `appstoreSearchTool`。
- **浏览器半区**（`src/client/`，导出 `./client`）：侧边栏入口（DOM 注入 + MutationObserver 自愈）+ 中心列 React 目录面板。

安装 = 在 profile 目录跑 `pnpm add`，成功后把 `dsh.bundle` 声明的包 reconcile 进 `dsh.profile.bundles`（等价 `dsh plugin` 的行为）。

## 安全模型

- 所有 `/api/dsh-app-store/*` 路由**仅限 loopback**（同源校验），不会把「下载并执行第三方代码」的能力暴露给局域网。
- 安装前浏览器弹出 `confirm`，并展示来源仓库链接供核对。
- agent 只有只读的 `appstore_search`；安装/卸载必须人工点击。
- 安装 spec 白名单：裸包名 / 绝对 `file:` `link:` / `https://github.com/...git`，其余拒绝。
- 安装/更新解析出新 lockfile 条目后，Store 会把它们持久化进 `pnpm-workspace.yaml` 的 `minimumReleaseAgeExclude`，让信任在后续任意一次裸 `pnpm install` 里依然成立，而不是撞上 24h 供应链 gate。

## 安装

```sh
# 开发调试：从本仓库 link
pnpm --filter dsh-plugin-store build
dsh plugin --profile web add link:$(pwd)/packages/dsh-plugin-store
# 然后重启 dsh web
```

发布后从 npm 装：
```sh
dsh plugin --profile web add dsh-plugin-store
```

装完**重启 `dsh web`**：侧边栏出现「App Store」入口；agent 提示词自动出现插件说明。

## 配置

| 配置 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `announceToAgent` | `true` | 是否向 agent 宣告本插件 |
| `profile` | `web` | 兜底 profile 名（模块上溯失败时用） |
| `manifestUrl` | 空 | curated manifest JSON URL |
| `manifestUrls` | `[]` | 额外 manifest URL（federation 聚合） |
| `enableNpmSearch` | `true` | 是否做 npm 实时发现 |
| `npmSearchQueries` | 见源码 | free-text 查询 |
| `npmKeywordQueries` | 见源码 | `keywords:` 精确匹配查询 |
| `npmScopes` | `['@linxin666', '@ai45lab']` | 枚举的 scope |

## curated manifest 格式

```json
{
  "plugins": [
    {
      "name": "@scope/dsh-foo",
      "description": "...",
      "repository": "https://github.com/...",
      "tags": ["foo"],
      "author": "..."
    }
  ]
}
```

## 开发

```sh
pnpm --filter dsh-plugin-store typecheck   # tsc --noEmit
pnpm --filter dsh-plugin-store build       # tsc 类型产物 + tsdown 双半区 bundle
```

## 已知限制

- **无中心 registry**：npm 搜索是启发式的（scope + 关键词 + `dsh` 字段指纹），会有漏网与噪声；长期应维护 curated manifest。
- **host 插件装完必须重启** `dsh web` 才生效（无进程内热加载）。
- **三面板协调不完美**：本面板与 task-board / ssh 通过 `dsh-panel-activate` 事件互斥，但后两者只认识彼此、不认识本面板，极端情况下切面板可能需多点击一次。
- **git 托管插件**安装时 pnpm 会拦 `prepare` 脚本，需按提示在 `pnpm-workspace.yaml` 加 `allowBuilds`（日志会透传该提示）。
- 目录的 npm 富化会发起多个 registry 请求（5 分钟缓存一次）。
