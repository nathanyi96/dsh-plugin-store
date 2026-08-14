/**
 * Category derivation (kirocrew precedent): apps carry free-form tags; the
 * store groups them into a small canonical set. Categories use stable ids as
 * filter keys (never display text); the display label is localized through
 * the locale dictionaries (`categoryLabel`). An explicit `category` field on
 * an entry wins; otherwise tags are matched in priority order — the first
 * category with a matching tag wins, so specific tags beat generic ones.
 */
import { t, type AppStoreKey } from './locales.ts'

export const CATEGORY_ORDER = ['suite', 'ops', 'ui', 'productivity', 'theme', 'dev', 'fun', 'other'] as const
export type Category = (typeof CATEGORY_ORDER)[number]

const MATCHERS: [Category, string[]][] = [
  ['suite', ['suite', 'bundle', 'web-ui-all']],
  ['ops', ['ssh', 'remote', 'ops', 'monitoring', 'deploy', 'terminal', 'tunnel', 'cluster']],
  ['ui', ['panel', 'explorer', 'preview', 'scm', 'sidebar', 'settings', 'web-ui', 'file', 'stats']],
  ['productivity', ['task-board', 'kanban', 'cron', 'todo', 'tasks', 'productivity']],
  ['theme', ['skin', 'theme']],
  ['dev', ['git', 'graph', 'dev', 'code', 'developer', 'repository', 'build']],
  ['fun', ['pet', 'fun', 'companion']],
]

/** Legacy Chinese category names accepted by old manifests/seed data. */
const CATEGORY_ALIASES: Record<string, Category> = {
  套件: 'suite',
  运维: 'ops',
  界面与面板: 'ui',
  效率与看板: 'productivity',
  皮肤与主题: 'theme',
  开发工具: 'dev',
  趣味: 'fun',
  其他: 'other',
}

/** Normalize an explicit category string to a canonical id (untrusted, never throws). */
function normalizeCategory(raw: string): Category {
  const c = raw.trim()
  if ((CATEGORY_ORDER as readonly string[]).includes(c)) return c as Category
  const lower = c.toLowerCase()
  if ((CATEGORY_ORDER as readonly string[]).includes(lower)) return lower as Category
  return CATEGORY_ALIASES[c] ?? 'other'
}

/** Derive a category from free-form tags (untrusted input, never throws). */
export function categoryFromTags(tags?: string[]): Category {
  const set = new Set((Array.isArray(tags) ? tags : []).filter((t): t is string => typeof t === 'string').map(t => t.toLowerCase()))
  for (const [category, matches] of MATCHERS) {
    for (const tag of set) if (matches.includes(tag)) return category
  }
  return 'other'
}

/** Resolve an entry's category: explicit field (normalized), else tags. */
export function categoryFor(entry: { category?: string; tags?: string[] }): Category {
  if (entry.category !== undefined && entry.category !== '') return normalizeCategory(entry.category)
  return categoryFromTags(entry.tags)
}

/** Localized display label for a category id. */
export function categoryLabel(category: Category): string {
  return t(`category.${category}` as AppStoreKey)
}
