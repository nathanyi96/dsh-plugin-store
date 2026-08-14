/**
 * The /api/dsh-app-store route family. Every route carries a loopback-only
 * trust fence: install/uninstall execute pnpm in the host profile, i.e.
 * arbitrary code execution — LAN-exposed dsh web deployments must not serve
 * them to remote clients.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { WebRoute } from '@deepseek-ai/dsh-host-webserver'
import type { CatalogService } from './catalog.ts'
import { InstallerService, isValidInstallSpec, isValidPackageName } from './installer.ts'
import { APPSTORE_API } from './protocol.ts'

const MAX_JSON_BODY_BYTES = 64 * 1024

/** Loopback literal check plus browser same-origin markers. */
function isLoopbackRequest(request: IncomingMessage): boolean {
  const address = request.socket.remoteAddress
  if (address !== '127.0.0.1' && address !== '::1' && address !== '::ffff:127.0.0.1') return false
  const host = request.headers.host
  if (typeof host !== 'string') return false
  let hostUrl: URL
  try {
    hostUrl = new URL(`http://${host}`)
  } catch {
    return false
  }
  if (hostUrl.hostname !== '127.0.0.1' && hostUrl.hostname !== 'localhost' && hostUrl.hostname !== '[::1]') return false
  if (request.headers['sec-fetch-site'] === 'cross-site') return false
  const origin = request.headers.origin
  if (origin === undefined) return true
  try {
    return new URL(origin).host === hostUrl.host
  } catch {
    return false
  }
}

function writeJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'referrer-policy': 'no-referrer' })
  res.end(payload)
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | undefined> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buffer = chunk as Buffer
    size += buffer.length
    if (size > MAX_JSON_BODY_BYTES) return undefined
    chunks.push(buffer)
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? parsed as Record<string, unknown> : undefined
  } catch {
    return undefined
  }
}

/** Strip a dependency version range to a display version. */
function displayVersion(spec: string | undefined): string | undefined {
  if (spec === undefined) return undefined
  return spec.replace(/^[\^~>=< ]+/, '').replace(/^(file|link):/, '')
}

/** Loose semver compare: true when `a` > `b` (prerelease-insensitive). */
function semverGt(a: string, b: string): boolean {
  const parse = (s: string) => s.replace(/^[^0-9]*/, '').split('.').map(n => Number.parseInt(n, 10) || 0)
  const pa = parse(a)
  const pb = parse(b)
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0
    const y = pb[i] ?? 0
    if (x > y) return true
    if (x < y) return false
  }
  return false
}

export interface AppStoreRoutesDeps {
  catalog: CatalogService
  installer: InstallerService
}

/** Build every /api/dsh-app-store route. */
export function makeRoutes(deps: AppStoreRoutesDeps): WebRoute[] {
  const { catalog, installer } = deps

  const guard = (req: IncomingMessage, res: ServerResponse, method: string): boolean => {
    if (!isLoopbackRequest(req)) {
      writeJson(res, 403, { error: 'forbidden: loopback-only' })
      return false
    }
    if (req.method !== method) {
      writeJson(res, 405, { error: `method not allowed: ${req.method}` })
      return false
    }
    return true
  }

  const annotateInstalled = (entries: Array<{ name: string; version?: string }>): void => {
    const installed = installer.installedVersions()
    for (const e of entries) {
      const spec = installed[e.name]
      const iv = displayVersion(spec)
      ;(e as { installedVersion?: string; updateAvailable?: boolean }).installedVersion = iv
      ;(e as { updateAvailable?: boolean }).updateAvailable = iv !== undefined && e.version !== undefined && semverGt(e.version, iv)
    }
  }

  return [
    {
      kind: 'exact',
      path: APPSTORE_API.catalog,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        const url = new URL(req.url ?? '/', 'http://localhost')
        const query = url.searchParams.get('query') ?? undefined
        const result = await catalog.list(query)
        annotateInstalled(result.entries)
        writeJson(res, 200, result)
      },
    },
    {
      kind: 'exact',
      path: APPSTORE_API.status,
      handler: async (req, res) => {
        if (!guard(req, res, 'GET')) return
        writeJson(res, 200, installer.status())
      },
    },
    {
      kind: 'exact',
      path: APPSTORE_API.refresh,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        catalog.clear()
        const result = await catalog.list()
        annotateInstalled(result.entries)
        writeJson(res, 200, result)
      },
    },
    {
      kind: 'exact',
      path: APPSTORE_API.install,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const spec = typeof body?.spec === 'string' ? body.spec.trim() : ''
        if (spec === '') {
          writeJson(res, 400, { error: 'spec is required' })
          return
        }
        if (!isValidInstallSpec(spec)) {
          writeJson(res, 400, { error: `invalid install spec: ${spec}` })
          return
        }
        res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache', 'referrer-policy': 'no-referrer' })
        const emit = (line: unknown): void => { try { res.write(JSON.stringify(line) + '\n') } catch { /* client gone */ } }
        emit({ type: 'log', text: `$ pnpm add ${spec}\n` })
        const result = await installer.install(spec, text => emit({ type: 'log', text }))
        emit({ type: 'result', result })
        try { res.end() } catch { /* closed */ }
      },
    },
    {
      kind: 'exact',
      path: APPSTORE_API.uninstall,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const name = typeof body?.name === 'string' ? body.name.trim() : ''
        if (name === '') {
          writeJson(res, 400, { error: 'name is required' })
          return
        }
        if (!isValidPackageName(name)) {
          writeJson(res, 400, { error: `invalid package name: ${name}` })
          return
        }
        res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache', 'referrer-policy': 'no-referrer' })
        const emit = (line: unknown): void => { try { res.write(JSON.stringify(line) + '\n') } catch { /* client gone */ } }
        emit({ type: 'log', text: `$ pnpm remove ${name}\n` })
        const result = await installer.uninstall(name, text => emit({ type: 'log', text }))
        emit({ type: 'result', result })
        try { res.end() } catch { /* closed */ }
      },
    },
    {
      kind: 'exact',
      path: APPSTORE_API.update,
      handler: async (req, res) => {
        if (!guard(req, res, 'POST')) return
        const body = await readJsonBody(req)
        const name = typeof body?.name === 'string' ? body.name.trim() : ''
        if (name === '') {
          writeJson(res, 400, { error: 'name is required' })
          return
        }
        if (!isValidPackageName(name)) {
          writeJson(res, 400, { error: `invalid package name: ${name}` })
          return
        }
        res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-cache', 'referrer-policy': 'no-referrer' })
        const emit = (line: unknown): void => { try { res.write(JSON.stringify(line) + '\n') } catch { /* client gone */ } }
        emit({ type: 'log', text: `$ pnpm add ${name}@latest\n` })
        const result = await installer.update(name, text => emit({ type: 'log', text }))
        emit({ type: 'result', result })
        try { res.end() } catch { /* closed */ }
      },
    },
  ]
}
