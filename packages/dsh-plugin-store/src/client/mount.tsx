/**
 * Panel view mounting. The center column is single-occupant, so the panel
 * container is appended inside `[data-pane="conversation"]` and a stylesheet
 * rule hides the conversation while active. Toggling is a data attribute on
 * <html> — no React involvement, the conversation subtree stays mounted.
 */
import { createRoot, type Root } from 'react-dom/client'
import type { AppStoreApi } from './api.ts'
import type { PanelController } from './panel/controller.ts'
import { AppStorePanel } from './panel/AppStorePanel.tsx'
import css from './panel/panel.module.css'

export const PANEL_VIEW_SELECTOR = '[data-dsh-appstore-view]'

const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"]'
const ACTIVE_ATTR = 'data-dsh-appstore-active'
const OTHER_ACTIVE_ATTRS = ['data-dsh-taskboard-active', 'data-dsh-ssh-active']
const ACTIVATE_EVENT = 'dsh-panel-activate'
const PANEL_NAME = 'appstore'

function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

export function mountPanel(controller: PanelController, api: AppStoreApi): () => void {
  let root: Root | undefined
  let container: HTMLDivElement | undefined

  const ensure = (): void => {
    if (container !== undefined) {
      if (container.isConnected) return
      root?.unmount()
      root = undefined
      container.remove()
      container = undefined
    }
    const column = conversationColumn()
    if (column === undefined) return
    container = document.createElement('div')
    container.dataset.dshAppstoreView = ''
    container.className = css.view
    column.appendChild(container)
    root = createRoot(container)
    root.render(<AppStorePanel controller={controller} api={api} />)
  }

  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

  const applyActive = (): void => {
    if (controller.getSnapshot().panelOpen) {
      for (const attr of OTHER_ACTIVE_ATTRS) document.documentElement.removeAttribute(attr)
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }))
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR)
    }
  }

  const onOtherActivate = (event: Event): void => {
    const detail = (event as CustomEvent).detail
    if ((detail === 'taskboard' || detail === 'ssh') && controller.getSnapshot().panelOpen) {
      controller.close()
    }
  }

  const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'
  const onClickSidebarRow = (event: MouseEvent): void => {
    if (!controller.getSnapshot().panelOpen) return
    const target = event.target as HTMLElement | null
    if (target === null) return
    if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) controller.close()
  }
  document.addEventListener('click', onClickSidebarRow, true)
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
  const unsubscribe = controller.subscribe(applyActive)
  applyActive()
  ensure()

  return () => {
    document.removeEventListener('click', onClickSidebarRow, true)
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
    waitObserver.disconnect()
    unsubscribe()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    root?.unmount()
    root = undefined
    container?.remove()
    container = undefined
  }
}
