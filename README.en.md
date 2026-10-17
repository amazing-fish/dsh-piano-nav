# DSH Piano Navigator

**A semantic rail for previewing and navigating long agent conversations.**

[中文](https://github.com/amazing-fish/dsh-piano-nav/blob/master/README.md) · [Usage](https://github.com/amazing-fish/dsh-piano-nav/blob/master/docs/USAGE.md) · [Documentation](https://github.com/amazing-fish/dsh-piano-nav/blob/master/docs/README.md) · [Issues](https://github.com/amazing-fish/dsh-piano-nav/issues)

[![CI](https://github.com/amazing-fish/dsh-piano-nav/actions/workflows/verify.yml/badge.svg)](https://github.com/amazing-fish/dsh-piano-nav/actions/workflows/verify.yml) [![npm](https://img.shields.io/npm/v/dsh-piano-nav)](https://www.npmjs.com/package/dsh-piano-nav) [![MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

For the **DeepSeek Harness Web GUI**, independently maintained by [amazing-fish](https://github.com/amazing-fish). This project has evolved into a full-history navigator with semantic questions and answers, process folding, and continuous pointer interaction. Its origins are documented in [NOTICE](NOTICE.md).

## Preview

![Actual step-aware keys: input, process, question, answer, final result, folding and dark theme](https://raw.githubusercontent.com/amazing-fish/dsh-piano-nav/0e2523aa02773a8ff19e524024348b2144c6d98f/docs/assets/semantic-steps.gif)

The gallery cycles through **blue user input → gray process group → expanded process steps → amber AI question → green user answer → purple double-stroke final result → folding after navigation → dark-theme process keys**. These are actual plugin/native-component states with synthetic Session data, held briefly for readability. Ordinary process keys are white or near-white in the dark theme.

<details>
<summary>Continuous pointer following: before/after comparison</summary>

![Identical pointer trajectory: discrete key changes before the fix and continuous following afterward](https://raw.githubusercontent.com/amazing-fish/dsh-piano-nav/0e2523aa02773a8ff19e524024348b2144c6d98f/docs/assets/pointer-follow-before-after.gif)

Both sides replay the same slow movement, fast movement and immediate reversal. Left: before the fix; right: current behavior. This browser replay uses actual plugin code with synthetic Session data and keys enlarged 4×. The 5/120 and 120/120 labels count width changes during small pointer movements; **they are not FPS**.

</details>

## Install

Requires the DSH `web` profile and Node.js `^22.19.0 || >=24.0.0`.

```powershell
dsh plugin --profile web add dsh-piano-nav
```

Refresh the Web GUI and open **Piano Navigator** in Settings. The npm package is `dsh-piano-nav`; the existing `dsh-piano` package is a different, musical plugin.

For migration, remove the old scoped package or local link's loading entry before adding the new package. Preserve persisted settings: the entry ID remains compatible. See [migration](https://github.com/amazing-fish/dsh-piano-nav/blob/master/docs/USAGE.md#从旧包迁移).

## What the rail represents

| Target | Behavior |
| --- | --- |
| User input | A separate entry for each input segment |
| AI process output | Semantic text runs; consecutive same-turn output can fold |
| Final result | Distinguished from intermediate process output |
| AI question / user answer | Structured `ask_user_question` exchanges and status |
| Earlier history | Outline entries delegate loading and landing to DSH |

Ordinary tool logs, edits, reads, and reasoning do not become separate keys. Structured questions are an explicit exception. Unloaded turns remain real outline entries until actual segments become available.

## Independently developed capabilities

- **One full-history rail:** combines the outline and loaded segments. Successful takeover shows Piano; unsupported conditions restore native navigation.
- **On-demand process expansion:** activate a group to show its members, then a member to navigate. Revealable native process wrappers and question cards open before landing. Passive scrolling and streaming preserve explicit expansion.
- **Continuous pointer wave:** movement within a key updates the wave too. Pointer frames update visible keys and the necessary preview; no persistent loop remains when the pointer stops.
- **Fixed display window:** 20 keys by default, with stable spacing and wheel/keyboard access to available entries throughout the conversation.
- **Everyday interaction:** plain-text previews, reader highlighting, stable node reuse, themes, keyboard access, and reduced-motion support.
- **Persistent settings in three languages:** 简体中文, English, and 繁體中文, with immediate layout controls.

## Controls

| Action | Result |
| --- | --- |
| Move along the rail | Continuous wave and the nearest key's preview |
| Click / `Enter` / `Space` | Navigate or delegate loading to the native owner |
| First activation of a folded group | Expand it and retire the previous group |
| Activate members in the same process group | Navigate while retaining expansion; other key kinds retire it |
| Wheel over the rail | Browse without scrolling the transcript; retire expansion |
| `↑` / `↓`, `PageUp` / `PageDown` | Move selection and adjust the window |
| `Home` / `End` | Select the first/last entry in the conversation list |
| `Escape` | Close preview, retire expansion, and cancel navigation intent |

Defaults: **2px** thickness, **12px** center spacing, **20** visible keys. The 1.3.1 settings page adds six semantic color controls, a bound legend and live layout preview. Changes persist and update actual keys; automatic colors follow the theme. See [usage](https://github.com/amazing-fish/dsh-piano-nav/blob/master/docs/USAGE.md) for settings and edge cases.

<details>
<summary>Current settings page</summary>

![DSH Piano Navigator 1.3.1: semantic colors, bound legend, preview and layout settings](https://raw.githubusercontent.com/amazing-fish/dsh-piano-nav/6da0ef9785cb442ae03a6e6558cc05ea59b16ab0/docs/assets/settings-1.3.1.png)

The actual 1.3.1 settings component in Simplified Chinese with demo settings data. See [media sources](https://github.com/amazing-fish/dsh-piano-nav/blob/6da0ef9785cb442ae03a6e6558cc05ea59b16ab0/docs/assets/SOURCES.md) for provenance and versions.

</details>

## Compatibility and data boundaries

Development dependencies are pinned to DSH `0.2.0-rc.2`. Type/integration checks and browser regressions using pinned native source establish different levels of evidence; see [compatibility](https://github.com/amazing-fish/dsh-piano-nav/blob/master/docs/COMPATIBILITY.md).

The checked DOM bridge reuses native paging and scroll ownership. It is not an official stable navigator replacement API. Narrow layouts, missing targets, or contract drift restore native UI. Segments sharing a DOM row may land at the same row start.

Piano reads navigation information, displays plain-text previews, and persists its own settings. It does not rewrite messages, inject system prompts, or submit answers. Historical requests remain DSH's responsibility.

## Development and documentation

```powershell
pnpm install --frozen-lockfile
pnpm verify
pnpm test:package
```

| Entry | Contents |
| --- | --- |
| [Contributing](https://github.com/amazing-fish/dsh-piano-nav/blob/master/CONTRIBUTING.md) | Setup, directories, tests, PRs |
| [Architecture](https://github.com/amazing-fish/dsh-piano-nav/blob/master/docs/ARCHITECTURE.md) | Read models, native navigation, scheduling, lifecycle |
| [Semantic rules](https://github.com/amazing-fish/dsh-piano-nav/blob/master/docs/SEMANTIC_KEYS.md) | Segments, questions, finality, folding |
| [Releasing](https://github.com/amazing-fish/dsh-piano-nav/blob/master/docs/RELEASING.md) | Inspection, authentication, tarball publication, verification |
| [Changelog](CHANGELOG.md) | Independently maintained package changes |

`src/` holds implementation, `scripts/` regressions and fixtures, and `lib/` tracked builds. Start at `docs/README.md`; historical plans/screenshots live in `docs/archive/`.

## Origin and license

Evolved from [hjj345/dsh-sm-context-piano](https://github.com/hjj345/dsh-sm-context-piano), retaining original MIT copyright. Current development and releases are maintained here. See [LICENSE](LICENSE) and [NOTICE](NOTICE.md).
