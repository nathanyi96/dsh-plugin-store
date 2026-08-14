/**
 * Installer service: runs pnpm in the dsh profile directory (the same thing
 * `dsh plugin` does), then reconciles `dsh.profile.bundles` against the
 * installed state. Discover the profile dir by walking up from this module
 * (it lives in <profile>/node_modules/<pkg>/lib/index.js).
 */

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'
import { load as loadYaml, dump as dumpYaml } from 'js-yaml'
import type { InstallResult, StatusResult } from './protocol.ts'

interface ProfileManifest {
  name?: string
  dependencies?: Record<string, string>
  dsh?: { profile?: { bundles?: string[] } }
}

export interface InstallerConfig {
  /** Preferred profile name (fallback when walking up fails). */
  profile?: string
}

/** Validate an install spec: package name, absolute file:/link:, or https git url. */
const PACKAGE_NAME_RE = /^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/
/** Validate a bare package name (for uninstall). */
export function isValidPackageName(name: string): boolean {
  return PACKAGE_NAME_RE.test(name)
}

/** Validate an install spec: package name, absolute file:/link:, or https git url. */
export function isValidInstallSpec(spec: string): boolean {
  if (PACKAGE_NAME_RE.test(spec)) return true
  if (/^(file|link):\//.test(spec)) return true
  if (/^https:\/\/github\.com\/.*\.git$/.test(spec)) return true
  return false
}

/** Walk up from this module to find the profile dir (has dsh.profile.bundles). */
function discoverProfileDir(preferred: string): { name: string; dir: string } {
  let dir = dirname(fileURLToPath(import.meta.url))
  for (let i = 0; i < 10; i++) {
    const pj = join(dir, 'package.json')
    if (existsSync(pj)) {
      try {
        const manifest = JSON.parse(readFileSync(pj, 'utf8')) as ProfileManifest
        if (Array.isArray(manifest.dsh?.profile?.bundles)) {
          return { name: manifest.name ?? preferred, dir }
        }
      } catch { /* keep walking */ }
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return { name: preferred, dir: join(homedir(), '.dsh', 'profiles', preferred) }
}

interface PnpmResult {
  exitCode: number | null
  output: string
  error?: string
}

export class InstallerService {
  readonly profileName: string
  readonly profileDir: string

  constructor(config: InstallerConfig = {}) {
    const discovered = discoverProfileDir(config.profile ?? 'web')
    this.profileName = discovered.name
    this.profileDir = discovered.dir
  }

  get pnpmAvailable(): boolean {
    return this.hasPnpm()
  }

  /** Read the profile manifest (bundles + dependencies). */
  status(): StatusResult {
    const manifest = this.readManifest()
    return {
      profile: this.profileName,
      profileDir: this.profileDir,
      bundles: manifest.dsh?.profile?.bundles ?? [],
      dependencies: manifest.dependencies ?? {},
      pnpmAvailable: this.hasPnpm(),
    }
  }

  /** Installed dependency name -> version. */
  installedVersions(): Record<string, string> {
    return this.readManifest().dependencies ?? {}
  }

  /** Run `pnpm add <spec>` and reconcile. */
  async install(spec: string, onLog?: (chunk: string) => void): Promise<InstallResult> {
    const before = this.lockfilePackageKeys()
    const result = await this.runPnpm(['add', spec], onLog)
    if (result.exitCode === 0) {
      this.trustNewLockfileEntries(before)
      this.reconcile()
      return { ok: true, spec, name: this.resolvedName(spec), requiresRestart: true }
    }
    return { ok: false, spec, requiresRestart: false, error: result.error ?? `pnpm exited ${result.exitCode}` }
  }

  /** Run `pnpm remove <name>` and reconcile. */
  async uninstall(name: string, onLog?: (chunk: string) => void): Promise<InstallResult> {
    const result = await this.runPnpm(['remove', name], onLog)
    if (result.exitCode === 0) {
      this.reconcile()
      return { ok: true, spec: name, name, requiresRestart: true }
    }
    return { ok: false, spec: name, name, requiresRestart: false, error: result.error ?? `pnpm exited ${result.exitCode}` }
  }

  /** Run `pnpm add <name>@latest` (update to the latest registry version) and reconcile. */
  async update(name: string, onLog?: (chunk: string) => void): Promise<InstallResult> {
    const before = this.lockfilePackageKeys()
    const result = await this.runPnpm(['add', `${name}@latest`], onLog)
    if (result.exitCode === 0) {
      this.trustNewLockfileEntries(before)
      this.reconcile()
      return { ok: true, spec: name, name, requiresRestart: true }
    }
    return { ok: false, spec: name, name, requiresRestart: false, error: result.error ?? `pnpm exited ${result.exitCode}` }
  }

  private hasPnpm(): boolean {
    const r = spawnSync('pnpm', ['--version'], { stdio: 'ignore' })
    return r.error === undefined
  }

  private readManifest(): ProfileManifest {
    const pj = join(this.profileDir, 'package.json')
    if (!existsSync(pj)) return {}
    try {
      return JSON.parse(readFileSync(pj, 'utf8')) as ProfileManifest
    } catch {
      return {}
    }
  }

  private resolvedName(spec: string): string | undefined {
    return PACKAGE_NAME_RE.test(spec) ? spec : undefined
  }

  /** `name@version` keys currently in the lockfile's `packages` map. */
  private lockfilePackageKeys(): Set<string> {
    const lockPath = join(this.profileDir, 'pnpm-lock.yaml')
    if (!existsSync(lockPath)) return new Set()
    try {
      const doc = loadYaml(readFileSync(lockPath, 'utf8')) as { packages?: Record<string, unknown> }
      return new Set(Object.keys(doc.packages ?? {}))
    } catch {
      return new Set()
    }
  }

  /**
   * runPnpm bypasses minimumReleaseAge for this one invocation only (a CLI
   * flag, not persisted). Without this, the freshly-resolved lockfile entries
   * fail supply-chain policy on the next plain `pnpm install` (dsh plugin,
   * another machine, or this app's next boot) even though the user just
   * approved installing them here. Diff the lockfile's package set before/
   * after and add whatever's new to minimumReleaseAgeExclude.
   */
  private trustNewLockfileEntries(before: Set<string>): void {
    const after = this.lockfilePackageKeys()
    const added = [...after].filter((key) => !before.has(key))
    if (added.length === 0) return
    const wsPath = join(this.profileDir, 'pnpm-workspace.yaml')
    let doc: { minimumReleaseAgeExclude?: string[]; [key: string]: unknown } = {}
    if (existsSync(wsPath)) {
      try {
        doc = (loadYaml(readFileSync(wsPath, 'utf8')) as typeof doc) ?? {}
      } catch {
        return
      }
    }
    const exclude = new Set(doc.minimumReleaseAgeExclude ?? [])
    for (const key of added) exclude.add(key)
    doc.minimumReleaseAgeExclude = [...exclude]
    writeFileSync(wsPath, dumpYaml(doc, { lineWidth: -1 }))
  }

  /**
   * pnpm add/remove with streamed output. The minimumReleaseAge supply-chain
   * gate is disabled: pnpm 11 defaults it to 24h, so a freshly published
   * `@latest` would otherwise be silently held back to an older version —
   * the update would report success while changing nothing. Install/update
   * here are explicit, user-confirmed GUI actions, so the gate is not the
   * right policy for them.
   */
  private runPnpm(args: string[], onLog?: (chunk: string) => void): Promise<PnpmResult> {
    return new Promise((resolve) => {
      let output = ''
      let settled = false
      const child = spawn('pnpm', [...args, '--config.minimumReleaseAge=0'], { cwd: this.profileDir, env: process.env })
      const feed = (chunk: Buffer | string): void => {
        const text = String(chunk)
        output += text
        onLog?.(text)
      }
      child.stdout?.on('data', feed)
      child.stderr?.on('data', feed)
      child.on('error', (error) => {
        if (settled) return
        settled = true
        resolve({ exitCode: null, output, error: error.message })
      })
      child.on('close', (code) => {
        if (settled) return
        settled = true
        resolve({ exitCode: code ?? 1, output })
      })
    })
  }

  /**
   * Mirror `dsh plugin` reconcile: a dependency whose package declares
   * `dsh.bundle` joins `dsh.profile.bundles`; a listed bundle that is no
   * longer a bundle-bearing dependency leaves it.
   */
  private reconcile(): void {
    const pj = join(this.profileDir, 'package.json')
    if (!existsSync(pj)) return
    let manifest: ProfileManifest
    try {
      manifest = JSON.parse(readFileSync(pj, 'utf8')) as ProfileManifest
    } catch {
      return
    }
    const dependencies = Object.keys(manifest.dependencies ?? {})
    const bundles = manifest.dsh?.profile?.bundles ?? []
    let changed = false
    for (const name of dependencies) {
      if (this.isBundle(name) && !bundles.includes(name)) {
        bundles.push(name)
        changed = true
      }
    }
    const depSet = new Set(dependencies)
    for (let i = bundles.length - 1; i >= 0; i--) {
      const name = bundles[i]
      if (depSet.has(name) && !this.isBundle(name)) {
        bundles.splice(i, 1)
        changed = true
      }
    }
    if (!changed) return
    manifest.dsh = { ...manifest.dsh, profile: { ...manifest.dsh?.profile, bundles } }
    writeFileSync(pj, JSON.stringify(manifest, null, 2) + '\n')
  }

  /** Whether a dependency declares `dsh.bundle.patch` (i.e. is a bundle). */
  private isBundle(name: string): boolean {
    const pj = join(this.profileDir, 'node_modules', name, 'package.json')
    if (!existsSync(pj)) return false
    try {
      const pkg = JSON.parse(readFileSync(pj, 'utf8')) as { dsh?: { bundle?: { patch?: unknown } } }
      return pkg.dsh?.bundle?.patch !== undefined
    } catch {
      return false
    }
  }
}
