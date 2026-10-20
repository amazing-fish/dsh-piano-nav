/** #44: actual components, synthetic color-picker events and delayed settings transport. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildRailFixture, railHtml } from './rail-browser-fixture.mjs'
const { chromium } = createRequire(path.resolve('.browser-tools/package.json'))('playwright')
const bundle = await buildRailFixture({ settingsPage: true })
const baseline = process.env.EXPECT_BASELINE === '1'
const tag = baseline ? 'before' : 'after'
await mkdir('test-results', { recursive: true })
const browser = await chromium.launch({ headless: true })
const results = [], errors = []
const html = railHtml.replace('</head>', `<style>
#settings-panel{position:absolute;top:24px;left:430px;width:760px;padding:0 12px 24px;background:#f4f5f7;box-sizing:border-box;z-index:50}
body[data-ds-dark-theme] #settings-panel{background:#15151b;--dsw-alias-bg-layer-2:#24242b;--dsw-alias-label-primary:#f1f1f3;--dsw-alias-label-secondary:#b7bac3;--dsw-alias-border-l2:#444;--dsw-alias-border-l4:#38383f}
@media(max-width:800px){main{display:none}#settings-panel{position:relative;left:0;top:0;width:100%;padding:12px}}
</style></head>`)
const start = async (options = {}) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
  page.setDefaultTimeout(5000)
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent(html)
  await page.evaluate(options => Object.assign(window, options), { fixtureSettings: { language: 'en' }, ...options })
  await page.addScriptTag({ content: bundle })
  await page.waitForFunction(() => window.settingsFixture?.controller.scope.getSnapshot().status === 'ready' && window.__smcpDebug?.mode === 'piano')
  return page
}
const check = async (name, run, options) => {
  const page = await start(options)
  try { await run(page); results.push({ name, passed: true }) }
  catch (error) { results.push({ name, passed: false, error: error.message }); if (!baseline) throw error }
  finally { await page.close() }
}
const click = async (page, locator) => {
  const box = await locator.boundingBox(); assert.ok(box)
  await page.mouse.click(box.x + 1, box.y + box.height / 2)
}
// Match the DOM input event emitted by a native chooser, without Playwright's paired fill/change.
const inputColor = (input, color) => input.evaluate((element, color) => {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(element, color)
  element.dispatchEvent(new Event('input', { bubbles: true }))
  return element.value
}, color)
try {
  await check('compact preview reserves expanded demo keys rather than maxVisible capacity', async page => {
    await page.locator('#settings-panel').screenshot({ path: `test-results/feedback-settings-${tag}.png` })
    const preview = page.locator('.smcp-preview-rail')
    const height = (await preview.boundingBox()).height
    assert.equal(height, 86, 'reserve eight demo keys at 12px pitch and 2px thickness')
    assert.equal(await preview.locator('button').count(), 6, 'collapsed demo still shows six keys')
    await preview.locator('[data-kind="output"]').click({ position: { x: 1, y: 1 } })
    assert.equal((await preview.boundingBox()).height, 86, 'eight expanded demo keys')
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.locator('#settings-panel').screenshot({ path: `test-results/feedback-settings-${tag}-${width}.png` })
    }
  })
  for (const motion of ['no-preference', 'reduce']) await check(`same-group gray member navigation keeps expansion (${motion})`, async page => {
    await page.emulateMedia({ reducedMotion: motion })
    const outputs = turn => page.locator(`.smcp-strip [data-kind="output"][data-turn="${turn}"]`)
    await click(page, outputs(1)); await page.waitForFunction(() => document.querySelectorAll('.smcp-strip [data-kind="output"][data-turn="1"]').length === 3)
    await click(page, outputs(1).nth(1))
    await page.waitForFunction(() => window.railFixture.clicks.length === 2)
    // Navigation must finish before examining the projected rail.
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    assert.equal(await outputs(1).count(), 3)
    await click(page, outputs(1).nth(2))
    await page.waitForFunction(() => window.railFixture.clicks.length === 3)
    await page.keyboard.press('Home'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter')
    await page.waitForFunction(() => window.railFixture.clicks.length === 4)
    assert.equal(await outputs(1).count(), 3)
    assert.deepEqual(await page.evaluate(() => window.railFixture.clicks), [1, 1, 1, 1])
    await click(page, outputs(2)); await page.waitForFunction(() => document.querySelectorAll('.smcp-strip [data-kind="output"][data-turn="2"]').length === 3)
    assert.equal(await outputs(1).count(), 1, 'switching groups retires only the old group')
    await page.keyboard.press('Escape'); await page.waitForFunction(() => document.querySelectorAll('.smcp-strip [data-kind="output"][data-turn="2"]').length === 1)
  }, { railOptions: { hidden: true, processCount: 3, processGroups: 2 } })
  await check('preview gray members retain expansion until another semantic key', async page => {
    const preview = page.locator('.smcp-preview-rail'), outputs = preview.locator('[data-kind="output"]')
    await click(page, outputs); await click(page, outputs.nth(1))
    assert.equal(await outputs.count(), 3)
    await click(page, outputs.nth(2)); assert.equal(await outputs.count(), 3)
    await click(page, preview.locator('[data-kind="final"]')); assert.equal(await outputs.count(), 1)
  })
  for (const kind of ['output', 'turn']) await check(`${kind} native color input retains draft across delayed acknowledgments and persists the latest selection`, async page => {
    const field = kind === 'turn' ? 'colorHistory' : 'colorOutput'
    const property = kind === 'turn' ? 'borderTopColor' : 'backgroundColor'
    const input = page.locator(`.smcp-color-label:has([data-kind="${kind}"]) input`)
    assert.equal(await inputColor(input, '#dd2244'), '#dd2244', 'controlled input must not restore the old color while awaiting the host')
    await page.waitForFunction(() => window.settingsFixture.writeTimings.length === 1)
    assert.equal(await inputColor(input, '#008877'), '#008877')
    await page.waitForFunction(field => window.settingsFixture.persisted()[field] === '#dd2244', field)
    assert.equal(await input.inputValue(), '#008877', 'older acknowledgment cannot replace the latest draft')
    await page.waitForFunction(field => window.settingsFixture.persisted()[field] === '#008877', field)
    for (const prefix of ['.smcp-legend-key', '.smcp-preview-rail .smcp-bar', '.smcp-strip .smcp-bar']) {
      const selector = `${prefix}[data-kind="${kind}"]`
      await page.waitForFunction(({ selector, property }) => getComputedStyle(document.querySelector(selector))[property] === 'rgb(0, 136, 119)', { selector, property })
    }
    await page.evaluate(() => { window.failWrite = true })
    assert.equal(await inputColor(input, '#123456'), '#123456')
    await page.locator('[role="alert"]:not(:empty)').waitFor()
    await page.waitForFunction(kind => document.querySelector(`.smcp-color-label:has([data-kind="${kind}"]) input`).value === '#008877', kind)
  }, { writeDelay: 250 })
  for (const kind of ['output', 'turn']) await check(`${kind} color picker opens only from the 32px swatch, not semantic text or row whitespace`, async page => {
    const row = page.locator(`.smcp-color-label:has([data-kind="${kind}"])`)
    const input = row.locator('input'), box = await input.boundingBox()
    assert.equal(box.width, 32); assert.equal(box.height, 32)
    await input.evaluate(element => { window.colorClicks = 0; element.addEventListener('click', event => { window.colorClicks++; event.preventDefault() }) })
    await row.locator('span').nth(1).click()
    assert.equal(await page.evaluate(() => window.colorClicks), 0)
    await input.click(); assert.equal(await page.evaluate(() => window.colorClicks), 1)
  })
  assert.deepEqual(errors, [])
} finally {
  await writeFile(`test-results/feedback-${tag}.json`, JSON.stringify({ source: 'Actual React settings and rail; synthetic sessions, native-style input events and delayed remote transport; no Windows chooser automation', results }, null, 2))
  await browser.close()
}
console.log(JSON.stringify(results, null, 2))
if (baseline) assert.ok(results.every(result => !result.passed), 'each targeted regression must fail on the unmodified product')
