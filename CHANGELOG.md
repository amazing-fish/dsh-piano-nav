# Changelog

## Unreleased

- Preview color edits, automatic theme colors and palette resets immediately
  across the picker, legend, demo and actual rail while saving in the background.
  Preserve the latest intent through older acknowledgments, roll back failed
  writes and reject stale revision reads; show pending persistence explicitly.
- Keep tooltip surfaces neutral in light/dark themes even when a host layer
  is tinted, while retaining system forced-color behavior.

## 1.3.2 — release preparation

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

Publication and registry verification are pending.

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
