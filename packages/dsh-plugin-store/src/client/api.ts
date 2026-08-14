/**
 * Browser-side API client for the /api/dsh-app-store route family.
 * Plain fetch, same origin; install/uninstall read the NDJSON progress stream.
 */
import { APPSTORE_API, type CatalogResult, type InstallResult, type StatusResult } from '../protocol.ts'

export class AppStoreError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppStoreError'
  }
}

async function readJson<T>(response: Response): Promise<T> {
  let body: unknown
  try {
    body = await response.json()
  } catch {
    throw new AppStoreError(`HTTP ${response.status}: invalid JSON response`)
  }
  if (!response.ok) {
    const message = typeof body === 'object' && body !== null && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `HTTP ${response.status}`
    throw new AppStoreError(message)
  }
  return body as T
}

export class AppStoreApi {
  async catalog(query?: string): Promise<CatalogResult> {
    const q = query !== undefined && query !== '' ? `?query=${encodeURIComponent(query)}` : ''
    const response = await fetch(APPSTORE_API.catalog + q)
    return readJson<CatalogResult>(response)
  }

  async status(): Promise<StatusResult> {
    const response = await fetch(APPSTORE_API.status)
    return readJson<StatusResult>(response)
  }

  async refresh(): Promise<CatalogResult> {
    const response = await fetch(APPSTORE_API.refresh, { method: 'POST' })
    return readJson<CatalogResult>(response)
  }

  async install(spec: string, onLog?: (text: string) => void): Promise<InstallResult> {
    return this.stream(APPSTORE_API.install, { spec }, onLog)
  }

  async uninstall(name: string, onLog?: (text: string) => void): Promise<InstallResult> {
    return this.stream(APPSTORE_API.uninstall, { name }, onLog)
  }

  async update(name: string, onLog?: (text: string) => void): Promise<InstallResult> {
    return this.stream(APPSTORE_API.update, { name }, onLog)
  }

  /** POST and read the NDJSON stream (log lines + a final result line). */
  private async stream(path: string, body: Record<string, string>, onLog?: (text: string) => void): Promise<InstallResult> {
    const response = await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok || response.body === null) {
      let message = `HTTP ${response.status}`
      try {
        const data = await response.json() as { error?: unknown }
        if (typeof data.error === 'string') message = data.error
      } catch { /* non-JSON error body */ }
      throw new AppStoreError(message)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let result: InstallResult | undefined
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (line.trim() === '') continue
        let parsed: { type?: string; text?: string; result?: InstallResult }
        try {
          parsed = JSON.parse(line) as { type?: string; text?: string; result?: InstallResult }
        } catch {
          continue
        }
        if (parsed.type === 'log') onLog?.(parsed.text ?? '')
        else if (parsed.type === 'result') result = parsed.result
      }
    }
    if (result === undefined) throw new AppStoreError('operation ended without a result')
    return result
  }
}
