/** Actual React/rail UI with held persistence and a deliberately tinted host layer. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildRailFixture, railHtml } from './rail-browser-fixture.mjs'
const { chromium } = createRequire(path.resolve('.browser-tools/package.json'))('playwright')
const baseline = process.env.EXPECT_BASELINE === '1', tag = baseline ? 'before' : 'after'
const bundle = await buildRailFixture({ settingsPage: true, sourceRef: process.env.COLOR_SOURCE_REF })
const browser = await chromium.launch({ headless: true }), results = [], errors = []
await mkdir('test-results', { recursive: true })
const html = railHtml.replace('</head>', `<style>
  #settings-panel{position:absolute;top:24px;left:430px;width:760px;padding:0 12px 24px;background:#f4f5f7;box-sizing:border-box}
  body[data-ds-dark-theme]{--dsw-alias-label-primary:#f1f1f3;--dsw-alias-label-secondary:#b7bac3}
</style></head>`)
const check = async (name, run, options = {}) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: options.motion ?? 'reduce' })
  page.setDefaultTimeout(5000); page.on('pageerror', e => errors.push(e.message))
  try {
    await page.setContent(html)
    await page.evaluate(options => {
      Object.assign(window, { holdWrites: true, fixtureSettings: { language: 'en', colorInput: '#123456', colorOutput: '#654321', ...options.settings } })
      document.body.toggleAttribute('data-ds-dark-theme', options.dark === true)
      document.body.style.setProperty('--dsw-alias-bg-layer-2', '#ffffe1')
    }, options)
    await page.addScriptTag({ content: bundle })
    await page.waitForFunction(() => window.settingsFixture?.controller.scope.getSnapshot().status === 'ready' && window.__smcpDebug?.mode === 'piano')
    await run(page); results.push({ name, passed: true })
  } catch (e) { results.push({ name, passed: false, error: e.message }); if (!baseline) throw e }
  finally { await page.close() }
}
const row = (page, kind) => page.locator(`.smcp-color-row:has([data-kind="${kind}"])`)
const inputColor = (page, kind, color) => row(page, kind).locator('input').evaluate((el, value) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, value)
  el.dispatchEvent(new Event('input', { bubbles: true }))
}, color)
const frame = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => resolve())))
const shown = (page, kind) => page.evaluate(kind => {
  const key = prefix => getComputedStyle(document.querySelector(`${prefix}[data-kind="${kind}"]`)).getPropertyValue('--smcp-key').trim()
  return { picker: document.querySelector(`.smcp-color-row:has([data-kind="${kind}"]) input`).value,
    legend: key('.smcp-legend-key'), preview: key('.smcp-preview-rail .smcp-bar'), rail: key('.smcp-strip .smcp-bar'),
    persisted: window.settingsFixture.persisted()[kind === 'turn' ? 'colorHistory' : `color${kind[0].toUpperCase()}${kind.slice(1)}`],
    writes: window.settingsFixture.writes.length, status: document.querySelector('.smcp-settings-feedback [role="status"]').textContent }
}, kind)
const assertPalette = (state, color) => { for (const part of ['picker', 'legend', 'preview', 'rail']) assert.equal(state[part], color, `${part} follows the latest intent before persistence`) }
const release = async (page, index, fail = false) => {
  await page.waitForFunction(index => typeof window.settingsFixture.writeTimings[index]?.release === 'function', index)
  await page.evaluate(({ index, fail }) => { window.failWrite = fail; window.settingsFixture.writeTimings[index].release() }, { index, fail })
  if (fail) await page.locator('[role="alert"]:not(:empty)').waitFor()
  else await page.waitForFunction(index => !!window.settingsFixture.writeTimings[index].finishedAt, index)
  await frame(page)
}
try {
  for (const dark of [false, true]) for (const kind of ['input', 'output', 'turn']) {
    await check(`${kind} live edit and automatic stay synchronized (${dark ? 'dark' : 'light'})`, async page => {
      const defaultColor = { input: dark ? '#60a5fa' : '#2563eb', output: dark ? '#e5e5e5' : '#8a8a8a', turn: dark ? '#f1f1f3' : '#202124' }[kind]
      await inputColor(page, kind, '#008877'); await frame(page)
      let state = await shown(page, kind); assertPalette(state, '#008877'); assert.equal(state.writes, 0)
      assert.equal(state.status, 'Saving colors…')
      await row(page, kind).locator('.smcp-color-auto').click(); await frame(page)
      state = await shown(page, kind); assertPalette(state, defaultColor); assert.equal(state.writes, 0)
      assert.equal(await row(page, kind).locator('.smcp-color-auto').isDisabled(), true)
      await release(page, 0)
      assertPalette(await shown(page, kind), defaultColor)
      await release(page, 1)
      assert.equal((await shown(page, kind)).persisted, '')
      assert.equal((await shown(page, kind)).status, '')
    }, { dark })
  }
  await check('failed automatic selection rolls back every surface', async page => {
    await row(page, 'input').locator('.smcp-color-auto').click(); await frame(page)
    assertPalette(await shown(page, 'input'), '#2563eb')
    await release(page, 0, true)
    assertPalette(await shown(page, 'input'), '#123456')
    assert.equal((await shown(page, 'input')).persisted, '#123456')
  })
  await check('automatic preview follows theme changes while saving', async page => {
    await row(page, 'input').locator('.smcp-color-auto').click(); await frame(page)
    assertPalette(await shown(page, 'input'), '#2563eb')
    await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', ''))
    await frame(page)
    assertPalette(await shown(page, 'input'), '#60a5fa')
    assert.equal((await shown(page, 'input')).writes, 0)
    await release(page, 0)
    assertPalette(await shown(page, 'input'), '#60a5fa')
  })
  await check('palette reset previews immediately and failure restores confirmed colors', async page => {
    await page.getByRole('button', { name: 'Restore default colors', exact: true }).click(); await frame(page)
    assertPalette(await shown(page, 'input'), '#2563eb'); assertPalette(await shown(page, 'output'), '#8a8a8a')
    await release(page, 0, true)
    assertPalette(await shown(page, 'input'), '#123456'); assertPalette(await shown(page, 'output'), '#654321')
  })
  await check('older failed edit cannot replace a later edit or automatic preview', async page => {
    await inputColor(page, 'input', '#008877'); await frame(page)
    assertPalette(await shown(page, 'input'), '#008877')
    await inputColor(page, 'input', '#dd2244'); await frame(page)
    await release(page, 0, true)
    assertPalette(await shown(page, 'input'), '#dd2244')
    await page.evaluate(() => { window.failWrite = false })
    await row(page, 'input').locator('.smcp-color-auto').click(); await frame(page)
    await release(page, 1)
    assertPalette(await shown(page, 'input'), '#2563eb')
    await release(page, 2)
    assertPalette(await shown(page, 'input'), '#2563eb')
  })
  for (const dark of [false, true]) await check(`neutral tooltip over a yellow host layer (${dark ? 'dark' : 'light'})`, async page => {
    const bar = page.locator('.smcp-strip .smcp-bar[data-kind="input"]').first(), box = await bar.boundingBox()
    await page.mouse.move(box.x + 1, box.y + box.height / 2)
    const tooltip = page.locator('.smcp-tooltip-visible'); await tooltip.waitFor()
    const color = await tooltip.evaluate(el => getComputedStyle(el).backgroundColor)
    await tooltip.screenshot({ path: `test-results/tooltip-${tag}-${dark ? 'dark' : 'light'}.png` })
    assert.equal(color, dark ? 'rgba(35, 35, 39, 0.98)' : 'rgba(255, 255, 255, 0.98)')
    await page.emulateMedia({ forcedColors: 'active' })
    assert.notEqual(await tooltip.evaluate(el => getComputedStyle(el).forcedColorAdjust), 'none', 'system contrast remains available')
  }, { dark })
  assert.deepEqual(errors, [])
} finally {
  await writeFile(`test-results/color-response-${tag}.json`, JSON.stringify({ source: 'Actual components; controlled settings transport; synthetic session/native-style input; injected host yellow, not a capture of the user machine CSS', results }, null, 2))
  await browser.close()
}
if (baseline) assert.ok(results.every(r => !r.passed), 'targeted immediate-preview and neutral-surface regressions fail on the old product')
console.log(`${results.length} color response Chromium scenarios ${baseline ? 'fail on the old product as expected' : 'passed'}`)
