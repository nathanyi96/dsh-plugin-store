/**
 * Shared wire types + route paths for the App Store (host and client halves).
 * No runtime deps — safe to import from both the node half and the browser bundle.
 */

export const APPSTORE_API = {
  catalog: '/api/dsh-app-store/catalog',
  status: '/api/dsh-app-store/status',
  install: '/api/dsh-app-store/install',
  uninstall: '/api/dsh-app-store/uninstall',
  update: '/api/dsh-app-store/update',
  refresh: '/api/dsh-app-store/refresh',
} as const

/** A sub-package that a suite/bundle entry is composed of. */
export interface SuiteMember {
  /** Package name (shown, but not individually installable from the list). */
  name: string
  description: string
  logo?: string
  installedVersion?: string
}

/** One plugin entry in the catalog (merged manifest + npm discovery). */
export interface CatalogEntry {
  /** npm package name — the install spec. */
  name: string
  description: string
  /** Latest known version (from the registry, when available). */
  version?: string
  author?: string
  /** Source repository URL (github etc.), shown for trust before install. */
  repository?: string
  homepage?: string
  /** Primary category, used for the kirocrew-style filter chips. */
  category?: string
  /** Logo: an emoji, a single letter, or an image URL (falls back to a letter avatar). */
  logo?: string
  /** Bullet-point selling highlights (kirocrew-style). */
  highlights?: string[]
  /** Constituent packages when this entry is a suite/bundle (rendered as one app). */
  members?: SuiteMember[]
  tags: string[]
  /** Where the entry came from. */
  source: 'manifest' | 'npm'
  /** Whether the package declares a `dsh.bundle` or `dsh.client` manifest field. */
  dshPlugin: boolean
  /** True when it declares `dsh.client` but not `dsh.bundle` (UI-only plugin). */
  clientOnly?: boolean
  /** Version currently installed in the profile (undefined when absent). */
  installedVersion?: string
  /** True when a newer registry version exists than the installed one. */
  updateAvailable?: boolean
}

export interface CatalogResult {
  entries: CatalogEntry[]
  /** Sources that contributed (e.g. 'seed', 'manifest', 'npm'). */
  sources: string[]
  errors: string[]
}

/** Result of an install/uninstall operation. */
export interface InstallResult {
  ok: boolean
  /** The spec/name that was acted on. */
  spec: string
  /** Resolved package name when known. */
  name?: string
  /** Host plugins require a profile restart to take effect. */
  requiresRestart: boolean
  error?: string
}

/** Profile/installer status. */
export interface StatusResult {
  profile: string
  profileDir: string
  bundles: string[]
  dependencies: Record<string, string>
  pnpmAvailable: boolean
}
