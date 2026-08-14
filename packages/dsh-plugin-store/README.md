# dsh-app-store — DeepSeek Harness 的 App Store

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

1. **内置种子**（`src/catalog.ts` 的 `SEED`）——硬编码的已知插件清单，离线也能用；
2. **curated manifest**——一个你维护的 JSON（`{ plugins: [...] }`），通过配置 `manifestUrl` 指向（例如 GitHub raw）。**这是规模化后的正解**：更新目录只需改这个文件，无需重新发布插件；
3. **npm 搜索**——对配置的 `npmScopes`（默认 `@linxin666`）和 `npmSearchQueries`（默认 `dsh-plugin` / `deepseek-harness` / `dsh-web-ui`）做 registry 搜索，并**只收录 `package.json` 里声明了 `dsh` 字段（`dsh.bundle` 或 `dsh.client`）的包**——这个字段就是「这是 DSH 插件」的指纹。

想让自己插件被发现，三条路任选：把它加进某个 curated manifest；发布到 npm 并带上 `dsh` manifest 字段 + 相关关键词/scope；或直接 PR 进本仓库的种子清单。

## 为什么目录现在几乎全是 linxin666，怎么让其他人上架

当前目录全是 `@linxin666/*`，**不是限制，而是现状**：DSH 生态还很年轻（`0.1.0-rc.6`），npm 上已发布、且带 `dsh` 字段的第三方插件，目前能核实的就这一家。App Store 的目录里没有「只许某个人」的逻辑——它只是如实反映了「现在存在什么」。

要「破到所有人」，按从自动到人工排序，就这三条，代码里都已支持：

1. **npm 关键词搜索（自动发现，已有）**——任何人把插件发布到 npm、`package.json` 里带上 `dsh` 字段（`dsh.bundle` 或 `dsh.client`）、描述/关键词里含 `dsh-plugin` / `deepseek-harness` 等，就会被搜到。这是「检测」机制，但依赖对方遵守命名/关键词约定，所以有漏网。
2. **curated manifest / 本仓库的 `catalog.json`（上架，正解）**——根目录的 [`catalog.json`](../../catalog.json) 就是「registry index」。任何人 PR 一个条目进来，把 `manifestUrl` 指向它的 raw URL，所有人就能看到。这是「register」机制，不依赖对方猜关键词。
3. **先发布 App Store 本身**——把本仓库推到 GitHub、把 `dsh-app-store` 发到 npm，它才成为别人能装上、能看到的入口；有了入口 + 一个可 PR 的 `catalog.json`，「到这里 register」才成立。

一句话：**没有中心 registry 是 DSH 现在的现实，App Store 用「npm 关键词检测 + 可 PR 的 catalog.json」两条腿补上；先把 App Store 发出去，第二条腿才能开始接客。**

## 架构（双半区）

- **宿主半区**（`src/`，导出 `.`）：`CatalogService`（目录）+ `InstallerService`（pnpm + bundle reconcile）+ `makeRoutes`（loopback 路由）+ `appstoreSearchTool`。
- **浏览器半区**（`src/client/`，导出 `./client`）：侧边栏入口（DOM 注入 + MutationObserver 自愈）+ 中心列 React 目录面板。

安装 = 在 profile 目录跑 `pnpm add`，成功后把 `dsh.bundle` 声明的包 reconcile 进 `dsh.profile.bundles`（等价 `dsh plugin` 的行为）。

## 安全模型

- 所有 `/api/dsh-app-store/*` 路由**仅限 loopback**（同源校验），不会把「下载并执行第三方代码」的能力暴露给局域网。
- 安装前浏览器弹出 `confirm`，并展示来源仓库链接供核对。
- agent 只有只读的 `appstore_search`；安装/卸载必须人工点击。
- 安装 spec 白名单：裸包名 / 绝对 `file:` `link:` / `https://github.com/...git`，其余拒绝。

## 安装

```sh
# 开发调试：从本仓库 link
pnpm --filter dsh-app-store build
dsh plugin --profile web add link:$(pwd)/packages/dsh-app-store
# 然后重启 dsh web
```

发布后从 npm 装：
```sh
dsh plugin --profile web add dsh-app-store
```

装完**重启 `dsh web`**：侧边栏出现「App Store」入口；agent 提示词自动出现插件说明。

## 配置

| 配置 | 默认 | 说明 |
|---|---|---|
| `enabled` | `true` | 总开关 |
| `announceToAgent` | `true` | 是否向 agent 宣告本插件 |
| `profile` | `web` | 兜底 profile 名（模块上溯失败时用） |
| `manifestUrl` | 空 | curated manifest JSON URL |
| `enableNpmSearch` | `true` | 是否做 npm 实时发现 |
| `npmSearchQueries` | 见源码 | npm 关键词 |
| `npmScopes` | `['@linxin666']` | 枚举的 scope |

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
pnpm --filter dsh-app-store typecheck   # tsc --noEmit
pnpm --filter dsh-app-store build       # tsc 类型产物 + tsdown 双半区 bundle
```

## 已知限制

- **无中心 registry**：npm 搜索是启发式的（scope + 关键词 + `dsh` 字段指纹），会有漏网与噪声；长期应维护 curated manifest。
- **host 插件装完必须重启** `dsh web` 才生效（无进程内热加载）。
- **三面板协调不完美**：本面板与 task-board / ssh 通过 `dsh-panel-activate` 事件互斥，但后两者只认识彼此、不认识本面板，极端情况下切面板可能需多点击一次。
- **git 托管插件**安装时 pnpm 会拦 `prepare` 脚本，需按提示在 `pnpm-workspace.yaml` 加 `allowBuilds`（日志会透传该提示）。
- 目录的 npm 富化会发起多个 registry 请求（5 分钟缓存一次）。
