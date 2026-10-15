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
    import { railFixtureData } from './rail-fixture-data.mjs'
    const observable = value => {
      const listeners = new Set()
      return { getSnapshot: () => value, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) }, set(next) { value = next; for (const fn of listeners) fn() } }
    }
    const data = railFixtureData(window.historyOnly === true, window.railOptions), nodeMap = new Map(data.nodes.map(node => [node.key, node]))
    const clicks = [], nav = document.querySelector('nav'), flow = document.querySelector('[data-chat-flow]')
    for (const { turn } of data.outline) {
      const button = document.createElement('button'); button.setAttribute('aria-label', (data.navigation.some(item => item.turn === turn) ? 'Jump ' : 'Load ') + turn)
      button.onclick = () => clicks.push(turn); nav.append(button)
    }
    for (const node of data.nodes) {
      const row = document.createElement('article'); row.dataset.chatAnchorKey = node.key
      row.textContent = node.kind === 'user' ? node.data.content[0].text : node.data.blocks?.[0]?.text ?? ''
      row.hidden = node.kind !== 'user' && node.kind !== 'assistant-step'; flow.append(row)
      if (node.visibility === 'hidden') {
        row.setAttribute('hidden', 'until-found'); row.dataset.turnProcessHidden = 'true'
        row.addEventListener('beforematch', () => row.removeAttribute('hidden'))
      }
    }
    const scroll = document.querySelector('[data-conversation-scroll]'), current = flow.querySelector('[data-chat-anchor-key="' + data.currentAnchor + '"]')
    scroll.scrollTop += current.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 80
    const target = observable({ order: data.nodes.map(node => node.key), nodes: { get: key => nodeMap.get(key), source: key => observable(nodeMap.get(key)) }, navigation: { items: () => data.navigation } })
    const outline = observable(data.outline)
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
const html = `<!doctype html><html><head><style>
      body{margin:0;font:14px Arial;background:#f4f5f7}main{position:relative;margin:24px;background:white;border:1px solid #ddd}
      [data-conversation-scroll]{height:800px;overflow:auto}[data-chat-flow]{margin-left:300px;width:760px;height:2200px}
      body[data-ds-dark-theme]{background:#15151b;color:#eee}body[data-ds-dark-theme] main{background:#24242b}
      article{box-sizing:border-box;height:100px;padding:24px;border:1px solid #ddd;border-radius:8px}nav{position:absolute;left:0}
    </style></head><body><main><div data-conversation-scroll><section><nav aria-label="Turns"></nav><div data-chat-flow></div></section></div></main></body></html>`
try {
  for (const reducedMotion of ['no-preference', 'reduce']) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.setContent(html)
    await page.addScriptTag({ content: outputFiles[0].text })
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
    const before = await geometry()
    assert.equal(await group.getAttribute('data-role'), 'assistant')
    assert.equal(await group.getAttribute('aria-label'), 'AI · Process output (7 segments) · Click to expand')
    const scrollTop = await page.locator('[data-conversation-scroll]').evaluate(el => el.scrollTop)
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
    await page.addScriptTag({ content: outputFiles[0].text })
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
    await page.addScriptTag({ content: outputFiles[0].text })
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
  await writeFile('test-results/rail-browser.json', JSON.stringify({ passed, source: 'Real strip/styles/native adapter; synthetic Session data; actual Chromium painted geometry' }, null, 2))
} finally { await browser.close() }
console.log(`${passed} rail Chromium scenarios passed`)
