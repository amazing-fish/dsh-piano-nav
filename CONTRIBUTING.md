# Contributing

## Setup

Use Node.js `^22.19.0 || >=24.0.0` and pnpm `10.17.1`. Commands work in PowerShell.

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm test:package
```

`verify` builds host/client and runs contracts, grouping, rail, smoke and
integration checks. `test:package` inspects and installs the built tarball,
then loads its actual host/client entries. For local DSH testing, build first:

```powershell
pnpm build
dsh plugin --profile web add link:C:/projects/dsh-sm-context-piano
```

## Browser regressions

```powershell
npm install --prefix .browser-tools --no-save --ignore-scripts playwright@1.55.1 esbuild@0.28.2 zustand@4.4.7 immer@10.1.1 react@18.3.1
node .browser-tools/node_modules/playwright/cli.js install chromium
node scripts/rail-browser.mjs
node scripts/pointer-browser.mjs
node scripts/settings-browser.mjs
node scripts/settings-layout-browser.mjs
node scripts/color-save-browser.mjs
node scripts/browser.mjs
$env:NODE_PATH = Join-Path $PWD '.browser-tools/node_modules'
node scripts/semantic-browser.mjs
```

Pinned native components are downloaded into generated fixture directories.
These tests use real painting/native component logic with synthetic Session
data, and do not replace a live DSH acceptance run.

## Repository map

| Directory | Contents |
| --- | --- |
| `src/core/` | Shared settings and project metadata |
| `src/client/` | Sources, semantics, adapters, interaction and UI |
| `lib/` | Tracked builds; regenerate after source changes |
| `scripts/` | Build, contracts, integration, browser and packaging checks |
| `assets/` | Runtime source assets bundled into the client |
| `docs/` | Current product and maintenance documentation |
| `docs/archive/` | Clearly marked historical plans/screenshots |
| `artifacts/`, `test-results/` | Generated output, excluded from git/npm |

## Changes

Keep native ownership and semantic/interaction rules explicit. Update the
current guide when a contract changes; archive superseded plans instead of
leaving contradictory current instructions. Add regressions for concrete
behavior changes or failure paths, with fixtures separate from product code.

Release identity lives in package.json; wrapper/settings metadata derive from
it. Keep cordis.patch.yml aligned, and preserve the compatibility settings ID
unless a separate migration is designed. Submit focused PRs with validation
and material limits, and retain MIT attribution.
