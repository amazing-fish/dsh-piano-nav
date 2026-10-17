/** Actual color controls and remote queue; identical timed drag on fixed baseline/current source. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildRailFixture, railHtml } from './rail-browser-fixture.mjs'
const { chromium } = createRequire(path.resolve('.browser-tools/package.json'))('playwright')
const sourceRef = process.env.COLOR_SAVE_SOURCE_REF
const bundle = await buildRailFixture({ settingsPage: true, sourceRef })
const browser = await chromium.launch({ headless: true })
const measurements = [], results = [], errors = []
const html = railHtml.replace('</head>', '<style>main{display:none}#settings-panel{width:min(760px,100%);padding:12px;box-sizing:border-box}</style></head>')
const start = async options => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  page.on('pageerror', e => errors.push(e.message))
  await page.setContent(html)
  await page.evaluate(options => Object.assign(window, { fixtureSettings: { language: 'en' }, writeDelay: 250 }, options), options)
  await page.addScriptTag({ content: bundle })
  await page.waitForFunction(() => window.settingsFixture?.controller.scope.getSnapshot().status === 'ready')
  await page.locator('.smcp-color-label input').first().waitFor()
  return page
}
try {
  await mkdir('test-results', { recursive: true })
  for (const [field, kind] of [['colorInput', 'input'], ['colorOutput', 'output'], ['colorHistory', 'turn']]) {
    const page = await start({})
    const timing = await page.evaluate(async ({ field, kind }) => {
      const input = document.querySelector(`.smcp-color-label:has([data-kind="${kind}"]) input`)
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      const start = performance.now(), events = []
      for (let i = 1; i <= 8; i++) {
        const color = `#${String(i).repeat(6)}`
        setter.call(input, color); input.dispatchEvent(new Event('input', { bubbles: true }))
        events.push({ color, at: performance.now() })
        if (input.value !== color) throw new Error('picker restored a stale value')
        if (i < 8) await new Promise(resolve => setTimeout(resolve, 60))
      }
      // The actual host-backed source becomes effective when its write completes.
      await new Promise(resolve => {
        const scope = window.settingsFixture.controller.scope
        if (scope.getSnapshot().value[field] === '#888888') return resolve()
        const stop = scope.subscribe(() => { if (scope.getSnapshot().value[field] === '#888888') { stop(); resolve() } })
      })
      const writes = window.settingsFixture.writeTimings
      const last = writes.at(-1)
      return { field, inputEvents: events.length, writes: writes.length, inputSpanMs: events.at(-1).at - start,
        effectiveMs: last.finishedAt - start, afterLastInputMs: last.finishedAt - events.at(-1).at,
        queueWaitMs: last.startedAt - events.at(-1).at,
        singleWriteMs: last.finishedAt - last.startedAt, values: writes.map(w => w.ops[0].value) }
    }, { field, kind })
    measurements.push(timing)
    await page.waitForFunction(({ kind }) => document.querySelector(`.smcp-color-label:has([data-kind="${kind}"]) input`).value === '#888888', { kind })
    assert.equal(await page.locator(`.smcp-legend-key[data-kind="${kind}"]`).evaluate(el => getComputedStyle(el).getPropertyValue('--smcp-key').trim()), '#888888')
    if (!sourceRef) {
      assert.ok(timing.writes <= 3, JSON.stringify(timing))
      assert.ok(timing.queueWaitMs <= 300, JSON.stringify(timing))
    }
    await page.close()
  }
  results.push(sourceRef ? 'Baseline measurement: 8 native input events at 60ms spacing with 250ms transport for input/output/history' : '8 native input events at 60ms spacing with 250ms transport: at most 3 actual writes and final queue wait <=300ms for input/output/history')
  if (!sourceRef) {
    // Larger synchronous bursts cannot grow the pending same-field backlog.
    for (const count of [8, 80]) {
      const page = await start({})
      await page.evaluate(count => {
        const input = document.querySelector('.smcp-color-label input')
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
        for (let i = 1; i <= count; i++) { setter.call(input, `#${i.toString(16).padStart(6, '0')}`); input.dispatchEvent(new Event('input', { bubbles: true })) }
      }, count)
      await page.waitForFunction(color => window.settingsFixture.persisted().colorInput === color, `#${count.toString(16).padStart(6, '0')}`)
      assert.equal(await page.evaluate(() => window.settingsFixture.writes.length), 1)
      await page.close()
    }
    results.push('8/80-input synchronous bursts persist only the final value once')
    const page = await start({ failWrite: true, writeErrorCode: 'settings/rejected', writeErrorMessage: 'Config field "colorInput" is not volatile' })
    const warnings = []
    page.on('console', message => {
      if (message.type() === 'warning') warnings.push(Promise.all(message.args().map(arg => arg.evaluate(x => x && typeof x === 'object' ? { message: x.message, code: x.code } : x))))
    })
    await page.locator('.smcp-color-label input').first().fill('#123456')
    await page.locator('[role="alert"]:not(:empty)').waitFor()
    const records = await Promise.all(warnings)
    assert.ok(records.some(record => record[1]?.code === 'settings/rejected' && record[1]?.message.includes('not volatile')))
    assert.equal(await page.locator('[role="alert"]').innerText(), 'Could not save the setting. Try again.')
    await page.close()
    results.push('console warning retains rejection code/message while UI shows the localized save failure')
  }
  assert.deepEqual(errors, [])
} finally {
  await writeFile(`test-results/color-save-${sourceRef ? 'before' : 'after'}.json`, JSON.stringify({ sourceRef: sourceRef ?? 'working tree', environment: 'Linux Chromium; actual UI; timed synthetic DSH transport, not real host/disk latency', results, measurements }, null, 2))
  await browser.close()
}
console.log(JSON.stringify({ results, measurements }, null, 2))
