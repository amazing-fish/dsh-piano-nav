/** Real pointer trajectories, input races, painted hit zones and hot-path work. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildRailFixture, railHtml } from './rail-browser-fixture.mjs'
const tools = createRequire(path.resolve('.browser-tools/package.json'))
const { chromium } = tools('playwright')
const bundle = await buildRailFixture()
const browser = await chromium.launch({ headless: true })
await mkdir('test-results', { recursive: true })
const results = []
const settle = page => page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
const snapshot = page => page.evaluate(() => ({
  selected: document.querySelector('.smcp-bar-hover')?.dataset.key,
  described: document.querySelector('.smcp-unified')?.getAttribute('aria-activedescendant'),
  preview: document.querySelector('.smcp-tooltip')?.textContent,
  following: document.querySelector('.smcp-pointer-follow') !== null,
  visible: document.querySelector('.smcp-tooltip-visible') !== null,
  perf: { ...window.__smcpDebug?.perf },
  bars: [...document.querySelectorAll('.smcp-bar')].map(el => ({ key: el.dataset.key, width: Number.parseFloat(el.style.width), painted: el.getBoundingClientRect().width, transition: getComputedStyle(el).transitionProperty })),
}))
const open = async reducedMotion => {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion })
  const errors = []; page.on('pageerror', error => errors.push(error.message))
  await page.setContent(railHtml)
  await page.evaluate(() => { window.historyOnly = true })
  await page.addScriptTag({ content: bundle })
  await page.waitForFunction(() => window.__smcpDebug?.mode === 'piano')
  await settle(page)
  const points = await page.locator('.smcp-bar').evaluateAll(els => els.map(el => {
    const box = el.getBoundingClientRect(); return { key: el.dataset.key, x: box.left + 1, y: box.top + box.height / 2 }
  }).sort((a, b) => a.y - b.y))
  return { page, points, errors }
}
const record = (name, detail = {}) => { results.push({ name, ...detail }); console.log(`ok ${results.length} - ${name}`) }
try {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const { page, points, errors } = await open(reducedMotion)
    const start = points[3]
    await page.mouse.move(start.x, start.y); await settle(page)
    await page.waitForTimeout(130) // 96ms entry envelope, then test steady Y following.
    const before = await snapshot(page)
    const within = []
    for (const offset of [1, 2, 3, 4]) {
      await page.mouse.move(start.x, start.y + offset); await settle(page)
      within.push(await snapshot(page))
    }
    assert.ok(within.every(s => s.selected === before.selected && s.described === before.described && s.preview === before.preview), 'within-key movement preserves semantic selection and preview')
    assert.ok(within.every(s => s.bars[3].width < before.bars[3].width), 'wave responds before crossing a pitch boundary')
    assert.equal(new Set(within.map(s => s.bars[3].width)).size, 4)
    assert.ok(within.every(s => s.bars.every(b => Math.abs(b.width - b.painted) < .04 && b.transition === 'none')), 'paint follows the latest frame without transition chase')
    for (const counter of ['hitTests', 'nodeRebuilds', 'itemRebuilds', 'turnRebuilds', 'domReconciles', 'mappedAnchorRebuilds', 'railProjections']) {
      assert.equal(within.at(-1).perf[counter], before.perf[counter], counter + ' must stay out of pointer-only frames')
    }
    record('continuous within-key wave and stable preview with ' + reducedMotion)

    await page.mouse.move(points[0].x, points[0].y - 3); await settle(page)
    assert.ok((await snapshot(page)).bars[0].painted > 46, 'fractional center above the first key still produces a wave')

    const trajectory = []
    for (const offset of [0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 32, 28, 24, 20, 16, 12, 8, 4, 0]) {
      await page.mouse.move(start.x, start.y + offset); await settle(page)
      const state = await snapshot(page)
      trajectory.push(state.bars[3].painted)
      assert.ok(state.following)
      assert.ok(state.bars.every(b => Math.abs(b.width - b.painted) < .04), 'reversal does not wait for a stale animation target')
    }
    for (let i = 1; i <= 9; i++) assert.ok(trajectory[i] < trajectory[i - 1])
    for (let i = 10; i < trajectory.length; i++) assert.ok(trajectory[i] > trajectory[i - 1])
    const stopped = await snapshot(page)
    await page.waitForTimeout(120)
    assert.equal((await snapshot(page)).perf.renders, stopped.perf.renders, 'stationary pointer leaves no animation loop')
    record('forward sweep, immediate reversal and idle with ' + reducedMotion)

    // Keyboard supersedes a queued raw pointer sample before the next frame.
    await page.evaluate(p => {
      const rail = document.querySelector('.smcp-unified'); rail.focus()
      rail.dispatchEvent(new PointerEvent('pointermove', { clientX: p.x, clientY: p.y }))
      rail.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }))
    }, points[6])
    await settle(page)
    let state = await snapshot(page)
    assert.equal(state.selected, points[0].key); assert.equal(state.following, false)
    assert.equal(state.bars[0].transition, reducedMotion === 'reduce' ? 'none' : 'width')
    await page.evaluate(p => {
      const rail = document.querySelector('.smcp-unified')
      rail.dispatchEvent(new PointerEvent('pointermove', { clientX: p.x, clientY: p.y }))
      rail.blur()
    }, points[3])
    await settle(page)
    state = await snapshot(page)
    assert.equal(state.visible, false); assert.equal(state.following, false)
    assert.equal(state.selected, undefined, 'blur must not let queued input revive the preview')
    record('keyboard, reduced motion and queued-input blur with ' + reducedMotion)

    await page.mouse.move(start.x, start.y); await settle(page)
    await page.mouse.move(start.x + 54, start.y); await settle(page)
    state = await snapshot(page)
    assert.equal(state.visible, false); assert.equal(state.following, false)
    await page.mouse.click(start.x + 54, start.y)
    assert.deepEqual(await page.evaluate(() => window.railFixture.clicks), [])
    assert.deepEqual(errors, []); await page.close()
    record('blank painted margin remains inert with ' + reducedMotion)
  }
  {
    const { page, errors } = await open('no-preference')
    const firstKey = () => page.locator('.smcp-bar').evaluateAll(els => els.sort((a, b) => Number.parseFloat(a.style.top) - Number.parseFloat(b.style.top))[0].dataset.key)
    await page.evaluate(() => window.railFixture.settings.set({ ...window.railFixture.settings.getSnapshot(), maxVisible: 5 }))
    await settle(page)
    assert.equal(await firstKey(), 'turn:6')
    await page.locator('.smcp-unified').dispatchEvent('wheel', { deltaY: -100 })
    await settle(page)
    assert.equal(await firstKey(), 'turn:3')
    const first = page.locator('.smcp-bar[data-key="turn:3"]')
    const box = await first.boundingBox()
    await page.mouse.move(box.x + 1, box.y + box.height / 2); await settle(page)
    await page.mouse.move(1000, 850); await settle(page)
    assert.equal(await firstKey(), 'turn:6', 'leaving an unexpanded rail recenters its manual window')
    assert.deepEqual(errors, []); await page.close()
    record('pointer leave releases manual browsing and recenters on the reader')
  }
  {
    const { page, points, errors } = await open('no-preference')
    await page.mouse.move(points[3].x, points[3].y); await settle(page)
    await page.waitForTimeout(130)
    const before = await snapshot(page)
    await page.evaluate(p => {
      window.pointerGeometryReads = 0
      for (const bar of document.querySelectorAll('.smcp-bar')) {
        const rect = bar.getBoundingClientRect.bind(bar)
        bar.getBoundingClientRect = () => { window.pointerGeometryReads++; return rect() }
      }
      const rail = document.querySelector('.smcp-unified')
      for (let i = 0; i < 100; i++) rail.dispatchEvent(new PointerEvent('pointermove', { clientX: p.x, clientY: p.y + (i % 4) }))
    }, points[3])
    await settle(page)
    assert.equal(await page.evaluate(() => window.pointerGeometryReads), 1, 'one painted hit read per frame, not per raw event')
    const after = await snapshot(page)
    assert.equal(after.perf.pointerFrames - before.perf.pointerFrames, 1)
    assert.equal(after.perf.renders - before.perf.renders, 1)
    assert.equal(after.perf.hitTests, before.perf.hitTests)
    // Pointer and actual reader invalidation coalescing must still synchronize
    // the reading key instead of taking the pointer-only shortcut.
    await page.evaluate(p => {
      document.querySelector('.smcp-unified').dispatchEvent(new PointerEvent('pointermove', { clientX: p.x, clientY: p.y }))
      window.railFixture.scroll.dispatchEvent(new Event('scroll'))
    }, points[4])
    await settle(page)
    assert.ok((await snapshot(page)).perf.hitTests > after.perf.hitTests)
    record('high-rate events coalesce and reader invalidation still executes')

    await page.evaluate(({ queued, clicked }) => {
      const rail = document.querySelector('.smcp-unified')
      rail.dispatchEvent(new PointerEvent('pointermove', { clientX: queued.x, clientY: queued.y }))
      rail.dispatchEvent(new MouseEvent('click', { clientX: clicked.x, clientY: clicked.y, bubbles: true }))
    }, { queued: points[3], clicked: points[5] })
    assert.deepEqual(await page.evaluate(() => window.railFixture.clicks), [6], 'click uses its own painted target after flushing queued input')
    await settle(page)
    await page.evaluate(p => {
      document.querySelector('.smcp-unified').dispatchEvent(new PointerEvent('pointermove', { clientX: p.x, clientY: p.y }))
      window.railFixture.selection.set(undefined)
    }, points[3])
    await settle(page)
    assert.equal(await page.locator('.smcp-unified').isVisible(), false)
    assert.equal(await page.locator('.smcp-tooltip-visible').count(), 0)
    await page.evaluate(() => window.railFixture.selection.set('s1')); await settle(page)
    assert.equal((await snapshot(page)).following, false)
    await page.evaluate(p => {
      document.querySelector('.smcp-unified').dispatchEvent(new PointerEvent('pointermove', { clientX: p.x, clientY: p.y }))
      window.railFixture.dispose()
    }, points[3])
    await settle(page)
    assert.equal(await page.locator('.smcp-unified').count(), 0)
    assert.equal(await page.evaluate(() => window.__smcpDebug), undefined)
    assert.deepEqual(errors, []); await page.close()
    record('queued click, session switch and disposal do not retain pointer state')
  }
  await writeFile('test-results/pointer-browser.json', JSON.stringify({ passed: results.length, source: 'Actual strip/styles; synthetic Session data; trusted Playwright mouse trajectories', results }, null, 2))
} finally { await browser.close() }
console.log(`${results.length} pointer Chromium scenarios passed`)
