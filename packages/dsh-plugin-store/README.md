# dsh-plugin-store — Plugin Store for DeepSeek Harness

[English](README.md) · [中文](README.zh-CN.md)

Browse, search, and install/uninstall DSH plugins from the web GUI — no more `dsh plugin add ...` on the command line. The host half serves `/api/dsh-app-store/*` loopback routes plus a pnpm installer; the browser half injects a sidebar "App Store" entry plus a center-column catalog panel; it also exposes a read-only `appstore_search` tool to the agent.

## Capabilities

| Capability | Description |
|---|---|
| Catalog browsing | Merges three sources: bundled seed, configurable curated manifests, npm registry search |
| Search | Filters by plugin name / description / tags |
| Install / uninstall | Runs `pnpm add/remove` in the host process, streaming NDJSON progress logs |
| Installed status | Annotates `installedVersion` from the profile's `dependencies` |
| Agent tool | `appstore_search` (read-only); install/uninstall is GUI-click-only |
| Restart notice | Prompts to restart `dsh web` after installing a host plugin |

## Where the catalog comes from

DSH has **no central registry**, so this plugin's catalog merges three sources, from most reliable to freshest:

1. **Bundled seed** (`SEED` in `src/catalog.ts`) — currently **empty** by design: the package ships no hardcoded plugin data, to avoid entries that look "officially vetted" or "pulled from the source repo" but are actually hand-written. The catalog is empty offline — an intentional trade-off.
2. **Curated manifests** — a JSON you maintain (`{ plugins: [...] }`), pointed at via `manifestUrl` (e.g. GitHub raw, such as this repo's [`catalog.json`](../../catalog.json)). **This is the scalable answer**: updating the catalog means editing that one file, no re-release. **Note**: `manifestUrl` is unset by default — a deployment must explicitly point it at the raw URL for `catalog.json` to take effect.
3. **npm registry search** (enabled by default) — three kinds of queries:
   - free-text queries (`npmSearchQueries`, default `dsh-plugin` / `deepseek-harness` / `dsh-web-ui` / `deepsafe` / `safety-eval`) — noisy, filtered by name;
   - `keywords:` self-tag queries (`npmKeywordQueries`, default `deepseek-harness` / `dsh-plugin`) — exact match against a package's declared `keywords[]`, high precision;
   - scope enumeration (`npmScopes`, default `@linxin666` / `@ai45lab`) — the registry search API's `scope:` qualifier is unreliable, so the bare scope name is queried directly.

   Every candidate is then gated on the `dsh` manifest field (`dsh.bundle` or `dsh.client`) in its `package.json` — that field is the only fingerprint marking a package as a real DSH plugin. name / description / author / repository / homepage are all read live from the registry; nothing is hand-curated.

To get your own plugin discovered, pick any of three routes: add it to a curated manifest; publish to npm with the `dsh` field plus matching keywords/scope (no review required, fully automatic); or PR into this repo's seed list (currently empty — waiting for you to fill it).

## Why discovery looked sparse — and how to onboard more

The catalog reflects exactly what the npm registry currently hosts. For a while the only self-declaring plugins were one org's (`@linxin666/*`); the store does **not** restrict by author — it just reports what exists, with no curation (no custom logos, no hand-written highlights, no packing multiple packages into a "suite" card — none of that lives in npm metadata, and hardcoding it would be fabrication). As more authors publish with the `dsh` field + matching keywords/scope, they surface automatically.

To broaden the ecosystem, in order from automatic to manual:

1. **npm keyword/scope discovery (automatic, enabled by default)** — anyone who publishes with a `dsh` field and `dsh-plugin` / `deepseek-harness` keywords (or under a scanned scope) is discovered, with all metadata read live from the registry. This is the "detection" mechanism, but it relies on authors following the naming/keyword conventions, so some slip through.
2. **Curated manifest / this repo's `catalog.json` (the scalable answer, needs wiring)** — PR an entry into [`catalog.json`](../../catalog.json) (currently `plugins: []`), **and** have a deployment point its `manifestUrl` at the raw URL. Both steps are required: a PR alone does nothing until some deployment aggregates it.
3. **Ship the Plugin Store itself** — push this repo to GitHub and publish `dsh-plugin-store` to npm, so it becomes the entry point others install.

In one line: **no central registry is DSH's current reality; the Plugin Store covers it with npm discovery (live) + a PR-able, wiring-required `catalog.json`. Every entry is real registry data — nothing fabricated.**

## Architecture (two halves)

- **Host half** (`src/`, exports `.`): `CatalogService` (catalog) + `InstallerService` (pnpm + bundle reconcile) + `makeRoutes` (loopback routes) + `appstoreSearchTool`.
- **Browser half** (`src/client/`, exports `./client`): a sidebar entry (DOM injection + MutationObserver self-heal) + a center-column React catalog panel.

Installation = `pnpm add` in the profile dir, then reconcile packages declaring `dsh.bundle` into `dsh.profile.bundles` (equivalent to `dsh plugin`).

## Security model

- All `/api/dsh-app-store/*` routes are **loopback-only** (same-origin check), so the ability to download-and-execute third-party code is never exposed to the LAN.
- The browser prompts a `confirm` before install and shows the source repository link for review.
- The agent only gets the read-only `appstore_search`; install/uninstall requires a human click.
- Install-spec allowlist: bare package name / absolute `file:` `link:` / `https://github.com/...git` — everything else is rejected.
- After an install/update resolves fresh lockfile entries, the store persists them into `pnpm-workspace.yaml`'s `minimumReleaseAgeExclude`, so the trust survives the next plain `pnpm install` instead of tripping the 24h supply-chain gate.

## Installation

```sh
# dev/debug: link from this repo
pnpm --filter dsh-plugin-store build
dsh plugin --profile web add link:$(pwd)/packages/dsh-plugin-store
# then restart dsh web
```

From npm once published:
```sh
dsh plugin --profile web add dsh-plugin-store
```

After installing, **restart `dsh web`**: the sidebar shows an "App Store" entry, and the agent's system prompt picks up the plugin description automatically.

## Configuration

| Config | Default | Description |
|---|---|---|
| `enabled` | `true` | Master switch |
| `announceToAgent` | `true` | Whether to announce this plugin to the agent |
| `profile` | `web` | Fallback profile name (used when walking up fails) |
| `manifestUrl` | empty | Curated manifest JSON URL |
| `manifestUrls` | `[]` | Additional manifest URLs to aggregate (federation) |
| `enableNpmSearch` | `true` | Whether to run live npm discovery |
| `npmSearchQueries` | see source | Free-text npm queries |
| `npmKeywordQueries` | see source | `keywords:` exact-match queries |
| `npmScopes` | `['@linxin666', '@ai45lab']` | Scopes enumerated for discovery |

## Curated manifest format

```json
{
  "plugins": [
    {
      "name": "@scope/dsh-foo",
      "description": "...",
      "repository": "https://github.com/...",
      "tags": ["foo"],
      "author": "..."
    }
  ]
}
```

## Development

```sh
pnpm --filter dsh-plugin-store typecheck   # tsc --noEmit
pnpm --filter dsh-plugin-store build       # tsc type artifacts + tsdown dual-half bundle
```

## Known limitations

- **No central registry**: npm search is heuristic (scope + keyword + `dsh`-field fingerprint), so there are misses and noise; long-term, maintain a curated manifest.
- **Host plugins require a restart** of `dsh web` to take effect (no in-process hot reload).
- **Three-panel coordination is imperfect**: this panel and task-board / ssh are mutually exclusive via the `dsh-panel-activate` event, but the latter two only know each other, not this panel — in edge cases switching panels may need an extra click.
- **Git-hosted plugins**: pnpm blocks `prepare` scripts on install; follow the hint in the log to add an `allowBuilds` entry in `pnpm-workspace.yaml`.
- npm enrichment issues several registry requests (cached for 5 minutes).
