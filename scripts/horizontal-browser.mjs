/** Actual strip, trusted pointer input, controlled rAF clock, synthetic Session. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildRailFixture, railHtml } from './rail-browser-fixture.mjs'
const tools = createRequire(path.resolve('.browser-tools/package.json'))
const { chromium } = tools('playwright')
const browser = await chromium.launch({ headless: true })
const bundle = await buildRailFixture({ sourceRef: process.env.HOVER_SOURCE_REF })
const results = []
let readerBaseAcquisition
const snapshot = (page, key) => page.evaluate(key => {
  const bar = [...document.querySelectorAll('.smcp-bar')].find(el => el.dataset.key === key)
  return { width: bar.getBoundingClientRect().width, selected: document.querySelector('.smcp-bar-hover')?.dataset.key,
    preview: document.querySelector('.smcp-tooltip').textContent, visible: !!document.querySelector('.smcp-tooltip-visible'),
    perf: { ...window.__smcpDebug.perf }, clicks: [...window.railFixture.clicks] }
}, key)
try {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
    await page.setContent(railHtml)
    await page.evaluate(() => { window.historyOnly = true })
    await page.addScriptTag({ content: bundle })
    await page.clock.pauseAt(new Date('2026-01-01T00:00:10Z'))
    await page.clock.runFor(64)
    assert.equal(await page.evaluate(() => window.__smcpDebug.mode), 'piano')
    const p = await page.locator('.smcp-bar[data-key="turn:4"]').evaluate(el => {
      const r = el.getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, key: el.dataset.key }
    })
    const move = async x => { await page.mouse.move(p.x + x, p.y); await page.clock.runFor(16) }
    const state = () => snapshot(page, p.key)
    await move(14)
    assert.equal((await state()).selected, undefined, 'a right-side approach cannot acquire an unpainted wave')
    await move(1)
    const entering = await state()
    assert.equal(entering.selected, p.key)
    if (reducedMotion === 'reduce') assert.ok(entering.width > 47)
    else assert.ok(entering.width < 11, 'first entry frame starts at base instead of snapping to 48')
    const widths = []
    for (let i = 0; i < 7; i++) { await page.clock.runFor(16); widths.push((await state()).width) }
    assert.ok(widths.at(-1) > 47)
    if (reducedMotion !== 'reduce') {
      assert.ok(new Set(widths).size >= 4)
      assert.ok(widths.every((w, i) => i === 0 || w >= widths[i - 1]))
    }
    results.push(`finite entry and reduced motion: ${reducedMotion}`)
    const steady = await state()
    for (const x of [3, 7, 11, 30, 45, 30, 3]) {
      await move(x)
      const hovered = await state()
      assert.equal(hovered.selected, p.key, 'moving inside the expanded painted key retains hover')
      assert.equal(hovered.visible, true, 'painted-key hover retains the semantic preview')
      assert.equal(hovered.preview, steady.preview)
    }
    for (const counter of ['nodeRebuilds','itemRebuilds','turnRebuilds','domReconciles','mappedAnchorRebuilds','railProjections','hitTests']) {
      assert.equal((await state()).perf[counter], steady.perf[counter], `${counter} stays outside horizontal-only work`)
    }
    await move(52)
    const exit = await state()
    assert.equal(exit.selected, undefined, 'exit occurs beyond the painted key and its 3px tolerance')
    assert.equal(exit.visible, false, 'retirement has no semantic preview lease')
    if (reducedMotion !== 'reduce') assert.ok(exit.width > 40, 'visual exit starts from its current width')
    await page.clock.runFor(32)
    const retiring = await state()
    await move(1)
    const returning = await state()
    assert.equal(returning.selected, p.key)
    if (reducedMotion !== 'reduce') {
      // The next 16ms frame first advances retirement to the event time.
      assert.ok(returning.width > 10 && returning.width <= retiring.width, 'reversal neither snaps full nor restarts at zero')
      await page.clock.runFor(16)
      assert.ok((await state()).width > returning.width, 'the next frame grows immediately toward the new target')
    }
    await page.clock.runFor(128)
    assert.ok((await state()).width > 47)
    results.push(`painted boundary, preview, lightweight X-only work and interrupted exit: ${reducedMotion}`)
    // Click resolves its own painted geometry after flushing pending input.
    await page.evaluate(p => {
      const rail = document.querySelector('.smcp-unified')
      rail.dispatchEvent(new PointerEvent('pointermove', { clientX: p.x + 22, clientY: p.y }))
      rail.dispatchEvent(new MouseEvent('click', { clientX: p.x + 22, clientY: p.y, bubbles: true }))
    }, p)
    assert.deepEqual((await state()).clicks, [4], 'the expanded hovered key is clickable with either motion preference')
    await page.clock.runFor(160)
    await page.mouse.move(1100, 850); await page.clock.runFor(160)
    const idle = await state()
    await page.clock.runFor(500)
    assert.equal((await state()).perf.renders, idle.perf.renders, 'finished envelope has no idle loop')
    await move(1)
    await page.evaluate(p => {
      const rail = document.querySelector('.smcp-unified')
      rail.dispatchEvent(new MouseEvent('click', { clientX: p.x + 55, clientY: p.y, bubbles: true }))
      rail.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }))
    }, p)
    await page.clock.runFor(160)
    assert.equal((await state()).selected, 'turn:1', 'keyboard cancels the pointer envelope')
    assert.deepEqual((await state()).clicks, idle.clicks, 'blank margin cannot navigate')
    await page.evaluate(() => { for (const animation of document.getAnimations()) animation.finish() })
    const first = page.locator('.smcp-bar[data-key="turn:1"]')
    const firstBox = await first.boundingBox()
    await page.mouse.move(firstBox.x + 1, firstBox.y + firstBox.height / 2)
    await page.clock.runFor(16)
    assert.ok((await first.boundingBox()).width > 47, 'mouse acquisition preserves the settled keyboard width')
    assert.deepEqual(errors, [])
    results.push(`painted clicks, blank margin, keyboard ownership and finite idle: ${reducedMotion}`)
    await page.close()
  }
  for (const deviceScaleFactor of [1, 1.25, 1.5]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, deviceScaleFactor, reducedMotion: 'reduce' })
    await page.setContent(railHtml); await page.evaluate(() => { window.historyOnly = true; document.body.setAttribute('data-ds-dark-theme', '') })
    await page.addScriptTag({ content: bundle }); await page.waitForFunction(() => window.__smcpDebug?.mode === 'piano')
    const p = await page.locator('.smcp-bar[data-key="turn:4"]').boundingBox()
    await page.mouse.move(p.x + 1, p.y + p.height / 2)
    await page.waitForFunction(() => document.querySelector('.smcp-bar-hover')?.dataset.key === 'turn:4')
    await page.mouse.move(p.x + 40, p.y + p.height / 2)
    await page.waitForFunction(() => document.querySelector('.smcp-bar-hover')?.dataset.key === 'turn:4')
    await page.mouse.move(p.x + 52, p.y + p.height / 2)
    await page.waitForFunction(() => document.querySelector('.smcp-bar-hover') === null)
    const reading = await page.locator('.smcp-bar-current').evaluate(el => {
      const r = el.getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2, key: el.dataset.key }
    })
    await page.mouse.move(reading.x + 1, reading.y)
    await page.waitForFunction(key => document.querySelector('.smcp-bar-hover')?.dataset.key === key, reading.key)
    await page.mouse.move(reading.x + 35, reading.y)
    await page.waitForFunction(key => document.querySelector('.smcp-bar-hover')?.dataset.key === key, reading.key)
    await page.mouse.move(reading.x + 52, reading.y)
    await page.waitForFunction(() => document.querySelector('.smcp-bar-hover') === null)
    results.push(`dark theme painted boundary at device scale ${deviceScaleFactor}`)
    await page.close()
  }
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
    await page.setContent(railHtml); await page.addScriptTag({ content: bundle })
    await page.clock.pauseAt(new Date('2026-01-01T00:00:10Z')); await page.clock.runFor(160)
    await page.evaluate(() => {
      for (const animation of document.getAnimations()) animation.finish()
      // p3 is the retained representative of the collapsed process group.
      window.railFixture.scroll.scrollTop = 200
      window.railFixture.scroll.dispatchEvent(new Event('scroll'))
    })
    await page.clock.runFor(16)
    const acquisition = await page.evaluate(() => {
      const bar = document.querySelector('.smcp-bar-current')
      const transition = bar.getAnimations().find(a => a.transitionProperty === 'width')
      if (!transition) throw Error('reader change must create a real native width transition')
      transition.pause(); transition.currentTime = 12
      const box = bar.getBoundingClientRect()
      return { key: bar.dataset.key, painted: box.width, x: box.x + 1, y: box.y + box.height / 2 }
    })
    assert.ok(acquisition.painted > 10 && acquisition.painted < 24)
    await page.mouse.move(acquisition.x, acquisition.y); await page.clock.runFor(16)
    const acquired = await snapshot(page, acquisition.key)
    assert.equal(acquired.selected, acquisition.key)
    assert.ok(Math.abs(acquired.width - acquisition.painted) < .04,
      `reader-to-pointer acquisition preserves sub-base paint: ${acquisition.painted} -> ${acquired.width}`)
    assert.ok(await page.locator('.smcp-bar:not(.smcp-bar-current)').evaluateAll(els => els.every(el => el.getBoundingClientRect().width >= 10)), 'signed entry cannot shrink ordinary keys below their base')
    readerBaseAcquisition = { before: acquisition.painted, acquired: acquired.width }
    const widths = [acquired.width]
    for (let i = 0; i < 7; i++) { await page.clock.runFor(16); widths.push((await snapshot(page, acquisition.key)).width) }
    assert.ok(widths.every((w, i) => i === 0 || w >= widths[i - 1]))
    assert.ok(widths.at(-1) > 47)
    await page.mouse.move(acquisition.x + 29, acquisition.y); await page.clock.runFor(16)
    assert.equal((await snapshot(page, acquisition.key)).selected, acquisition.key, 'expanded reading key retains hover at 30px')
    await page.mouse.move(1100, 850); await page.clock.runFor(160)
    const retired = await snapshot(page, acquisition.key)
    assert.ok(Math.abs(retired.width - 24) < .04)
    await page.clock.runFor(500)
    assert.equal((await snapshot(page, acquisition.key)).perf.renders, retired.perf.renders)
    results.push('reading-key CSS base transition hands its actual narrower paint to the pointer')
    await page.close()
  }
  await mkdir('test-results', { recursive: true })
  await writeFile('test-results/horizontal-browser.json', JSON.stringify({ passed: results.length, source: 'Actual strip, controlled animation-frame clock and trusted mouse input; synthetic Session; scale is device pixel ratio, not complete Windows host acceptance', readerBaseAcquisition, results }, null, 2))
} finally { await browser.close() }
console.log(`${results.length} horizontal Chromium scenarios passed`)
