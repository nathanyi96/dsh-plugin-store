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

/**
 * No hardcoded seed: every entry the catalog shows must be pulled live, either
 * from an aggregated curated manifest (`manifestUrl`/`manifestUrls`, PR-based)
 * or from npm registry discovery. An empty seed means an empty catalog until
 * one of those sources is configured or npm search is enabled.
 */
const SEED: CatalogEntry[] = []

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
  /** Free-text queries for npm search (noisy — results are substring-filtered). */
  npmSearchQueries?: string[]
  /**
   * npm's `keywords:<word>` search qualifier (unlike `scope:`, this one
   * actually works): an exact match against a package's declared
   * `package.json` `keywords[]`. High-precision — a hit here is a real
   * self-tag, not a name/description coincidence, so these bypass the
   * name-substring filter that free-text hits go through.
   */
  npmKeywordQueries?: string[]
  /** Scopes to enumerate for npm discovery. */
  npmScopes?: string[]
}

/**
 * npm keyword queries. Besides the generic DSH terms, `deepsafe`/`safety`
 * surface plugins related to DeepSafe (AI45Lab's safety-evaluation framework)
 * so they are auto-discovered as soon as they publish with these markers.
 */
const DEFAULT_QUERIES = ['dsh-plugin', 'deepseek-harness', 'dsh-web-ui', 'deepsafe', 'safety-eval']
/** `keywords:<word>` qualified searches — see `npmKeywordQueries` doc above. */
const DEFAULT_KEYWORD_QUERIES = ['deepseek-harness', 'dsh-plugin']
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
      const keywordQueries = this.config.npmKeywordQueries ?? DEFAULT_KEYWORD_QUERIES
      const scopes = this.config.npmScopes ?? DEFAULT_SCOPES
      const hits = new Map<string, NpmSearchHit>()
      // High-precision hits — scope enumeration and `keywords:` self-tags — may
      // skip the name-substring filter: they are already scoped or self-tagged
      // as DSH plugins, so a hit there is trusted up front (the `dsh`-field
      // check in fetchManifestInfo remains the final gate). Free-text hits go
      // through the coarse name filter below.
      const trusted = new Set<string>()
      const results = await Promise.all([
        ...queries.map(q => npmSearch(q)),
        // `keywords:<word>` qualifier: exact match on a package's declared
        // keywords[] — high precision, and (unlike `scope:`) it actually works.
        ...keywordQueries.map(q => npmSearch(`keywords:${q}`)),
        // Scope enumeration: the search API's `scope:` qualifier is unreliable
        // (returns 0 against the registry), but querying the bare scope name
        // (e.g. `@linxin666`) returns exactly that scope's packages.
        ...scopes.map(s => npmSearch(s)),
      ])
      const resultKinds = [
        ...queries.map(() => 'free' as const),
        ...keywordQueries.map(() => 'keyword' as const),
        ...scopes.map(() => 'scope' as const),
      ]
      results.forEach((list, i) => {
        const kind = resultKinds[i]
        for (const h of list) {
          if (hits.has(h.name)) continue
          hits.set(h.name, h)
          if (kind !== 'free') trusted.add(h.name)
        }
      })
      sources.push('npm')

      // Enrich candidates: trusted hits (scope/keyword) bypass the name
      // filter; free-text hits must look dsh-ish before we spend a registry
      // round-trip on them.
      const candidates = [...hits.values()].filter(h => {
        if (byName.has(h.name)) return false
        if (trusted.has(h.name)) return true
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
