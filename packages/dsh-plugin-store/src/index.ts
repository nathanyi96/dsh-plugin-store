/**
 * dsh-plugin-store — host half. Mounts the catalog service (seed + curated
 * manifest aggregation + npm discovery), the pnpm installer, the
 * /api/dsh-app-store route family (loopback-only), the appstore_search agent
 * tool, and a system-prompt announcement. The browser half (./client)
 * renders the sidebar entry and the center-column catalog panel.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { CatalogService } from './catalog.ts'
import { InstallerService } from './installer.ts'
import { makeRoutes } from './routes.ts'
import { appstoreSearchTool } from './tools.ts'

/** Stable cordis plugin name. */
export const name = 'app-store'

/** Services required before the store surfaces can mount. */
export const inject = ['webServer', 'tools', 'systemPrompt']

export interface Config {
  /** Master switch for the plugin. */
  enabled?: boolean
  /** When true (default), announce the store to the agent via system prompt. */
  announceToAgent?: boolean
  /** Preferred profile name (fallback when the module walk fails). */
  profile?: string
  /** Curated catalog manifest URL (JSON `{ plugins: [...] }`). */
  manifestUrl?: string
  /** Additional curated catalog manifest URLs to aggregate (federation). */
  manifestUrls?: string[]
  /** Whether to query the npm registry for live discovery. */
  enableNpmSearch?: boolean
  /** Keyword queries for npm discovery. */
  npmSearchQueries?: string[]
  /** Scopes to enumerate for npm discovery. */
  npmScopes?: string[]
}

/** Order of the announcement section within the tool-guidance band. */
const SECTION_ORDER = 160

export const APPSTORE_GUIDANCE = '本机已安装 dsh-plugin-store 插件（DeepSeek Harness 的 Plugin Store）：侧边栏「Plugin Store」入口，可在 GUI 中浏览、搜索、安装/卸载 DSH 插件，免命令行。能力：appstore_search 工具按名称/描述/tags 检索插件目录（含已安装状态）；安装/卸载走宿主 pnpm，仅限 loopback 调用、需用户在 GUI 中点击确认；host 插件安装后需重启 dsh web 生效。限制：目录 = 内置种子 + 可配置 curated manifest 聚合 + npm 搜索，无中心 registry；安装第三方插件会执行其代码，请核对来源仓库后再安装。用户提到「Plugin Store / App Store / 应用商店 / 安装插件 / 找插件」时即指本插件。'

export function apply(ctx: Context, config?: Config): void {
  if (config?.enabled === false) return

  const catalog = new CatalogService({
    manifestUrl: config?.manifestUrl,
    manifestUrls: config?.manifestUrls,
    enableNpmSearch: config?.enableNpmSearch,
    npmSearchQueries: config?.npmSearchQueries,
    npmScopes: config?.npmScopes,
  })
  const installer = new InstallerService({ profile: config?.profile })

  if (config?.announceToAgent !== false) {
    ctx.effect(
      () => ctx.systemPrompt.section({ name: 'plugin:dsh-plugin-store', order: SECTION_ORDER, text: APPSTORE_GUIDANCE }),
      'dsh-plugin-store: section',
    )
  }

  ctx.effect(
    () => {
      const disposers = makeRoutes({ catalog, installer }).map(route => ctx.webServer.register(route))
      return () => { for (const dispose of disposers) dispose() }
    },
    'dsh-plugin-store: routes',
  )

  ctx.effect(
    () => {
      const dispose = ctx.tools.register(appstoreSearchTool(catalog, () => installer.installedVersions()))
      return () => { dispose() }
    },
    'dsh-plugin-store: tools',
  )
}
