/** #79: real strip painting/lifecycle; synthetic 93-turn Session/native DOM. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildRailFixture, railHtml } from './rail-browser-fixture.mjs'
const tools = createRequire(path.resolve('.browser-tools/package.json'))
const { chromium } = tools('playwright')
const sourceRef = process.env.PIANO_SOURCE_REF
const bundle = await buildRailFixture({ sourceRef })
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH
const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath, args: ['--no-sandbox'] } : {}) })
const results = []
await mkdir('test-results', { recursive: true })
try {
  for (const delay of [179, 2100]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
    page.setDefaultTimeout(3000)
    const errors = []
    page.on('pageerror', error => errors.push(error.message))
    await page.setContent(railHtml)
    await page.evaluate(() => {
      window.railOptions = { leadingHistory: 90 }
      window.beforeRailMount = ({ nav, flow }) => {
        const slot = document.createElement('div'), inner = document.createElement('div')
        nav.replaceWith(slot); slot.append(inner)
        window.lateNative = { nav, inner, local: flow.parentElement }
      }
    })
    await page.addScriptTag({ content: bundle })
    const fallback = () => page.waitForFunction(() => window.__smcpDebug?.hiddenReason === 'contract')
    const recover = () => page.waitForFunction(() => window.__smcpDebug?.mode === 'piano')
    await fallback()
    const before = await page.evaluate(() => ({ ...window.__smcpDebug.perf }))
    await page.waitForTimeout(delay)
    assert.equal(await page.evaluate(() => window.__smcpDebug.perf.domReconciles), before.domReconciles, 'no polling while absent')
    await page.evaluate(() => window.lateNative.inner.append(window.lateNative.nav))
    await recover()
    assert.equal(await page.locator('.smcp-unified').isVisible(), true)
    assert.equal(await page.evaluate(() => window.lateNative.nav.querySelectorAll('button').length), 93)
    await page.screenshot({ path: `test-results/late-native-${delay}.png` })
    for (let entry = 0; entry < 2; entry++) {
      await page.evaluate(() => { window.lateNative.local.hidden = true })
      await page.waitForFunction(() => document.querySelector('.smcp-unified') === null)
      await page.evaluate(() => {
        window.lateNative.nav.remove()
        window.lateNative.local.hidden = false
      })
      await fallback()
      await page.waitForTimeout(179)
      await page.evaluate(() => window.lateNative.inner.append(window.lateNative.nav))
      await recover()
      assert.equal(await page.locator('.smcp-unified').count(), 1)
      assert.equal(await page.evaluate(() => window.lateNative.nav.getAttribute('aria-hidden')), 'true')
    }
    // After discovery, scrolling and rich-text child-list churn must keep the
    // existing no-reconcile path even for a 90+ turn history.
    await page.waitForTimeout(160)
    const hotBefore = await page.evaluate(() => ({ ...window.__smcpDebug.perf }))
    await page.evaluate(() => {
      const { scroll, flow } = window.railFixture
      for (let index = 0; index < 100; index++) {
        scroll.dispatchEvent(new Event('scroll'))
        flow.querySelector('article').append(document.createElement('span'))
      }
    })
    await page.waitForTimeout(160)
    const hotAfter = await page.evaluate(() => ({ ...window.__smcpDebug.perf }))
    for (const field of ['domReconciles', 'nodeRebuilds', 'turnRebuilds']) assert.equal(hotAfter[field], hotBefore[field], field)
    assert.deepEqual(errors, [])
    results.push({ delay, turns: 93, cachedRemounts: 2, waitingDomReconciles: 0, hotPathDomReconciles: 0 })
    await page.evaluate(() => window.railFixture.dispose())
    assert.equal(await page.locator('.smcp-unified').count(), 0)
    assert.equal(await page.evaluate(() => window.lateNative.nav.style.visibility), '')
    await page.close()
  }
  await writeFile('test-results/late-native.json', JSON.stringify({ sourceRef: sourceRef ?? 'working tree', synthetic: true, results }, null, 2) + '\n')
  console.log('late-native Chromium: 179ms/2.1s first mounts, cached remounts, 93-turn hot path and disposal passed')
} finally { await browser.close() }
