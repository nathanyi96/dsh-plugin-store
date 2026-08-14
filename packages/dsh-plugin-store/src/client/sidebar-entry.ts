/**
 * Sidebar entry injection (DOM-level, task-board/dsh-ssh precedent).
 * The sidebar shell exposes no external slot, so the entry row is injected
 * after the New Session button and self-heals on React re-renders via a
 * MutationObserver.
 */
import type { PanelController } from './panel/controller.ts'
import { t } from './locales.ts'
import css from './panel/panel.module.css'

export const ENTRY_SELECTOR = '[data-dsh-appstore-entry]'

/** Inline storefront-grid glyph (matches the shell's 16px nav-icon look). */
const ICON = '<svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3" aria-hidden="true"><rect x="2" y="2" width="5.2" height="5.2" rx="1"/><rect x="8.8" y="2" width="5.2" height="5.2" rx="1"/><rect x="2" y="8.8" width="5.2" height="5.2" rx="1"/><rect x="8.8" y="8.8" width="5.2" height="5.2" rx="1"/></svg>'

const LABEL = 'Plugin Store'
const TOOLTIP = t('entry.tooltip')

function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return undefined
  const logoOwner = column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement
  return logoOwner ?? (column.firstElementChild as HTMLElement | undefined)
}

function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  const nested = root.querySelector<HTMLButtonElement>('button[class*="newSession"]')
  if (nested !== null) return nested
  for (const child of root.children) {
    if (child.tagName === 'BUTTON') return child as HTMLButtonElement
  }
  return undefined
}

function createEntry(controller: PanelController): HTMLButtonElement {
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.dataset.dshAppstoreEntry = ''
  entry.className = css.entry
  entry.setAttribute('aria-label', LABEL)
  entry.setAttribute('title', TOOLTIP)
  entry.innerHTML = '<span class="' + css.entryIcon + '">' + ICON + '</span><span class="' + css.entryLabel + '">' + LABEL + '</span>'
  entry.addEventListener('click', () => { controller.toggle() })
  return entry
}

function placeEntry(root: HTMLElement, entry: HTMLButtonElement): boolean {
  const button = newSessionButton(root)
  if (button === undefined) return false
  if (entry.parentElement !== root) {
    const row = button.closest('[class*="logoRow"]')
    const base = (row !== null && row.parentElement === root) ? row : button
    const family = Array.from(root.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el.matches('[data-dsh-taskboard-entry], [data-dsh-ssh-entry], [data-dsh-appstore-entry]'),
    )
    const anchor = family.length > 0 ? family[family.length - 1].nextElementSibling : base.nextElementSibling
    root.insertBefore(entry, anchor)
  }
  return true
}

export function mountSidebarEntry(controller: PanelController): () => void {
  const entry = createEntry(controller)
  let root: HTMLElement | undefined
  let placed = false

  const tryPlace = (): void => {
    if (root !== undefined && !root.isConnected) {
      rootObserver.disconnect()
      root = undefined
      placed = false
    }
    if (placed) {
      if (document.body.contains(entry)) return
      rootObserver.disconnect()
      root = undefined
      placed = false
    }
    root ??= sidebarRoot()
    if (root === undefined) return
    placed = placeEntry(root, entry)
    if (placed) rootObserver.observe(root, { childList: true, subtree: true })
  }

  const waitObserver = new MutationObserver(() => { tryPlace() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const rootObserver = new MutationObserver(() => {
    if (root === undefined || !root.isConnected) {
      placed = false
      tryPlace()
      return
    }
    if (!root.contains(entry)) placed = placeEntry(root, entry)
  })

  const unsubscribe = controller.subscribe(() => {
    entry.dataset.active = controller.getSnapshot().panelOpen ? 'true' : undefined
  })
  entry.dataset.active = controller.getSnapshot().panelOpen ? 'true' : undefined

  tryPlace()

  return () => {
    waitObserver.disconnect()
    rootObserver.disconnect()
    unsubscribe()
    entry.remove()
  }
}
