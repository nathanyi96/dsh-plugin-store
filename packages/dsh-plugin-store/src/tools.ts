/**
 * Agent tool: appstore_search — read-only catalog lookup so an agent can
 * discover plugins. Install/uninstall stay GUI-only (they execute arbitrary
 * code via pnpm and must be human-initiated).
 */

import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { CatalogService } from './catalog.ts'
import type { CatalogEntry } from './protocol.ts'

function text(value: string): ContentBlock[] {
  return [{ type: 'text', text: value }]
}

export function appstoreSearchTool(catalog: CatalogService, getInstalled: () => Record<string, string>) {
  return defineTool({
    name: 'appstore_search',
    description: 'Search the DeepSeek Harness plugin catalog (installed and installable plugins). Returns plugin name, description, repository and install status. ' +
      'Triggers: find plugins, discover extensions, app store, available plugins, install a plugin.',
    parameters: {
      query: { type: 'string', description: 'Search text matched against plugin name, description and tags.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          entries: {
            type: 'array',
            required: true,
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                name: { type: 'string', required: true },
                description: { type: 'string', required: true },
                version: { type: 'string' },
                repository: { type: 'string' },
                tags: { type: 'array', items: { type: 'string' }, required: true },
                installedVersion: { type: 'string' },
              },
            },
          },
        },
      },
      render: (_args, value: { entries: Array<{ name: string; description: string; version?: string; repository?: string; tags: string[]; installedVersion?: string }> }) => {
        const rows = value.entries ?? []
        if (rows.length === 0) return text('no plugins matched')
        return text(rows.map(e => {
          const status = e.installedVersion !== undefined ? `installed (${e.installedVersion})` : 'not installed'
          const lines = [`${e.name} — ${status}`, `  ${e.description}`]
          if (e.repository !== undefined) lines.push(`  repo: ${e.repository}`)
          if (e.tags.length > 0) lines.push(`  tags: ${e.tags.join(', ')}`)
          return lines.join('\n')
        }).join('\n\n'))
      },
    },
    async execute(args) {
      const result = await catalog.list(args.query)
      const installed = getInstalled()
      for (const e of result.entries) {
        const spec = installed[e.name]
        e.installedVersion = spec === undefined ? undefined : spec.replace(/^[\^~>=< ]+/, '')
      }
      return { entries: result.entries }
    },
  })
}
