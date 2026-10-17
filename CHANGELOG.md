# Changelog

## Unreleased

- Restore clear theme defaults for history keys and keep custom history colors
  shared by actual borders, the legend, preview and color picker. Apply hover
  and current emphasis to unloaded borders; correct the preview's history label.
- Retain transparent unloaded keys and existing key sizes; 1–2px keys do not
  have enough interior height to display a hollow centre.
- Size the settings preview to its visible demo keys instead of the full window capacity.
- Keep a disclosed process group open when navigating its members; retain retirement on other keys, group replacement and Escape.
- Preserve the latest color-picker draft during asynchronous saves; roll back failed writes and restrict picker activation to the 32px swatch.

## 1.3.1 — release preparation

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

The package manifest prepares 1.3.1. npm publication is a separate verified
step; this entry does not claim that latest has changed from 1.3.0.

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
