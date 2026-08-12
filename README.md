# @terella/build-actions

Reusable GitHub Action that builds all [@terella/action-framework](https://github.com/terella-project/action-framework) actions in your workflow.

## Usage

```yaml
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
      - uses: terella-project/build-actions@v1
        with:
          path: actions
      - uses: ./actions/my-action
```

Scaffold actions with `terella-action init`, then use this action to build them before `uses: ./actions/<name>`.

## Inputs

| Input | Default | Description |
|-------|---------|-------------|
| `path` | `actions` | Directory to scan for actions |
| `minify` | `false` | Minify output bundles |
| `packages` | `bundle` | `bundle` (self-contained) or `external` (needs node_modules at runtime) |

## How it works

1. Installs Bun if not already available.
2. Walks the given path for directories containing `action.yml`.
3. Reads each `action.yml` to find the `main:` entry, maps it back to `src/*.ts`.
4. Bundles each via `Bun.build` (ESM, node target, sourcemaps).
5. Writes `dist/package.json` with `{"type":"module"}`.
