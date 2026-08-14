/**
 * Standalone build config for the dsh-plugin-store plugin.
 * Reuses the shared client-bundle preset: node-half lib/ (catalog + installer +
 * routes + tools) plus the browser bundle lib/client.js (closure-factory for
 * window.__ModuleLoader__). The client entry is auto-detected at src/client/index.ts.
 */
import { clientBundle } from '../../shared/tsdown.client.ts'

export default clientBundle('dsh-plugin-store', ['src/index.ts', 'src/invariant.ts'], {
  libExternal: [
    '@deepseek-ai/dsh-host-webserver',
    '@deepseek-ai/dsh-system-prompt',
    '@deepseek-ai/dsh-tools',
  ],
})
