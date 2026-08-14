/**
 * dsh-plugin-store surface copy: zh is the key source, en mirrors every key.
 * The client registers the dictionaries through the locale service and
 * follows the active locale into a module-level language flag, exposing a
 * subscribe/getSnapshot pair so the React panel re-renders when the language
 * switches. The store name "Plugin Store" is deliberately not localized — it
 * stays English in both locales.
 */

const zh = {
  'entry.tooltip': '浏览与安装 DSH 插件',
  'common.refresh': '刷新',
  'common.loading': '加载中…',
  'common.processing': '处理中…',
  'common.unknownError': '未知错误',
  'search.placeholder': '搜索插件…',
  'banner.ok': '操作 {name} 成功。host 插件需重启 dsh web 生效。',
  'banner.error': '操作失败：{error}',
  'confirm.install': '安装 {name}？\n\n这会下载并执行第三方代码，请先确认来源仓库可信。',
  'confirm.update': '更新 {name} 到最新版本（{version}）？',
  'confirm.uninstall': '卸载 {name}？',
  'action.install': '安装',
  'action.update': '更新 {version}',
  'action.uninstall': '卸载',
  'source.curated': '策展目录',
  'source.npm': 'npm 发现',
  'rail.browse': '浏览',
  'rail.all': '全部',
  'rail.installed': '已安装',
  'rail.categories': '分类',
  'rail.sources': '来源',
  'empty.none': '没有匹配的插件。点击「刷新」重新拉取目录。',
  'empty.noMatch': '没有匹配「{query}」的插件。',
  'row.memberCount': '{count} 个组件',
  'row.updateAvailable': '可更新',
  'detail.repository': '源代码仓库 ↗',
  'detail.homepage': '主页 ↗',
  'log.title': 'pnpm 输出',
  'category.suite': '套件',
  'category.ops': '运维',
  'category.ui': '界面与面板',
  'category.productivity': '效率与看板',
  'category.theme': '皮肤与主题',
  'category.dev': '开发工具',
  'category.fun': '趣味',
  'category.other': '其他',
} as const

const en: Record<keyof typeof zh, string> = {
  'entry.tooltip': 'Browse and install DSH plugins',
  'common.refresh': 'Refresh',
  'common.loading': 'Loading…',
  'common.processing': 'Working…',
  'common.unknownError': 'Unknown error',
  'search.placeholder': 'Search plugins…',
  'banner.ok': '{name} succeeded. Host plugins need a dsh web restart to take effect.',
  'banner.error': 'Operation failed: {error}',
  'confirm.install': 'Install {name}?\n\nThis downloads and executes third-party code. Confirm the source repository is trusted first.',
  'confirm.update': 'Update {name} to the latest ({version})?',
  'confirm.uninstall': 'Uninstall {name}?',
  'action.install': 'Install',
  'action.update': 'Update {version}',
  'action.uninstall': 'Uninstall',
  'source.curated': 'Curated',
  'source.npm': 'npm discovery',
  'rail.browse': 'Browse',
  'rail.all': 'All',
  'rail.installed': 'Installed',
  'rail.categories': 'Categories',
  'rail.sources': 'Sources',
  'empty.none': 'No matching plugins. Click "Refresh" to refetch the catalog.',
  'empty.noMatch': 'No plugins matching "{query}".',
  'row.memberCount': '{count} components',
  'row.updateAvailable': 'Update available',
  'detail.repository': 'Source repository ↗',
  'detail.homepage': 'Homepage ↗',
  'log.title': 'pnpm output',
  'category.suite': 'Suites',
  'category.ops': 'Ops',
  'category.ui': 'UI & Panels',
  'category.productivity': 'Productivity',
  'category.theme': 'Themes & Skins',
  'category.dev': 'Developer',
  'category.fun': 'Fun',
  'category.other': 'Other',
}

/** Locale key union. */
export type AppStoreKey = keyof typeof zh

/** Dictionary namespace this plugin owns. */
export const NS = 'dsh-app-store'

/** Complete bilingual dictionaries (the locale service enforces zh/en balance). */
export const dictionaries: Record<'zh' | 'en', Record<AppStoreKey, string>> = { zh, en }

let currentLanguage: 'zh' | 'en' = 'zh'
const listeners = new Set<() => void>()

/** Set the active language (the client mirrors the shell's <html lang>). */
export function setLanguage(language: string): void {
  const next: 'zh' | 'en' = language === 'en' ? 'en' : 'zh'
  if (next === currentLanguage) return
  currentLanguage = next
  for (const fn of [...listeners]) fn()
}

/** Current language snapshot (stable primitive, uSES-safe). */
export function getLanguage(): 'zh' | 'en' {
  return currentLanguage
}

/** Observe language switches (paired with getLanguage for useSyncExternalStore). */
export function subscribeLanguage(fn: () => void): () => void {
  listeners.add(fn)
  return () => { listeners.delete(fn) }
}

/** Interpolate {name} placeholders. */
export function format(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => String(params[key] ?? `{${key}}`))
}

/** Translate a key with optional {name} template params (current language). */
export function t(key: AppStoreKey, params?: Record<string, string | number>): string {
  const table = dictionaries[currentLanguage] ?? zh
  const template = table[key] ?? zh[key]
  return params === undefined ? template : format(template, params)
}
