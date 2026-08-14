/**
 * The App Store panel: a left category/source rail and a dense list of app
 * rows (gradient icon tile + name/verified + author·category + one-line
 * description + install/update pill). Suite entries expand inline to show
 * their member packages — one product is ONE row, not a dozen. All surface
 * copy is localized (zh/en) via the locale dictionaries; the store name
 * "Plugin Store" stays English in both locales.
 */
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import type { AppStoreApi } from '../api.ts'
import type { CatalogEntry, InstallResult, StatusResult } from '../../protocol.ts'
import type { PanelController } from './controller.ts'
import { categoryFor, categoryLabel, CATEGORY_ORDER } from '../categories.ts'
import { gradientFor } from '../gradient.ts'
import { getLanguage, subscribeLanguage, t } from '../locales.ts'
import css from './panel.module.css'

interface AppStorePanelProps {
  controller: PanelController
  api: AppStoreApi
}

type Filter = 'all' | 'installed' | string

/** Letter fallback when an entry ships no logo/emoji. */
function letterAvatar(name: string): string {
  const seg = name.split('/').pop() ?? name
  return seg.replace(/^dsh-(client-ui-)?/, '').charAt(0).toUpperCase() || '?'
}

function IconTile({ entry, size = 40 }: { entry: CatalogEntry; size?: number }) {
  const isUrl = entry.logo !== undefined && /^(https?:|data:|\/)/.test(entry.logo)
  const style: CSSProperties = isUrl
    ? { background: 'var(--dsw-alias-bg-elevated, rgba(0,0,0,0.08))', width: size, height: size }
    : { background: gradientFor(entry.name), width: size, height: size }
  return (
    <div className={css.iconTile} style={style}>
      {isUrl ? (
        <img className={css.iconImg} src={entry.logo} alt="" loading="lazy" />
      ) : (
        <span style={{ color: '#fff', fontSize: size * 0.5, fontWeight: 600 }}>{entry.logo ?? letterAvatar(entry.name)}</span>
      )}
    </div>
  )
}

export function AppStorePanel({ api }: AppStorePanelProps) {
  // Re-render on language switch (the locale dictionaries are module-level).
  useSyncExternalStore(subscribeLanguage, getLanguage, getLanguage)

  const [entries, setEntries] = useState<CatalogEntry[]>([])
  const [sources, setSources] = useState<string[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [status, setStatus] = useState<StatusResult | null>(null)
  const [query, setQuery] = useState('')
  const [activeFilter, setActiveFilter] = useState<Filter>('all')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [log, setLog] = useState('')
  const [result, setResult] = useState<InstallResult | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [cat, st] = await Promise.all([api.catalog(), api.status()])
      setEntries(cat.entries)
      setSources(cat.sources)
      setErrors(cat.errors)
      setStatus(st)
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)])
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { void load() }, [load])

  const installedCount = entries.filter(e => e.installedVersion !== undefined).length

  const categoryCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of entries) {
      const c = categoryFor(e)
      counts.set(c, (counts.get(c) ?? 0) + 1)
    }
    return CATEGORY_ORDER.filter(c => counts.has(c)).map(c => ({ category: c, count: counts.get(c)! }))
  }, [entries])

  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const e of entries) counts.set(e.source, (counts.get(e.source) ?? 0) + 1)
    return counts
  }, [entries])

  const sourceLabel = (s: string): string => s === 'seed' || s === 'manifest' ? t('source.curated') : s === 'npm' ? t('source.npm') : s

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    let list = entries
    if (activeFilter === 'installed') list = list.filter(e => e.installedVersion !== undefined)
    else if (activeFilter !== 'all') list = list.filter(e => categoryFor(e) === activeFilter)
    if (q !== '') {
      list = list.filter(e => (
        e.name.toLowerCase().includes(q)
        || e.description.toLowerCase().includes(q)
        || e.tags.some(t => t.toLowerCase().includes(q))
        || (e.highlights ?? []).some(h => h.toLowerCase().includes(q))
        || (e.members ?? []).some(m => m.name.toLowerCase().includes(q) || m.description.toLowerCase().includes(q))
      ))
    }
    return list
  }, [entries, activeFilter, query])

  const runOp = async (op: 'install' | 'uninstall' | 'update', spec: string, confirmText: string) => {
    if (!window.confirm(confirmText)) return
    setBusy(spec)
    setLog('')
    setResult(null)
    try {
      const r = op === 'install' ? await api.install(spec, t => setLog(p => p + t))
        : op === 'uninstall' ? await api.uninstall(spec, t => setLog(p => p + t))
        : await api.update(spec, t => setLog(p => p + t))
      setResult(r)
      await load()
    } catch (error) {
      setResult({ ok: false, spec, requiresRestart: false, error: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(null)
    }
  }

  const doRefresh = async () => {
    setLoading(true)
    try {
      const cat = await api.refresh()
      setEntries(cat.entries)
      setSources(cat.sources)
      setErrors(cat.errors)
      const st = await api.status()
      setStatus(st)
    } catch (error) {
      setErrors([error instanceof Error ? error.message : String(error)])
    } finally {
      setLoading(false)
    }
  }

  const railItem = (key: Filter, label: string, count?: number) => (
    <button
      key={key}
      type="button"
      className={activeFilter === key ? css.railItemActive : css.railItem}
      onClick={() => setActiveFilter(key)}
    >
      <span>{label}</span>
      {count !== undefined && <span className={css.railCount}>{count}</span>}
    </button>
  )

  const renderAction = (entry: CatalogEntry) => {
    const installed = entry.installedVersion !== undefined
    const isBusy = busy === entry.name
    const update = installed && entry.updateAvailable === true
    return (
      <div className={css.rowAction} onClick={e => e.stopPropagation()}>
        {update && (
          <button style={s.buttonUpdate} disabled={isBusy} onClick={() => { void runOp('update', entry.name, t('confirm.update', { name: entry.name, version: entry.version ?? '' })) }}>
            {isBusy ? t('common.processing') : t('action.update', { version: entry.version ?? '' })}
          </button>
        )}
        {installed ? (
          <button style={s.buttonDanger} disabled={isBusy} onClick={() => { void runOp('uninstall', entry.name, t('confirm.uninstall', { name: entry.name })) }}>
            {isBusy ? t('common.processing') : t('action.uninstall')}
          </button>
        ) : (
          <button style={s.buttonPrimary} disabled={isBusy} onClick={() => { void runOp('install', entry.name, t('confirm.install', { name: entry.name })) }}>
            {isBusy ? t('common.processing') : t('action.install')}
          </button>
        )}
      </div>
    )
  }

  return (
    <div className={css.panel} style={s.panel}>
      <div style={s.header}>
        <h2 style={s.title}>Plugin Store</h2>
        <span style={s.subtitle}>{status !== null ? `profile: ${status.profile}` : ''}</span>
        <button style={s.button} onClick={() => { void doRefresh() }} disabled={loading}>{t('common.refresh')}</button>
      </div>

      <input style={s.search} placeholder={t('search.placeholder')} value={query} onChange={e => setQuery(e.target.value)} />

      {errors.length > 0 && (
        <div style={s.bannerErr}>{errors.map((e, i) => <div key={i}>{e}</div>)}</div>
      )}
      {result !== null && (
        result.ok
          ? <div style={s.bannerOk}>{t('banner.ok', { name: result.name ?? result.spec })}</div>
          : <div style={s.bannerErr}>{t('banner.error', { error: result.error ?? t('common.unknownError') })}</div>
      )}

      <div className={css.body}>
        <aside className={css.rail}>
          <div className={css.railTitle}>{t('rail.browse')}</div>
          {railItem('all', t('rail.all'), entries.length)}
          {railItem('installed', t('rail.installed'), installedCount)}

          <div className={css.railTitle} style={{ marginTop: 14 }}>{t('rail.categories')}</div>
          {categoryCounts.map(({ category, count }) => railItem(category, categoryLabel(category), count))}

          {sources.length > 0 && (
            <>
              <div className={css.railTitle} style={{ marginTop: 14 }}>{t('rail.sources')}</div>
              {sources.map(src => (
                <div key={src} className={css.railSource}>
                  <span>{sourceLabel(src)}</span>
                  <span className={css.railCount}>{sourceCounts.get(src) ?? 0}</span>
                </div>
              ))}
            </>
          )}
        </aside>

        <div className={css.list}>
          {loading && entries.length === 0 && <div style={s.empty}>{t('common.loading')}</div>}
          {!loading && entries.length === 0 && <div style={s.empty}>{t('empty.none')}</div>}
          {!loading && entries.length > 0 && filtered.length === 0 && <div style={s.empty}>{t('empty.noMatch', { query })}</div>}

          {filtered.map(entry => {
            const isBusy = busy === entry.name
            const isExpanded = expanded === entry.name
            const curated = entry.source === 'manifest'
            const memberCount = entry.members?.length ?? 0
            const update = entry.installedVersion !== undefined && entry.updateAvailable === true
            return (
              <div key={entry.name}>
                <div className={css.row} onClick={() => setExpanded(isExpanded ? null : entry.name)}>
                  <IconTile entry={entry} />
                  <div className={css.rowBody}>
                    <div className={css.rowName}>
                      <span className={css.rowNameText}>{entry.name}</span>
                      {curated && (
                        <svg className={css.verified} viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-label="curated">
                          <path d="M8 1.5l1.9 1.1 2.2-.3.3 2.2 1.9 1.1-1.1 1.9.3 2.2-2.2.3L10 12.1l-2 1.9-2-1.9-2.2.3-.3-2.2-1.9-1.1L2.7 8 2.4 5.8l2.2-.3L6 3.4l2-1.9z" />
                          <path d="M5.6 8l1.5 1.5 2.9-3" fill="none" stroke="#fff" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                        </svg>
                      )}
                      {memberCount > 0 && <span className={css.rowBadge}>{t('row.memberCount', { count: memberCount })}</span>}
                      {update && <span className={css.rowBadge} style={{ color: 'var(--dsw-alias-interactive-accent, #3b82f6)' }}>{t('row.updateAvailable')}</span>}
                    </div>
                    <div className={css.rowMeta}>{entry.author ?? '—'} · {categoryLabel(categoryFor(entry))}</div>
                    <div className={css.rowDesc}>{entry.description}</div>
                  </div>
                  {renderAction(entry)}
                </div>

                {isExpanded && (
                  <div className={css.detail}>
                    {(entry.highlights ?? []).length > 0 && (
                      <div className={css.detailHighlights}>
                        {(entry.highlights ?? []).map(h => <div key={h} className={css.detailHi}>· {h}</div>)}
                      </div>
                    )}
                    {memberCount > 0 && (
                      <div className={css.members}>
                        {(entry.members ?? []).map(m => (
                          <div key={m.name} className={css.member}>
                            <div className={css.memberIcon} style={{ background: gradientFor(m.name) }}>{m.logo ?? letterAvatar(m.name)}</div>
                            <div className={css.memberBody}>
                              <div className={css.memberName}>{m.name}</div>
                              <div className={css.memberDesc}>{m.description}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                    {(entry.repository !== undefined || entry.homepage !== undefined) && (
                      <div className={css.detailLinks}>
                        {entry.repository !== undefined && <a className={css.detailLink} href={entry.repository} target="_blank" rel="noreferrer">{t('detail.repository')}</a>}
                        {entry.homepage !== undefined && <a className={css.detailLink} href={entry.homepage} target="_blank" rel="noreferrer">{t('detail.homepage')}</a>}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {busy !== null && (
        <div style={s.logBox}>
          <div style={s.logTitle}>{t('log.title')}</div>
          <pre style={s.log}>{log}</pre>
        </div>
      )}
    </div>
  )
}

/** Inline chrome styles (rail/row/icon live in the CSS module). */
const s: Record<string, CSSProperties> = {
  panel: { display: 'flex', flexDirection: 'column', height: '100%', minWidth: 0, minHeight: 0, padding: '14px 16px 16px', gap: 10, background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', fontFamily: 'var(--dsw-font-family)', boxSizing: 'border-box' },
  header: { display: 'flex', alignItems: 'center', gap: 10, flex: 'none' },
  title: { margin: 0, flex: 1, fontSize: 16, fontWeight: 700 },
  subtitle: { fontSize: 12, color: 'var(--dsw-alias-label-secondary)' },
  search: { padding: '8px 10px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l1)', background: 'var(--dsw-alias-bg-base)', color: 'var(--dsw-alias-label-primary)', fontSize: 13, flex: 'none' },
  button: { padding: '5px 12px', borderRadius: 8, border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', fontSize: 13 },
  buttonPrimary: { padding: '5px 14px', borderRadius: 999, border: 'none', background: 'var(--dsw-alias-interactive-accent, #3b82f6)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  buttonUpdate: { padding: '5px 14px', borderRadius: 999, border: 'none', background: 'var(--dsw-alias-interactive-accent, #3b82f6)', color: '#fff', cursor: 'pointer', fontSize: 12, fontWeight: 600 },
  buttonDanger: { padding: '5px 14px', borderRadius: 999, border: '1px solid var(--dsw-alias-border-l1)', background: 'transparent', color: 'var(--dsw-alias-label-primary)', cursor: 'pointer', fontSize: 12 },
  bannerOk: { padding: '8px 12px', borderRadius: 8, background: 'rgba(34,197,94,0.12)', color: 'var(--dsw-alias-label-primary)', fontSize: 13 },
  bannerErr: { padding: '8px 12px', borderRadius: 8, background: 'rgba(239,68,68,0.12)', color: 'var(--dsw-alias-label-primary)', fontSize: 13 },
  empty: { fontSize: 13, color: 'var(--dsw-alias-label-secondary)', padding: '16px 0', textAlign: 'center' },
  logBox: { flex: 'none', maxHeight: 160, display: 'flex', flexDirection: 'column', border: '1px solid var(--dsw-alias-border-l1)', borderRadius: 8, overflow: 'hidden' },
  logTitle: { padding: '6px 10px', fontSize: 12, color: 'var(--dsw-alias-label-secondary)', borderBottom: '1px solid var(--dsw-alias-border-l1)' },
  log: { margin: 0, padding: '8px 10px', overflow: 'auto', fontSize: 12, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-all', color: 'var(--dsw-alias-label-secondary)' },
}
