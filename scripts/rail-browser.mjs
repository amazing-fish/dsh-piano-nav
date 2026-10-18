/** Real painted geometry and pointer disclosure, with synthetic Session data. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
const tools = createRequire(path.resolve('.browser-tools/package.json'))
const { chromium } = tools('playwright')
import { buildRailFixture, railHtml as html } from './rail-browser-fixture.mjs'
const bundle = await buildRailFixture()
await mkdir('test-results', { recursive: true })
const browser = await chromium.launch({ headless: true })
let passed = 0

try {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.setContent(html)
    await page.addScriptTag({ content: bundle })
    await page.waitForFunction(() => window.__smcpDebug?.mode === 'piano')
    const rail = page.locator('.smcp-unified'), group = page.locator('.smcp-bar[data-collapsed="true"]')
    const initial = await group.boundingBox()
    assert.equal(initial.height, 2); assert.equal(initial.width, 10)
    const geometry = () => page.locator('.smcp-bar').evaluateAll(els => els.map(el => ({ key: el.dataset.key, top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height })))
    const assertCompact = async count => {
      const boxes = (await geometry()).sort((a, b) => a.top - b.top)
      assert.equal(boxes.length, count)
      boxes.forEach((box, i) => { assert.equal(box.height, 2); if (i) assert.equal(box.top - boxes[i - 1].top, 12) })
      assert.equal(boxes.at(-1).top - boxes[0].top + 2, (count - 1) * 12 + 2)
    }
    await assertCompact(4)
    // Actual scroll/resize events must not split visible process groups.
    const signature = () => page.locator('.smcp-bar').evaluateAll(els => els.map(el => [el.dataset.key, el.dataset.count ?? null]))
    const stable = await signature()
    for (const anchor of ['p6', 'p2', 'p0', 'f3']) {
      await page.evaluate(key => {
        const { scroll, flow } = window.railFixture
        const row = flow.querySelector('[data-chat-anchor-key="' + key + '"]')
        scroll.scrollTop += row.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 80
        scroll.dispatchEvent(new Event('scroll'))
      }, anchor)
      await page.waitForTimeout(120)
      assert.deepEqual(await signature(), stable)
      assert.equal(await group.getAttribute('data-count'), '7')
    }
    await page.setViewportSize({ width: 1180, height: 800 })
    await page.waitForTimeout(120)
    assert.deepEqual(await signature(), stable)
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.waitForTimeout(120)
    await assertCompact(4)
    const before = await geometry()
    assert.equal(await group.getAttribute('data-role'), 'assistant')
    assert.equal(await group.getAttribute('aria-label'), 'AI · Process output (7 segments) · Click to expand')
    const scrollTop = await page.locator('[data-conversation-scroll]').evaluate(el => el.scrollTop)
    await page.mouse.move(initial.x + 1, initial.y + 1)
    await page.waitForTimeout(120)
    assert.equal(await page.locator('.smcp-bar').count(), 4)
    assert.equal(await group.getAttribute('aria-expanded'), 'false')
    assert.equal((await group.boundingBox()).height, 2)
    assert.equal(await group.evaluate(el => getComputedStyle(el).transitionProperty), 'none')
    // Wave may be 48px, but the blank right edge must not disclose or navigate.
    await page.mouse.move(initial.x + 55, initial.y + 1)
    await page.mouse.click(initial.x + 55, initial.y + 1)
    await page.waitForTimeout(120)
    assert.equal(await page.locator('.smcp-bar').count(), 4)
    assert.deepEqual(await page.evaluate(() => window.railFixture.clicks), [])
    // The former member pitch is empty and must not be a tall invisible key.
    await page.mouse.click(initial.x + 1, initial.y - 24)
    assert.equal(await page.locator('.smcp-bar').count(), 4)
    await page.mouse.click(initial.x + 1, initial.y + 1)
    await page.waitForFunction(() => document.querySelectorAll('.smcp-bar').length === 10)
    assert.deepEqual(await page.evaluate(() => window.railFixture.clicks), [])
    const after = await geometry()
    await assertCompact(10)
    assert.notEqual(after.find(entry => entry.key === 'turn:2').top, before.find(entry => entry.key === 'turn:2').top, 'history moves to its compact displayed pitch')
    assert.equal(await page.locator('[data-conversation-scroll]').evaluate(el => el.scrollTop), scrollTop, 'disclosure never scrolls the transcript')
    await page.screenshot({ path: `test-results/rail-expanded-${reducedMotion}.png`, fullPage: true })
    await page.mouse.move(1000, 850)
    await assertCompact(10)
    assert.equal(await rail.evaluate(el => document.activeElement === el), true)
    await page.keyboard.press('Escape')
    await page.waitForFunction(() => document.querySelectorAll('.smcp-bar').length === 4)
    await assertCompact(4)
    assert.equal(await page.locator('[data-conversation-scroll]').evaluate(el => el.scrollTop), scrollTop)
    await page.screenshot({ path: `test-results/rail-collapsed-${reducedMotion}.png`, fullPage: true })
    await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', 'true'))
    await page.screenshot({ path: `test-results/rail-collapsed-dark-${reducedMotion}.png`, fullPage: true })
    await page.mouse.click(initial.x + 1, initial.y + 1)
    await page.waitForFunction(() => document.querySelectorAll('.smcp-bar').length === 10)
    const member = await page.locator('.smcp-bar[data-key="turn:1"]').boundingBox()
    await page.mouse.click(member.x + 1, member.y + 1)
    assert.deepEqual(await page.evaluate(() => window.railFixture.clicks), [1])
    assert.deepEqual(errors, [])
    await page.close(); passed++
    console.log(`ok ${passed} - process-only compact geometry, hover, clicks, persistent expansion and ${reducedMotion} motion`)
  }
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.setContent(html); await page.evaluate(() => { window.historyOnly = true })
    await page.addScriptTag({ content: bundle })
    await page.waitForFunction(() => window.__smcpDebug?.mode === 'piano')
    assert.equal(await page.locator('.smcp-bar').count(), 10)
    assert.equal(await page.locator('.smcp-bar[data-collapsed="true"]').count(), 0)
    const first = page.locator('.smcp-bar[data-key="turn:1"]'), box = await first.boundingBox()
    await page.mouse.move(box.x + 1, box.y + 1)
    await page.waitForTimeout(120)
    assert.ok((await first.getAttribute('aria-label')).includes('History turn'))
    await page.mouse.click(box.x + 1, box.y + 1)
    assert.deepEqual(await page.evaluate(() => window.railFixture.clicks), [1])
    assert.equal(await page.locator('.smcp-bar[data-collapsed="true"]').count(), 0)
    assert.deepEqual(errors, []); await page.close(); passed++
    console.log(`ok ${passed} - independent history first-click native activation with ${reducedMotion} motion`)
  }
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.setContent(html)
    await page.evaluate(() => { window.railOptions = { hidden: true, processCount: 12, leadingHistory: 11 } })
    await page.addScriptTag({ content: bundle })
    await page.waitForFunction(() => window.__smcpDebug?.mode === 'piano')
    const group = page.locator('.smcp-bar[data-collapsed="true"]')
    assert.equal(await group.getAttribute('data-count'), '12')
    await group.evaluate(el => el.click())
    await page.waitForFunction(() => document.querySelectorAll('.smcp-bar[data-kind="output"]').length === 12)
    assert.equal(await page.locator('.smcp-bar[data-collapsed="true"]').count(), 0)
    await page.mouse.move(1000, 850)
    await page.evaluate(() => {
      document.querySelector('.smcp-unified').blur()
      document.querySelector('[data-conversation-scroll]').dispatchEvent(new Event('scroll'))
    })
    await page.waitForTimeout(100)
    assert.equal(await page.locator('.smcp-bar[data-kind="output"]').count(), 12)
    const boxes = await page.locator('.smcp-bar').evaluateAll(els => els.map(el => el.getBoundingClientRect().toJSON()).sort((a, b) => a.top - b.top))
    boxes.forEach((box, i) => { assert.equal(box.height, 2); if (i) assert.equal(box.top - boxes[i - 1].top, 12) })
    await page.screenshot({ path: 'test-results/rail-folded-history-expanded.png', fullPage: true })
    const last = page.locator('.smcp-bar[data-key="segment:p11::output:0"]'), box = await last.boundingBox()
    await page.mouse.click(box.x + 1, box.y + 1)
    await page.waitForFunction(() => window.railFixture.clicks.length === 1)
    assert.deepEqual(await page.evaluate(() => window.railFixture.clicks), [12])
    assert.equal(await page.locator('[data-chat-anchor-key="p11"]').getAttribute('hidden'), null)
    const offset = await page.locator('[data-chat-anchor-key="p11"]').evaluate(el => el.getBoundingClientRect().top - el.closest('[data-conversation-scroll]').getBoundingClientRect().top)
    assert.ok(Math.abs(offset - 24) < 1, 'hidden member lands at the native reader offset')
    assert.deepEqual(errors, []); await page.close(); passed++
    console.log(`ok ${passed} - default-folded 12-output history, persistent expansion and exact hidden-member landing`)
  }
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.setContent(html)
    await page.evaluate(() => { window.railOptions = { hidden: true, processCount: 3, processGroups: 2 } })
    await page.addScriptTag({ content: bundle })
    await page.waitForFunction(() => window.__smcpDebug?.mode === 'piano')
    await page.evaluate(() => document.querySelector('nav [aria-label="Load 3"]').remove())
    const blocked = page.locator('.smcp-bar[data-key="turn:3"]')
    await page.waitForFunction(() => document.querySelector('.smcp-bar[data-key="turn:3"]').disabled)
    const outputs = turn => page.locator(`.smcp-bar[data-kind="output"][data-turn="${turn}"]`)
    const click = async locator => {
      const box = await locator.boundingBox(); assert.ok(box)
      await page.mouse.click(box.x + 1, box.y + box.height / 2)
    }
    await click(outputs(1)); await page.waitForFunction(() => document.querySelectorAll('.smcp-bar[data-kind="output"][data-turn="1"]').length === 3)
    await click(outputs(2)); await page.waitForFunction(() => document.querySelectorAll('.smcp-bar[data-kind="output"][data-turn="2"]').length === 3)
    assert.equal(await outputs(1).count(), 1); assert.equal(await outputs(1).getAttribute('data-count'), '3')
    await page.evaluate(() => {
      window.blockedClicks = []
      document.querySelector('.smcp-unified').addEventListener('click', e => window.blockedClicks.push(e.isTrusted))
    })
    await click(blocked)
    await page.waitForFunction(() => document.querySelectorAll('.smcp-bar[data-kind="output"][data-turn="2"]').length === 1)
    assert.deepEqual(await page.evaluate(() => window.blockedClicks), [true], 'real pointer reaches the geometry click route')
    await click(outputs(2)); await page.waitForFunction(() => document.querySelectorAll('.smcp-bar[data-kind="output"][data-turn="2"]').length === 3)
    await page.keyboard.press('End'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('ArrowUp'); await page.keyboard.press('Enter')
    await page.waitForFunction(() => document.querySelectorAll('.smcp-bar[data-kind="output"][data-turn="2"]').length === 1)
    assert.equal(await outputs(2).getAttribute('data-count'), '3')
    assert.deepEqual(await page.evaluate(() => window.railFixture.clicks), [])
    assert.deepEqual(errors, []); await page.close(); passed++
    console.log(`ok ${passed} - real pointer/keyboard group replacement and disabled-history retirement without navigation`)
  }
  await writeFile('test-results/rail-browser.json', JSON.stringify({ passed, source: 'Real strip/styles/native adapter; synthetic Session data; actual Chromium painted geometry' }, null, 2))
} finally { await browser.close() }
console.log(`${passed} rail Chromium scenarios passed`)

