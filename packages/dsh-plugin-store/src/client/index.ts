/**
 * Browser-half entry for dsh-app-store. Registers the app-store locale
 * dictionaries, follows the active locale (the settings lang) for all
 * surface copy, and mounts the sidebar entry row + the center-column catalog
 * panel. Failure policy: DOM mounting problems are logged, never thrown — a
 * plugin apply throw fails the whole GUI boot.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the locale plugin's Context merge (ctx.locale).
import type {} from '@deepseek-ai/dsh-client-locale/client'
// Type-only: pulls the LocaleNamespaceMap merge table.
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { AppStoreApi } from './api.ts'
import { dictionaries, NS, setLanguage, type AppStoreKey } from './locales.ts'
import { mountPanel } from './mount.tsx'
import { PanelController } from './panel/controller.ts'
import { mountSidebarEntry } from './sidebar-entry.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** dsh-app-store surface copy. */
    'dsh-app-store': AppStoreKey
  }
}

/** Required services (the locale runtime must be up first). */
export const inject: string[] = ['locale']

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, dictionaries), 'dsh-app-store: dictionaries')

  // Language follows the active locale (the setting's lang). Read the locale
  // runtime directly — it is the authoritative source — and re-sync on every
  // active-locale switch. Sync before the DOM surfaces mount so the sidebar
  // tooltip reads the right language on first paint; the React panel
  // re-renders on later switches through its subscribe/getSnapshot pair.
  const syncLanguage = (): void => {
    setLanguage(ctx.locale.getLocale().active)
  }
  syncLanguage()
  const offLocaleChange = ctx.on('locale/change', syncLanguage)
  ctx.effect(() => () => offLocaleChange(), 'dsh-app-store: locale change')

  const controller = new PanelController()
  const api = new AppStoreApi()
  const disposers: Array<() => void> = []
  try {
    disposers.push(mountSidebarEntry(controller))
    disposers.push(mountPanel(controller, api))
  } catch (error) {
    console.warn('[dsh-app-store] mount failed:', error)
  }
  ctx.effect(() => () => {
    for (const dispose of disposers.splice(0)) dispose()
  }, 'dsh-app-store: ui mounts')
}
