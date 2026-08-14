/**
 * Catalog service: merges a bundled seed, aggregated curated manifests
 * (federation, configurable URLs), and npm registry discovery into one
 * plugin list. This is the answer to "how do I find every DeepSeek plugin":
 *   1. seed       — a hardcoded list of known plugins (never empty, offline-safe);
 *   2. manifests  — curated JSON catalogs you aggregate (scales; federate without releasing);
 *   3. npm        — live registry search over scopes + keywords, filtered to
 *                   packages that declare a `dsh` manifest field.
 */

import type { CatalogEntry, CatalogResult } from './protocol.ts'

/** Curated seed: the @linxin666 web-ui suite as ONE app (its constituent packages are members, not separate entries). */
const SEED: CatalogEntry[] = [
  {
    name: '@linxin666/dsh-web-ui-all',
    description: 'dsh web UI 全家桶：一套安装，得到整套 GUI 功能与皮肤。',
    author: 'linxin666',
    category: 'suite',
    logo: '🧩',
    tags: ['web-ui', 'suite', 'panel', 'skin', 'ssh', 'task-board'],
    highlights: [
      '远程 SSH 运维（主机 / 执行 / 传输 / 隧道 / 集群 + agent 工具）',
      '任务看板 + cron 定时任务',
      '右侧面板：文件树 / 预览 / SCM 变更',
      '皮肤中心 + 多种主题皮肤',
      'Git 图 · 桌面宠物 · 实时统计 · 远程访问 · 设置面板',
    ],
    members: [
      { name: '@linxin666/dsh-ssh', description: '远程 SSH 运维', logo: '🖥️' },
      { name: '@linxin666/dsh-client-ui-task-board', description: '任务看板 + 定时任务', logo: '📋' },
      { name: '@linxin666/dsh-client-ui-aionui-panel', description: '右侧面板（文件树 / 预览 / SCM）', logo: '🧩' },
      { name: '@linxin666/dsh-client-ui-skin-center', description: '皮肤中心', logo: '🎨' },
      { name: '@linxin666/dsh-skins', description: '皮肤集合', logo: '🎨' },
      { name: '@linxin666/dsh-client-ui-skin-whale-song', description: '「鲸歌」皮肤', logo: '🐋' },
      { name: '@linxin666/dsh-client-ui-git-graph', description: 'Git 提交历史图', logo: '🔀' },
      { name: '@linxin666/dsh-pet', description: '桌面宠物', logo: '🐾' },
      { name: '@linxin666/dsh-live-stats', description: '实时统计', logo: '📊' },
      { name: '@linxin666/dsh-remote-web-ui', description: '远程访问 web UI', logo: '🌐' },
      { name: '@linxin666/dsh-client-ui-web-ui-settings', description: 'web UI 设置面板', logo: '⚙️' },
    ],
    source: 'manifest',
    dshPlugin: true,
    repository: 'https://github.com/zhu1090093659/dsh-web-ui',
  },
]

export interface CatalogConfig {
  /** Curated manifest URL (JSON `{ plugins: [...] }`). Empty → seed only. */
  manifestUrl?: string
  /**
   * Additional curated manifest URLs to aggregate (federation): every URL is
   * fetched and merged on top of the seed. A plugin registered in ANY of
   * these catalogs becomes visible here — the same pattern MCP's registry
   * federation uses. `manifestUrl` is kept for backward compatibility.
   */
  manifestUrls?: string[]
  /** Whether to query the npm registry for live discovery. */
  enableNpmSearch?: boolean
  /** Keyword queries for npm search. */
  npmSearchQueries?: string[]
  /** Scopes to enumerate for npm discovery. */
  npmScopes?: string[]
}

/**
 * npm keyword queries. Besides the generic DSH terms, `deepsafe`/`safety`
 * surface plugins related to DeepSafe (AI45Lab's safety-evaluation framework)
 * so they are auto-discovered as soon as they publish with these markers.
 */
const DEFAULT_QUERIES = ['dsh-plugin', 'deepseek-harness', 'dsh-web-ui', 'deepsafe', 'safety-eval']
/** Scopes enumerated for npm discovery (plugin families + DeepSafe's org). */
const DEFAULT_SCOPES = ['@linxin666', '@ai45lab']

/** npm search hit shape (subset). */
interface NpmSearchHit {
  name: string
  version?: string
  description?: string
  publisher?: { username?: string }
  links?: { repository?: string; homepage?: string }
}

interface ManifestInfo {
  dshPlugin: boolean
  clientOnly: boolean
  version?: string
  description?: string
  author?: string
  repository?: string
  homepage?: string
}

/** Deterministic: normalize a repository url field to a clean string. */
function cleanRepo(repo: unknown): string | undefined {
  if (typeof repo === 'string') return repo.replace(/^git\+/, '').replace(/\.git$/, '')
  if (typeof repo === 'object' && repo !== null && typeof (repo as { url?: unknown }).url === 'string') {
    return (repo as { url: string }).url.replace(/^git\+/, '').replace(/\.git$/, '')
  }
  return undefined
}

/** Fetch a package's full manifest from the registry and detect the dsh field. */
async function fetchManifestInfo(name: string): Promise<ManifestInfo | undefined> {
  try {
    const res = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}`, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return undefined
    const doc = await res.json() as Record<string, any>
    const latest: string | undefined = doc['dist-tags']?.latest
    const ver = latest ? doc.versions?.[latest] : undefined
    if (ver === undefined) return undefined
    const dsh = ver.dsh
    const hasBundle = !!(dsh?.bundle)
    const hasClient = !!(dsh?.client)
    return {
      dshPlugin: hasBundle || hasClient,
      clientOnly: hasClient && !hasBundle,
      version: latest,
      description: typeof ver.description === 'string' ? ver.description : undefined,
      author: typeof ver.author === 'string' ? ver.author : ver.author?.name,
      repository: cleanRepo(ver.repository),
      homepage: typeof ver.homepage === 'string' ? ver.homepage : undefined,
    }
  } catch {
    return undefined
  }
}

/** npm search: return hits mapped to entries (dshPlugin resolved later). */
async function npmSearch(query: string): Promise<NpmSearchHit[]> {
  try {
    const url = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(query)}&size=20`
    const res = await fetch(url, { signal: AbortSignal.timeout(10000) })
    if (!res.ok) return []
    const data = await res.json() as { objects?: Array<{ package?: NpmSearchHit }> }
    return (data.objects ?? []).map(o => o.package).filter((p): p is NpmSearchHit => p !== undefined && p.name !== '')
  } catch {
    return []
  }
}

export class CatalogService {
  private cacheAt = 0
  private cache: CatalogResult | undefined
  private readonly ttlMs = 5 * 60 * 1000

  constructor(private config: CatalogConfig = {}) {}

  /** Clear the cache (used by /refresh). */
  clear(): void {
    this.cache = undefined
    this.cacheAt = 0
  }

  /** Build the full catalog (cached). */
  async list(query?: string): Promise<CatalogResult> {
    const base = await this.base()
    const q = query?.trim().toLowerCase()
    const entries = q === undefined || q === ''
      ? base.entries
      : base.entries.filter(e => (
        e.name.toLowerCase().includes(q)
        || e.description.toLowerCase().includes(q)
        || e.tags.some(t => t.toLowerCase().includes(q))
      ))
    return { ...base, entries }
  }

  private async base(): Promise<CatalogResult> {
    if (this.cache !== undefined && Date.now() - this.cacheAt < this.ttlMs) return this.cache

    const sources: string[] = ['seed']
    const errors: string[] = []
    const byName = new Map<string, CatalogEntry>()
    for (const e of SEED) byName.set(e.name, { ...e })

    // 1) curated manifest aggregation (federation): a single `manifestUrl` and
    // any number of `manifestUrls` are all merged on top of the seed. A plugin
    // registered in any aggregated catalog becomes visible here.
    const manifestUrls = [
      ...(this.config.manifestUrl !== undefined && this.config.manifestUrl !== '' ? [this.config.manifestUrl] : []),
      ...(this.config.manifestUrls ?? []),
    ]
    for (const manifestUrl of manifestUrls) {
      try {
        const res = await fetch(manifestUrl, { signal: AbortSignal.timeout(10000) })
        if (res.ok) {
          const data = await res.json() as { plugins?: Array<Partial<CatalogEntry> & { name: string }> }
          for (const p of data.plugins ?? []) {
            if (p.name === undefined || p.name === '') continue
            byName.set(p.name, {
              name: p.name,
              description: p.description ?? '',
              version: p.version,
              author: p.author,
              repository: p.repository,
              homepage: p.homepage,
              category: p.category,
              logo: p.logo,
              highlights: p.highlights,
              members: p.members,
              tags: p.tags ?? [],
              source: 'manifest',
              dshPlugin: p.dshPlugin ?? true,
              clientOnly: p.clientOnly,
            })
          }
          sources.push('manifest')
        } else {
          errors.push(`manifest fetch failed (${manifestUrl}): HTTP ${res.status}`)
        }
      } catch (error) {
        errors.push(`manifest fetch failed (${manifestUrl}): ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    // 2) npm discovery
    if (this.config.enableNpmSearch !== false) {
      const queries = this.config.npmSearchQueries ?? DEFAULT_QUERIES
      const scopes = this.config.npmScopes ?? DEFAULT_SCOPES
      const hits = new Map<string, NpmSearchHit>()
      const searches = [
        ...queries.map(q => npmSearch(q)),
        ...scopes.map(s => npmSearch(`scope:${s}`)),
      ]
      const results = await Promise.all(searches)
      for (const list of results) {
        for (const h of list) if (!hits.has(h.name)) hits.set(h.name, h)
      }
      sources.push('npm')

      // Enrich candidates (scope hits are all candidates; keyword hits must look dsh-ish).
      const candidates = [...hits.values()].filter(h => {
        if (byName.has(h.name)) return false
        if (scopes.some(s => h.name.startsWith(`${s}/`))) return true
        const lower = h.name.toLowerCase()
        return lower.includes('dsh') || lower.includes('deepseek') || lower.includes('harness')
      })
      const enriched = await Promise.all(candidates.map(async h => {
        const info = await fetchManifestInfo(h.name)
        const dshPlugin = info?.dshPlugin ?? false
        if (!dshPlugin) return undefined
        return {
          name: h.name,
          description: info?.description ?? h.description ?? '',
          version: info?.version ?? h.version,
          author: info?.author ?? h.publisher?.username,
          repository: info?.repository ?? cleanRepo(h.links?.repository),
          homepage: info?.homepage ?? h.links?.homepage,
          tags: [],
          source: 'npm' as const,
          dshPlugin: true,
          clientOnly: info?.clientOnly,
        }
      }))
      for (const e of enriched) if (e !== undefined) byName.set(e.name, e)
    }

    // 2.5) enrich seed/manifest entries with the latest registry version so the
    // store can flag updates (fill version/repository/author only when missing).
    await Promise.all([...byName.values()].map(async e => {
      if (e.version !== undefined) return
      const info = await fetchManifestInfo(e.name)
      if (info === undefined) return
      e.version = info.version ?? e.version
      if (e.repository === undefined) e.repository = info.repository
      if (e.author === undefined) e.author = info.author
    }))

    // 3) fold suite members into their parent: a package listed as a member of a
    // suite is represented inside that suite, not as its own top-level entry.
    const memberOf = new Set<string>()
    for (const e of byName.values()) {
      for (const m of e.members ?? []) memberOf.add(m.name)
    }
    for (const name of memberOf) byName.delete(name)

    this.cache = {
      entries: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)),
      sources,
      errors,
    }
    this.cacheAt = Date.now()
    return this.cache
  }
}
