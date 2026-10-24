# Changelog

## 1.4.1 — 2026-10-24

- Recover idle conversations when the native navigator first appears inside an
  existing nested slot. Observe descendant structure only while the surface is
  absent; resume the existing narrow observers after discovery, without polling
  or requiring composer input.

## 1.4.0 — 2026-10-22

- Adopt the original three-key Piano mark in the plugin settings page, with
  staggered dark keys and a blue accent. The PNG is embedded in the client
  bundle, so the installed plugin needs no separate image download.
- Share the same mark in the Chinese and English README, with an editable SVG
  source and a reproducible `pnpm build:icon` command.

## 1.3.7 — 2026-10-21

- Recover Piano without composer input when the native navigator returns beneath
  the ChatView container after conversation switching. Keep observing a connected
  empty navigation slot until its surface reappears; preserve native fallback
  while unavailable and release the observers on unmount.

## 1.3.6 — 2026-10-21

- Run full verification on master pushes and automatically publish stable version
  increases after the exact source passes CI. Keep OIDC, manual fallback, registry
  byte verification and Release recovery for both publishing entry points.
- Expand folded process groups and navigate to their first member in one click
  or keyboard activation, revealing native hidden process contents before landing.
- Preserve explicit process expansion while browsing the rail with the mouse
  wheel, including groups longer than the visible window.

## 1.3.5 — 2026-10-20

- Recover question/answer navigation when the host publishes loaded Turn metadata
  without changing Chat order or node-store identity. Keep keyed updates local.
- Coalesce navigation-preview and keyed-node publications through the existing
  streaming update interval, retaining the latest content without token-driven
  global refresh bursts.
- Add an on-demand, content-free question diagnostic summary to distinguish
  source, projection, native-anchor, Turn assembly and visible-window gaps.

## 1.3.4 — 2026-10-19

- Keep completed process groups stable while scrolling or resizing; reading
  position changes highlight/windowing only. Preserve explicit expansion,
  same-group navigation, retirement and busy/pending/failure protection.

- Add a manually triggered GitHub Actions OIDC publishing workflow. Guard
  the requested master commit/version and tested archive; verify the downloaded
  registry package before creating a versioned GitHub Release for market update
  notes. Account 2FA stays enabled; npm and GitHub publication are separate jobs.

## 1.3.3 — 2026-10-18

- Apply only changed color variables while dragging; keep color rows independent
  of the settings page and omit navigation rendering and geometry reads for
  palette-only changes. Decode host settings only on confirmed updates and
  avoid duplicate visual notifications or completion handlers.
- Preview color edits, automatic theme colors and palette resets immediately
  across the picker, legend, demo and actual rail while saving in the background.
  Preserve the latest intent through older acknowledgments, roll back failed
  writes and reject stale revision reads; show pending persistence explicitly.
- Keep tooltip surfaces neutral in light/dark themes even when a host layer
  is tinted, while retaining system forced-color behavior.

## 1.3.2 — 2026-10-18

- Keep hover and previews active throughout the currently painted key,
  including its expanded portion; exit beyond its visible width plus 3px.
  Revalidate the resulting width after diagonal movement; retain finite motion,
  painted click geometry and inert blank margins.
- Coalesce consecutive unstarted edits of the same color into the latest value;
  keep in-flight writes, field changes and reset/unset ordering intact. Emit a
  diagnostic warning containing the original host error when persistence fails.
- Reserve localized settings feedback and the preview's expanded demo space so
  failed saves, retries and process folding do not move the page. Retain errors
  until the corresponding operation succeeds; respect reduced motion. Ignore
  obsolete clipboard completions so copy feedback follows the latest attempt.
- Restore clear theme defaults for history keys and keep custom history colors
  shared by actual borders, the legend, preview and color picker. Apply hover
  and current emphasis to unloaded borders; correct the preview's history label.
- Retain transparent unloaded keys and existing key sizes; 1–2px keys do not
  have enough interior height to display a hollow centre.
- Size the settings preview to its expanded demo keys within the visible window instead of the full window capacity.
- Keep a disclosed process group open when navigating its members; retain retirement on other keys, group replacement and Escape.
- Preserve the latest color-picker draft during asynchronous saves; roll back failed writes and restrict picker activation to the 32px swatch.

Published and registry-verified on 2026-10-18; latest was 1.3.2 at verification.
See the [historical publication record](https://github.com/amazing-fish/dsh-piano-nav/blob/master/docs/releases/1.3.2.md).

## 1.3.1 — 2026-10-17

- Persist six semantic color overrides, shared by actual keys, the settings
  legend and layout preview. Automatic colors follow the host theme.
- Restore one kind, all colors in one mutation, or all preferences; retain old documents and
  reject arbitrary CSS. Preserve current/hover emphasis and non-color labels.
- Refresh cached history fallback titles on language changes while keeping
  color-only updates free of navigation rebuilds.
- Add a shared-projection preview and three-language guidance for history,
  folding, keyboard navigation, window capacity and viewport-limited height.
- Rename the GitHub repository to amazing-fish/dsh-piano-nav and synchronize
  package metadata, current links, media references and the listing entry.

Published as npm latest on 2026-10-17. The registry download matches the
reviewed artifact byte for byte; install, host/client loading and the six
color controls were verified. See the
[publication record](https://github.com/amazing-fish/dsh-piano-nav/blob/master/docs/releases/1.3.1.md).

## 1.3.0 — 2026-10-17

First independent npm release under **dsh-piano-nav**. See the
[publication record](https://github.com/amazing-fish/dsh-piano-nav/blob/master/docs/releases/1.3.0.md)
for the source commit, artifact integrity and registry verification.

- Establish the independent product identity, maintainer information, current
  Chinese/English documentation and package verification; retain attribution.
- Consolidate full-history navigation, the checked native bridge, semantic
  input/process/final/question/answer keys and native fallback.
- Include compact process groups, persistent explicit expansion, native
  reveal-before-landing and navigation-triggered retirement fixes.
- Include continuous pointer-coordinate waves and pointer-only frame updates.
- Retain three-language settings, keyboard access, themes, reduced motion,
  session lifecycle handling and native-component regression coverage.

These capabilities were developed across earlier repository commits and PRs.
This release consolidates them under the new package identity.

## Earlier lineage

The previous manifest was `1.3.0-rc.1` under the original scoped name. Earlier
`1.0.0`–`1.2.0` notes and screenshots belong to the upstream lineage and are
preserved in the repository's `docs/archive/`; they are not publication records
for the new npm package.
