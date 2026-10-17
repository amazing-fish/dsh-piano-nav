/** Actual settings + actual rail, mock DSH settings transport. No user data. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildRailFixture, railHtml } from './rail-browser-fixture.mjs'
const { chromium } = createRequire(path.resolve('.browser-tools/package.json'))('playwright')
const bundle = await buildRailFixture({ settingsPage: true })
await mkdir('test-results', { recursive: true })
const browser = await chromium.launch({ headless: true })
const results = [], errors = []
const html = railHtml.replace('</head>', `<style>
#settings-panel{position:absolute;top:24px;left:430px;width:760px;padding:0 12px 24px;background:#f4f5f7;box-sizing:border-box;z-index:50}
body[data-ds-dark-theme] #settings-panel {background:#15151b;--dsw-alias-bg-layer-2:#24242b;--dsw-alias-label-primary:#f1f1f3;--dsw-alias-label-secondary:#b7bac3;--dsw-alias-border-l2:#444;--dsw-alias-border-l4:#38383f}
@media(max-width:800px){main{display:none}#settings-panel{position:relative;left:0;top:0;width:100%;max-width:100%;padding:12px}}
</style></head>`)
const start = async (options = {}) => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: options.motion ?? 'no-preference' })
  page.setDefaultTimeout(8000)
  page.on('pageerror', e => { errors.push(e.message); console.error(e.message) })
  await page.setContent(html)
  await page.evaluate(opts => Object.assign(window, opts), options)
  await page.addScriptTag({ content: bundle })
  await page.locator('#settings-panel .smcp-color-label input').first().waitFor()
  if (!options.failRead) await page.waitForFunction(() => window.settingsFixture.controller.scope.getSnapshot().status === 'ready')
  return page
}
const label = kind => ({ input: 'User · Input', output: 'AI · Output', question: 'AI · Question', answer: 'User · Answer', final: 'AI · Final result', turn: 'History turn' })[kind]
const edit = async (page, kind, color) => {
  await page.locator(`.smcp-color-label:has(.smcp-legend-key[data-kind="${kind}"]) input`).fill(color)
  await page.waitForFunction(({ field, color }) => window.settingsFixture.persisted()[field] === color, { field: { input:'colorInput',output:'colorOutput',question:'colorQuestion',answer:'colorAnswer',final:'colorFinal',turn:'colorHistory' }[kind], color })
}
const keyColor = locator => locator.evaluate(el => getComputedStyle(el).getPropertyValue('--smcp-key').trim())
try {
  const page = await start({ fixtureSettings: { language: 'en' }, railOptions: { emptyHistoryPrompt: true } })
  await page.waitForFunction(() => window.__smcpDebug?.mode === 'piano')
  const historyKeys = [
    page.locator('.smcp-strip [data-kind="turn"]').first(),
    page.locator('.smcp-legend-key[data-kind="turn"]'),
    page.locator('.smcp-preview-rail [data-kind="turn"]'),
  ]
  const border = locator => locator.evaluate(el => getComputedStyle(el).borderTopColor)
  const assertHistory = async expected => {
    for (const key of historyKeys) {
      assert.equal(await key.getAttribute('data-unloaded'), 'true')
      assert.equal(await key.evaluate(el => getComputedStyle(el).backgroundColor), 'rgba(0, 0, 0, 0)')
      assert.equal(await border(key), expected)
    }
  }
  for (const dark of [false, true]) {
    await page.evaluate(dark => document.body.toggleAttribute('data-ds-dark-theme', dark), dark)
    const normal = dark ? 'rgb(241, 241, 243)' : 'rgb(32, 33, 36)'
    await page.waitForFunction(expected => document.querySelector('.smcp-color-label:has([data-kind="turn"]) input').value === expected, dark ? '#f1f1f3' : '#202124')
    for (const height of [1, 2, 3, 4]) {
      await page.evaluate(height => window.settingsFixture.controller.scope.set('keyHeight', height), height)
      await page.waitForFunction(height => document.querySelector('.smcp-strip [data-kind="turn"]').style.height === `${height}px`, height)
      await assertHistory(normal)
    }
    await page.evaluate(() => window.settingsFixture.controller.scope.set('keyHeight', 2))
    await page.waitForFunction(() => document.querySelector('.smcp-strip [data-kind="turn"]').style.height === '2px')
    const box = await historyKeys[0].boundingBox()
    await page.mouse.move(box.x + 1, box.y + box.height / 2)
    await page.waitForFunction(() => document.querySelector('.smcp-strip [data-kind="turn"]').classList.contains('smcp-bar-hover'))
    assert.equal(await border(historyKeys[0]), dark ? 'rgb(255, 255, 255)' : 'rgb(0, 0, 0)')
    await page.mouse.move(1000, 850)
    await page.waitForFunction(() => !document.querySelector('.smcp-strip [data-kind="turn"]').classList.contains('smcp-bar-hover'))
    await page.locator('#settings-panel').screenshot({ path: `test-results/history-default-${dark ? 'dark' : 'light'}.png` })
  }
  results.push('history defaults, transparent borders and picker agree across rail/legend/preview in both themes and 1–4px heights')
  await edit(page, 'turn', '#000000')
  await assertHistory('rgb(0, 0, 0)')
  await edit(page, 'turn', '#667788')
  await assertHistory('rgb(102, 119, 136)')
  const historyBox = await historyKeys[0].boundingBox()
  await page.mouse.move(historyBox.x + 1, historyBox.y + historyBox.height / 2)
  await page.waitForFunction(() => document.querySelector('.smcp-strip [data-kind="turn"]').classList.contains('smcp-bar-hover'))
  assert.notEqual(await border(historyKeys[0]), 'rgb(102, 119, 136)')
  await page.mouse.move(1000, 850)
  await page.waitForFunction(() => !document.querySelector('.smcp-strip [data-kind="turn"]').classList.contains('smcp-bar-hover'))
  await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'))
  await assertHistory('rgb(102, 119, 136)')
  results.push('custom history borders including black follow the picker in both themes and retain real hover emphasis')
  await page.evaluate(() => window.settingsFixture.controller.scope.set('keyHeight', 2))
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const colorPerf = await page.evaluate(() => ({ ...window.__smcpDebug.perf }))
  const colors = { input:'#dd2244', output:'#008877', question:'#cc6600', answer:'#336699', final:'#aa44cc', turn:'#667788' }
  for (const [kind, color] of Object.entries(colors)) {
    await edit(page, kind, color)
    assert.equal(await keyColor(page.locator(`.smcp-legend-key[data-kind="${kind}"]`)), color)
    assert.equal(await keyColor(page.locator(`.smcp-preview-rail [data-kind="${kind}"]`).first()), color)
    const real = page.locator(`.smcp-strip [data-kind="${kind}"]`).first()
    assert.ok(await real.count(), `actual rail contains ${kind}`)
    assert.equal(await keyColor(real), color)
  }
  for (const counter of ['nodeRebuilds', 'turnRebuilds', 'itemRebuilds']) {
    assert.equal(await page.evaluate(counter => window.__smcpDebug.perf[counter], counter), colorPerf[counter], 'color-only changes do not rebuild navigation')
  }
  results.push('six color controls bind to the legend/preview and all six real rail kinds')
  const realOutput = page.locator('.smcp-strip [data-kind="output"]').first()
  const before = await realOutput.evaluate(el => getComputedStyle(el).backgroundColor)
  const outputBox = await realOutput.boundingBox()
  await page.mouse.move(outputBox.x + 1, outputBox.y + 1)
  await page.waitForFunction(() => document.querySelector('.smcp-strip [data-kind="output"]').classList.contains('smcp-bar-hover'))
  assert.notEqual(await realOutput.evaluate(el => getComputedStyle(el).backgroundColor), before)
  results.push('custom color retains hovered-key emphasis')
  const persisted = await page.evaluate(() => window.settingsFixture.persisted())
  const fresh = await start({ fixtureSettings: persisted })
  await fresh.waitForFunction(() => window.__smcpDebug?.mode === 'piano')
  assert.equal(await keyColor(fresh.locator('.smcp-strip [data-kind="output"]').first()), colors.output)
  assert.equal(await border(fresh.locator('.smcp-strip [data-kind="turn"]').first()), 'rgb(102, 119, 136)')
  await fresh.close(); results.push('fresh settings controller and real rail restore persisted colors')
  await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', 'true'))
  assert.equal(await keyColor(realOutput), colors.output)
  await page.locator('#settings-panel').screenshot({ path: 'test-results/settings-1.3.1-custom-dark.png' })
  await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'))
  await page.locator('#settings-panel').screenshot({ path: 'test-results/settings-1.3.1-custom.png' })
  const preview = page.locator('.smcp-preview-rail')
  await historyKeys[2].click({ position: { x: 1, y: 1 } })
  assert.equal(await historyKeys[2].getAttribute('aria-current'), 'true')
  assert.equal(await page.locator('.smcp-preview-copy strong').innerText(), 'History turn')
  assert.notEqual(await border(historyKeys[2]), 'rgb(102, 119, 136)')
  await page.mouse.move(1000, 850)
  await preview.locator('[data-kind="final"]').click({ position: { x: 1, y: 1 } })
  results.push('preview history current border is emphasized and announces the history label')
  await preview.locator('[data-kind="output"]').click({ position: { x: 1, y: 1 } })
  assert.equal(await preview.locator('[data-kind="output"]').count(), 3)
  await preview.locator('[data-kind="output"]').first().click({ position: { x: 1, y: 1 } })
  assert.equal(await preview.locator('[data-kind="output"]').count(), 3)
  assert.equal(await preview.locator('[data-kind="output"]').first().getAttribute('aria-current'), 'true', 'member navigation preserves the disclosed group')
  await preview.locator('[data-kind="final"]').click({ position: { x: 1, y: 1 } })
  assert.equal(await preview.locator('[data-kind="output"]').count(), 1)
  results.push('preview shares process projection and folds after final activation')
  const writesBeforeReset = await page.evaluate(() => window.settingsFixture.writes.length)
  await page.evaluate(() => { window.failWrite = true })
  await page.getByRole('button', { name: 'Restore default colors', exact: true }).click()
  await page.locator('[role="alert"]:not(:empty)').waitFor()
  assert.equal(await keyColor(realOutput), colors.output)
  assert.equal(await page.evaluate(() => window.settingsFixture.writes.length), writesBeforeReset, 'failed palette reset leaves every override intact')
  await page.evaluate(() => { window.failWrite = false })
  await page.getByRole('button', { name: 'Restore default colors', exact: true }).click()
  await page.waitForFunction(() => !Object.keys(window.settingsFixture.persisted()).some(k => k.startsWith('color')))
  assert.equal(await keyColor(realOutput), '#8a8a8a')
  assert.equal(await page.evaluate(() => window.settingsFixture.persisted().language), 'en')
  assert.equal(await page.evaluate(() => window.settingsFixture.writes.length), writesBeforeReset + 1, 'palette reset is a single mutation')
  assert.equal(await page.evaluate(() => window.settingsFixture.writes.at(-1).length), 6)
  await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', 'true'))
  assert.equal(await keyColor(realOutput), '#e5e5e5')
  assert.equal(await page.locator('.smcp-color-label:has([data-kind="output"]) input').inputValue(), '#e5e5e5')
  await assertHistory('rgb(241, 241, 243)')
  assert.equal(await page.locator('.smcp-color-label:has([data-kind="turn"]) input').inputValue(), '#f1f1f3')
  results.push('color reset preserves other settings and resumes automatic theme colors in keys/legend/picker')
  await page.evaluate(() => { window.failWrite = true })
  await page.locator('.smcp-color-label:has([data-kind="output"]) input').fill('#123456')
  await page.locator('[role="alert"]:not(:empty)').waitFor()
  assert.equal(await keyColor(realOutput), '#e5e5e5')
  await page.evaluate(() => { window.failWrite = false })
  results.push('failed persistence reports an error and keeps the stored color')
  for (const [language, title] of [['zh', '琴键颜色与图例'], ['zh-TW', '琴鍵顏色與圖例'], ['en', 'Key colors and legend']]) {
    await page.locator('.smcp-settings-select').selectOption(language)
    await page.getByRole('heading', { name: title, exact: true }).waitFor()
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const expected = { zh: '第 2 轮', 'zh-TW': '第 2 輪', en: 'Turn 2' }[language]
    const history = page.locator('.smcp-strip [data-kind="turn"]')
    assert.ok((await history.getAttribute('aria-label')).endsWith(`: ${expected}`), 'cached empty-prompt history title follows the selected language')
    const box = await history.boundingBox(); await page.mouse.move(box.x + 1, box.y + 1)
    await page.waitForFunction(() => document.querySelector('.smcp-tooltip').classList.contains('smcp-tooltip-visible'))
    assert.equal(await page.locator('.smcp-tooltip-title').innerText(), expected)
  }
  results.push('three languages share the same semantic controls')
  await page.getByRole('button', { name: 'Restore defaults', exact: true }).click()
  await page.getByRole('heading', { name: '琴键颜色与图例', exact: true }).waitFor()
  assert.deepEqual(await page.evaluate(() => window.settingsFixture.persisted()), {})
  await page.evaluate(() => document.body.removeAttribute('data-ds-dark-theme'))
  await page.locator('#settings-panel').screenshot({ path: 'test-results/settings-1.3.1-default.png' })
  await page.screenshot({ path: 'test-results/settings-1.3.1-with-rail.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 900 })
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true)
  await page.locator('#settings-panel').screenshot({ path: 'test-results/settings-1.3.1-mobile.png' })
  results.push('full reset clears new fields, 390px layout has no horizontal overflow')
  await page.close()
  const blocked = await start({ historyOnly: true, fixtureSettings: { language: 'en', colorHistory: '#667788' } })
  await blocked.waitForFunction(() => window.__smcpDebug?.mode === 'piano')
  await blocked.evaluate(() => document.querySelector('nav [aria-label="Load 1"]').remove())
  await blocked.waitForFunction(() => document.querySelector('.smcp-strip [data-key="turn:1"]').disabled)
  const disabledHistory = blocked.locator('.smcp-strip [data-key="turn:1"]')
  assert.equal(await border(disabledHistory), 'rgb(102, 119, 136)')
  assert.equal(await disabledHistory.evaluate(el => getComputedStyle(el).opacity), '0.3')
  await blocked.close()
  results.push('unavailable history retains its custom border and existing disabled opacity')
  for (const options of [{ readOnly: true }, { failRead: true }, { motion: 'reduce' }]) {
    const p = await start(options)
    if (options.readOnly || options.failRead) {
      assert.equal(await p.locator('#settings-panel input:enabled, #settings-panel select:enabled').count(), 0)
      if (options.failRead) assert.equal(await p.locator('.smcp-strip').count(), 0)
    } else {
      const input = p.locator('.smcp-color-label input').first(); await input.focus(); assert.equal(await input.evaluate(el => document.activeElement === el), true)
      assert.equal(await p.locator('.smcp-preview-rail .smcp-bar').first().evaluate(el => getComputedStyle(el).transitionDuration), '0s')
    }
    await p.close()
  }
  results.push('read-only/read-failure controls, fail-closed rail, keyboard focus and reduced motion')
  assert.deepEqual(errors, [])
  await writeFile('test-results/settings-browser.json', JSON.stringify({ passed: results.length, source: 'Actual settings component and strip; synthetic DSH remote transport and conversation', results }, null, 2))
} finally { await browser.close() }
console.log(`${results.length} settings Chromium scenarios passed`)
