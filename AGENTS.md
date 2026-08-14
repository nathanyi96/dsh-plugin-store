# AGENTS.md — DeepSeek Harness Plugin Store

This file is written for AI agents (and tools that read agent-facing docs, e.g. MCP clients,
Cline/Claude Code/Codex custom instructions). It tells an agent how to **register a DSH
plugin into the Plugin Store** without needing a human to translate intent.

## What this repository is

`dsh-plugin-store` is the **Plugin Store** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)
("dsh"). It has two parts:

- `packages/dsh-plugin-store` — the store plugin itself (a `dsh` plugin: host catalog + pnpm installer + web panel).
- `catalog.json` — the **registry index**: the single file everyone PRs into to list a plugin.

There is **no central registry**. Discovery is federated: the store merges
`catalog.json` (and any `manifestUrl`/`manifestUrls` you point it at) + npm search.

## How to register a plugin (the contract)

To list a plugin in the store, add one entry to the `plugins[]` array in [`catalog.json`](catalog.json).
The schema is [`catalog.schema.json`](catalog.schema.json). Minimal valid entry:

```json
{
  "name": "@yourscope/dsh-your-plugin",
  "description": "What it does, in one line.",
  "author": "you",
  "category": "ops",
  "logo": "🧪",
  "tags": ["your-plugin"],
  "repository": "https://github.com/you/dsh-your-plugin"
}
```

### Rules

1. `name` MUST be the npm package name (the exact install spec).
2. `description` is required; keep it one line.
3. `category` is one of: `suite` | `ops` | `ui` | `productivity` | `theme` | `dev` | `fun` | `other`
   (displayed localized; derived from tags when omitted).
4. `logo` is an emoji, a single letter, or an image URL.
5. `members[]` marks the entry as a **suite**; members are shown inside the card and are NOT
   listed as separate top-level entries.
6. If the package declares a `dsh` manifest field (`dsh.bundle` or `dsh.client` in its
   `package.json`), the store trusts it as a real DSH plugin. If it does not, set nothing —
   the curated entry is still listed, but the package must be a real `dsh` plugin to be useful.

## The `dsh` manifest field (self-declaration fingerprint)

For **automatic discovery** (npm search), a package must self-declare. Put this in the plugin's
`package.json`:

```jsonc
{
  "name": "@yourscope/dsh-your-plugin",
  "dsh": {
    // host plugin (has a node half + system-prompt/tools/routes):
    "bundle": { "patch": "./cordis.patch.yml" },
    // browser-only plugin (a web GUI panel):
    "client": { "platform": "web" }
  }
}
```

The store's npm discovery only keeps packages whose `package.json` declares `dsh.bundle` or
`dsh.client`. To be discovered automatically, also:

- publish to npm under a discoverable scope, or
- include discoverable keywords in `name`/`description`/`keywords`.

Default discovery probes these npm scopes and keywords (configurable via `npmScopes` /
`npmSearchQueries`):

- scopes: `@linxin666`, `@ai45lab` (DeepSafe's org)
- keywords: `dsh-plugin`, `deepseek-harness`, `dsh-web-ui`, `deepsafe`, `safety-eval`

## Discovery channels (how a plugin can appear)

1. **Register (push)** — PR an entry into `catalog.json` (this file's contract).
2. **Auto-discovery (pull)** — publish to npm with a `dsh` field + matching scope/keyword.
3. **Federation** — any store can set `manifestUrl`/`manifestUrls` to your catalog's raw URL;
   plugins registered in one catalog then surface in every store that aggregates it.
4. **Directory aggregation** — maintain an awesome-list (e.g. `awesome-dsh-plugin`) and point a
   store's `manifestUrls` at its machine-readable form.

## Useful commands

```sh
pnpm --filter dsh-plugin-store typecheck   # type-check
pnpm --filter dsh-plugin-store build       # build node half + browser bundle
```
