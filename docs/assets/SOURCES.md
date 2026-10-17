# README media

- `semantic-steps.gif`: actual plugin/native-component states captured in
  Chromium from the source tree at `7c2cf798b0a8270a5aa39d8166481bcc3feabb76`.
  It cycles through input, folded process, expanded process, question, answer,
  final result, navigation-triggered folding and dark-theme process keys.
  The original-component fixture uses pinned DSH source
  `c291e7961a515f6d7af9304e7fd1d257929aef26`; Session data and surrounding
  message leaves are synthetic. Demo text replaces internal test markers.
  Each state is held for readability; this is a state gallery, not a motion
  or frame-rate recording. The capture checks key kinds and group folding.
- `pointer-follow-before-after.gif`: reused unchanged from the pointer-smoothing
  comparison delivered with PR #33. Real baseline and fixed plugin code ran in
  Chromium with the same replayed pointer trajectory and synthetic Session data.
  Baseline: `9e289595749a0f6876991700929241fdc117eb57`;
  fixed: `c9cf16a5862d365a37c4c12712e94ccd226a0bf5`.
  The keys are enlarged 4× for visibility. The 5/120 and 120/120 labels count
  width changes during 120 small pointer movements, not frames per second.
- `settings.png`: the actual built DSH Piano Navigator 1.3.0 settings component,
  mounted with a synthetic writable settings scope at 1280px. Source tree:
  `7c2cf798b0a8270a5aa39d8166481bcc3feabb76`. The screenshot shows the current
  public package identity; it does not establish npm publication status.

These are browser captures of product code with synthetic data, not generated
mockups or user conversation captures. Original icon attribution remains in
[NOTICE](../../NOTICE.md).

## 1.3.1 settings captures

`settings-1.3.1.png`, `settings-1.3.1-custom.png` and
`settings-1.3.1-custom-dark.png` are actual settings components from the 1.3.1
implementation delivered with Issue #38, captured by
`scripts/settings-browser.mjs` at 1280px. The default capture is Simplified
Chinese; the custom captures use English and demonstrate six persisted
semantic overrides in light/dark themes. The surrounding host, writable
DSH settings transport and conversation are synthetic. The same run verifies
binding to all six kinds on the actual rail, persisted re-read, reset, errors
and the 390px layout. Publication status is tracked separately.

The earlier `settings.png` remains an archived 1.3.0 capture. Current README
references the versioned 1.3.1 image. Captures use the installed Noto Sans CJK
font as a test-environment font; no font files enter the plugin package.

## Horizontal pointer experiment (#40)

`horizontal-before-after.gif`, `horizontal-entry.png`, and `horizontal-exit.png`
are captures of the actual strip/style code using `scripts/horizontal-capture.mjs`.
The baseline source is fixed to `a8894d17371f7e0843d53cbb5539b4c07bc0de54`;
the experimental source is the reviewed PR tree. Both use the same synthetic
Session and replayed pointer path. The rail is magnified 3×. JavaScript rAF
and native CSS animation samples use a controlled 16ms clock; each image is
played for 80ms (5× slower replay). This illustrates behavior, not FPS, input
latency, Windows host acceptance or production performance. The orange marker
and captions belong to the evidence layout, not the product interface.
