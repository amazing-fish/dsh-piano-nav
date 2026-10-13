/** Real painted geometry and pointer disclosure, with synthetic Session data. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
const tools = createRequire(path.resolve('.browser-tools/package.json'))
const { build } = tools('esbuild'), { chromium } = tools('playwright')
const { outputFiles } = await build({
  stdin: { resolveDir: path.resolve('scripts'), sourcefile: 'rail-fixture.ts', contents: `
    import { attachKeyStrip } from '../src/client/strip.ts'
    import { installStyles } from '../src/client/styles.ts'
    const observable = value => {
      const listeners = new Set()
      return { getSnapshot: () => value, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) }, set(next) { value = next; for (const fn of listeners) fn() } }
    }
    const clicks = []
    const nav = document.querySelector('nav')
    for (let turn = 1; turn <= 10; turn++) {
      const button = document.createElement('button'); button.setAttribute('aria-label', (turn === 10 ? 'Jump ' : 'Load ') + turn)
      button.onclick = () => clicks.push(turn); nav.append(button)
    }
    const node = { key: 'u10', kind: 'user', location: { turn: { turn: 10 } }, data: { content: [{ type: 'text', text: 'Current input' }] } }
    const target = observable({ order: ['u10'], nodes: { get: () => node, source: () => observable(node) }, navigation: { items: () => [{ turn: 10, anchorKey: 'u10', prompt: 'Current input', response: '' }] } })
    const outline = observable(Array.from({ length: 10 }, (_, i) => ({ turn: i + 1, seq: (i + 1) * 100, prompt: 'Input ' + (i + 1), response: 'Output ' + (i + 1) })))
    const session = { ...observable({ loadingOlder: false }), sessionId: 's1', projections: { faceOf: () => outline } }
    const binding = { session }
    const ctx = {
      locale: { bind: () => (key, args) => key === 'chat.turnNavigation.label' ? 'Turns' : (key.endsWith('jumpLoad') ? 'Load ' : 'Jump ') + args.turn },
      sessions: { list: observable({}), binding: () => binding }, uiConversation: { binding: () => ({ target: () => target }) }
    }
    const settings = observable({ language: 'en', enabled: true, keyHeight: 2, keyGap: 12, maxVisible: 20 })
    installStyles(); attachKeyStrip(ctx, () => 'Piano', observable('s1'), settings)
    window.railFixture = { clicks, settings }
  `, loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser',
})
await mkdir('test-results', { recursive: true })
const browser = await chromium.launch({ headless: true })
let passed = 0
try {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.setContent(`<!doctype html><html><head><style>
      body{margin:0;font:14px Arial;background:#f4f5f7}main{position:relative;margin:24px;background:white;border:1px solid #ddd}
      [data-conversation-scroll]{height:800px;overflow:auto}[data-chat-flow]{margin-left:300px;width:760px;height:1100px}
      article{padding:24px;border:1px solid #ddd;border-radius:8px}nav{position:absolute;left:0}
    </style></head><body><main><div data-conversation-scroll><section><nav aria-label="Turns"></nav><div data-chat-flow><article data-chat-anchor-key="u10">Current input</article></div></section></div></main></body></html>`)
    await page.addScriptTag({ content: outputFiles[0].text })
    await page.waitForFunction(() => window.__smcpDebug?.mode === 'piano')
    const rail = page.locator('.smcp-unified'), group = page.locator('.smcp-bar[data-collapsed="true"]')
    const initial = await group.boundingBox()
    assert.equal(initial.height, 2); assert.equal(initial.width, 10)
    const geometry = () => page.locator('.smcp-bar').evaluateAll(els => els.map(el => ({ key: el.dataset.key, top: el.getBoundingClientRect().top, height: el.getBoundingClientRect().height })))
    const before = await geometry()
    await page.mouse.move(initial.x + 1, initial.y + 1)
    await page.waitForTimeout(120)
    assert.equal(await page.locator('.smcp-bar').count(), 4)
    assert.equal(await group.getAttribute('aria-expanded'), 'false')
    assert.equal((await group.boundingBox()).height, 2)
    assert.equal(await group.evaluate(el => getComputedStyle(el).transitionProperty), reducedMotion === 'reduce' ? 'none' : 'width')
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
    for (const old of before) assert.deepEqual(after.find(entry => entry.key === old.key), old, 'retained keys keep their pitch and height')
    await page.screenshot({ path: `test-results/rail-expanded-${reducedMotion}.png`, fullPage: true })
    await page.mouse.move(1000, 850)
    await page.waitForFunction(() => document.querySelectorAll('.smcp-bar').length === 4)
    assert.equal(await rail.evaluate(el => document.activeElement === el), true)
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
    console.log(`ok ${passed} - painted collapse, hover, clicks, pitch, focus retirement and ${reducedMotion} motion`)
  }
  await writeFile('test-results/rail-browser.json', JSON.stringify({ passed, source: 'Real strip/styles/native adapter; synthetic Session data; actual Chromium painted geometry' }, null, 2))
} finally { await browser.close() }
console.log(`${passed} rail Chromium scenarios passed`)
