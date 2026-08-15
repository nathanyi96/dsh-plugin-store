# dsh-plugin-store

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) (`dsh`) plugin: browse,
search, and install/uninstall DSH plugins from a web GUI, no CLI required.

## What's in this repo

- **[`packages/dsh-plugin-store`](packages/dsh-plugin-store)** — the Plugin Store itself. Host
  half serves a catalog + a loopback pnpm installer; browser half adds a sidebar entry and a
  panel. See its [README](packages/dsh-plugin-store/README.md) for architecture, security model,
  and configuration.
- **[`catalog.json`](catalog.json)** — the registry index. This is where third-party plugins get
  listed via pull request. Schema: [`catalog.schema.json`](catalog.schema.json). It starts empty —
  everything the store currently shows comes from live npm registry discovery, not from anything
  hand-curated here.
- **[`AGENTS.md`](AGENTS.md)** — the machine-readable contract for registering a plugin, written
  for coding agents to follow directly.

## No central registry

DSH has no central plugin registry. This store's catalog merges three sources, most reliable to
freshest:

1. a curated manifest you can point it at (`catalog.json` in this repo, or your own, via
   `manifestUrl`/`manifestUrls` — federated, not baked into the package);
2. live npm registry search, restricted to packages that self-declare a `dsh` field
   (`dsh.bundle` or `dsh.client`) in their `package.json` — that field is the only thing that
   marks a package as a real DSH plugin.

Nothing is hardcoded into the package itself. See
[`packages/dsh-plugin-store/README.md`](packages/dsh-plugin-store/README.md#where-the-catalog-comes-from)
for the full breakdown, and [`AGENTS.md`](AGENTS.md) for how to register your own plugin.

## Development

```sh
pnpm install
pnpm --filter dsh-plugin-store typecheck
pnpm --filter dsh-plugin-store build

# link into a local dsh profile for testing
dsh plugin --profile web add link:$(pwd)/packages/dsh-plugin-store
# then restart dsh web
```
