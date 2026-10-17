/** Actual settings UI; synthetic delayed/failing DSH transport. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildRailFixture, railHtml } from './rail-browser-fixture.mjs'

const { chromium } = createRequire(path.resolve('.browser-tools/package.json'))('playwright')
const sourceRef = process.env.SETTINGS_SOURCE_REF
const bundle = await buildRailFixture({ settingsPage: true, sourceRef })
const browser = await chromium.launch({ headless: true })
const errors = [], results = [], evidence = []
const html = railHtml.replace('</head>', `<style>
main{display:none}#settings-panel{width:min(760px,100%);padding:12px;box-sizing:border-box}
body[data-ds-dark-theme]{--dsw-alias-bg-layer-2:#24242b;--dsw-alias-label-primary:#f1f1f3;--dsw-alias-label-secondary:#b7bac3}
</style></head>`)

async function start({ width = 1280, language = 'en', maxVisible = 20, keyHeight = 2, keyGap = 12, dark = false, motion = 'no-preference' } = {}) {
  const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion: motion })
  page.on('pageerror', error => errors.push(error.message))
  await page.setContent(html)
  await page.evaluate(({ language, maxVisible, keyHeight, keyGap, dark }) => {
    window.fixtureSettings = { language, maxVisible, keyHeight, keyGap }
    window.writeDelay = 80
    document.body.toggleAttribute('data-ds-dark-theme', dark)
  }, { language, maxVisible, keyHeight, keyGap, dark })
  await page.addScriptTag({ content: bundle })
  await page.waitForFunction(() => window.settingsFixture?.controller.scope.getSnapshot().status === 'ready')
  await page.locator('.smcp-preview-rail').waitFor()
  await page.evaluate(() => {
    const scope = window.settingsFixture.controller.scope
    window.pendingWrites = []
    for (const method of ['set', 'reset']) {
      const original = scope[method]
      scope[method] = (...args) => {
        const operation = original(...args)
        window.pendingWrites.push(operation.catch(() => {}))
        return operation
      }
    }
    window.geometry = () => {
      const card = document.querySelector('.smcp-preview').closest('section')
      const rect = element => element.getBoundingClientRect()
      return {
        previewTop: rect(card).top + scrollY,
        previewBottom: rect(card).bottom + scrollY,
        followingTop: rect(card.nextElementSibling).top + scrollY,
        panelHeight: rect(document.querySelector('#settings-panel')).height,
        railHeight: rect(document.querySelector('.smcp-preview-rail')).height,
      }
    }
    window.samples = []
    const sample = () => {
      window.samples.push({ ...window.geometry(), error: document.querySelector('[role="alert"]')?.textContent ?? '' })
      requestAnimationFrame(sample)
    }
    sample()
  })
  return page
}
const settled = async page => {
  await page.evaluate(async () => { await Promise.all(window.pendingWrites); await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))) })
}
const checkStable = async (page, baseline, context) => {
  const samples = await page.evaluate(() => window.samples)
  for (const sample of samples) {
    for (const [key, value] of Object.entries(baseline)) assert.equal(sample[key], value, `${context}: ${key}`)
  }
  return samples
}

try {
  await mkdir('test-results', { recursive: true })
  // Each localized message must fit without moving content, including wrapped mobile text.
  for (const language of ['zh', 'en', 'zh-TW']) for (const width of [1280, 390, 320]) {
    const page = await start({ language, width })
    const baseline = await page.evaluate(() => window.geometry())
    const color = page.locator('.smcp-color-label input').first()
    await page.evaluate(() => { window.failWrite = true })
    await color.fill('#123456'); await settled(page)
    const message = await page.locator('[role="alert"]').textContent()
    assert.ok(message, 'failed write is announced')
    await page.evaluate(() => { window.samples = [] })
    // Three rapid picker writes are queued; the previous failure must stay visible throughout.
    for (const value of ['#234567', '#345678', '#456789']) await color.fill(value)
    await settled(page)
    const failed = await checkStable(page, baseline, `${language}/${width} failed retries`)
    assert.ok(failed.length > 2)
    assert.ok(failed.every(sample => sample.error === message), 'retry does not erase the previous error')
    await page.evaluate(() => { window.failWrite = false })
    await color.fill('#56789a'); await settled(page)
    assert.equal(await page.locator('[role="alert"]').textContent(), '', 'successful save clears the write error')
    assert.equal(await color.inputValue(), '#56789a')
    const samples = await checkStable(page, baseline, `${language}/${width} recovery`)
    evidence.push({ scenario: `retry-${language}-${width}`, baseline, sampledFrames: samples.length })
    await page.close()
  }
  results.push('continuous failures, queued retries and recovery: zero page displacement in three languages at 1280/390/320px')

  for (const options of [
    {}, { maxVisible: 5 }, { maxVisible: 6 }, { maxVisible: 7 },
    { width: 320, language: 'en', dark: true },
    { width: 390, language: 'zh-TW', maxVisible: 5, keyHeight: 4, keyGap: 18, motion: 'reduce' },
    { maxVisible: 30, keyHeight: 1, keyGap: 6 },
  ]) {
    const page = await start(options)
    const baseline = await page.evaluate(() => window.geometry())
    const rail = page.locator('.smcp-preview-rail')
    await rail.locator('[data-kind="output"]').first().click({ position: { x: 1, y: 1 } })
    assert.ok(await rail.locator('[data-kind="output"]').count() > 1)
    await rail.locator('[data-kind="output"]').nth(1).click({ position: { x: 1, y: 1 } })
    assert.equal(await rail.locator('[data-kind="output"][aria-current="true"]').count(), 1)
    await page.evaluate(async () => {
      let seed = 47
      for (let i = 0; i < 30; i++) {
        seed = (seed * 1664525 + 1013904223) >>> 0
        const keys = [...document.querySelectorAll('.smcp-preview-rail button')]
        keys[seed % keys.length].click()
        const pages = [...document.querySelectorAll('.smcp-preview-pages button')]
        if (i % 4 === 0) pages[(i / 4) % 2 | 0]?.click()
        await new Promise(requestAnimationFrame)
      }
    })
    const samples = await checkStable(page, baseline, `preview ${JSON.stringify(options)}`)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    if (options.motion === 'reduce') assert.equal(await rail.locator('button').first().evaluate(el => getComputedStyle(el).transitionDuration), '0s')
    evidence.push({ scenario: `preview-${JSON.stringify(options)}`, baseline, sampledFrames: samples.length })
    await page.close()
  }
  results.push('expanded/collapsed/member/random/page navigation keeps card and following content stationary, including maxVisible 5–7, themes, size limits and reduced motion')

  const page = await start()
  const baseline = await page.evaluate(() => window.geometry())
  await page.evaluate(() => { window.failWrite = true })
  for (const target of [page.locator('.smcp-settings-reset').first(), page.getByRole('button', { name: 'Restore defaults', exact: true })]) {
    // Color-only reset and full reset must retain the error while retrying, then clear on success.
    await target.click(); await settled(page)
    const message = await page.locator('[role="alert"]').textContent()
    assert.ok(message)
    await target.click()
    assert.equal(await page.locator('[role="alert"]').textContent(), message)
    await settled(page)
    await checkStable(page, baseline, 'reset failure')
  }
  const writeError = await page.locator('[role="alert"]').textContent()
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } }))
  await page.locator('.smcp-settings-command-box button').click()
  assert.equal(await page.locator('[role="alert"]').textContent(), writeError, 'copy success retains a write failure')
  await page.evaluate(() => { window.failWrite = false })
  await page.locator('.smcp-settings-reset').first().click(); await settled(page)
  assert.equal(await page.locator('[role="alert"]').textContent(), '')
  // A later settings save must not clear an unrelated clipboard failure.
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('blocked') } } }))
  await page.locator('.smcp-settings-command-box button').click()
  await page.waitForFunction(() => document.querySelector('[role="alert"]').textContent.includes('Copy failed'))
  const copyError = await page.locator('[role="alert"]').textContent()
  await page.locator('.smcp-color-label input').first().fill('#123456'); await settled(page)
  assert.equal(await page.locator('[role="alert"]').textContent(), copyError)
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => {} } }))
  await page.locator('.smcp-settings-command-box button').click()
  await page.waitForFunction(() => document.querySelector('[role="alert"]').textContent === '')
  // Copy/Copied button text may rewrap the install command; isolate feedback geometry.
  const { panelHeight, ...feedbackBaseline } = baseline
  await checkStable(page, feedbackBaseline, 'clipboard error and recovery')
  await page.close()
  results.push('palette/full reset retry feedback and clipboard failures clear only after the corresponding operation succeeds')

  // Native clipboard permissions/transport can settle requests out of order.
  for (const latestFirst of [true, false]) for (const latestSuccess of [true, false]) {
    const page = await start()
    await page.evaluate(() => {
      window.copyRequests = []
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
        writeText: () => new Promise((resolve, reject) => window.copyRequests.push({ resolve, reject })),
      } })
    })
    const button = page.locator('.smcp-settings-command-box button')
    await button.click(); await button.click()
    assert.equal(await page.evaluate(() => window.copyRequests.length), 2)
    const settle = async (index, success) => {
      await page.evaluate(async ({ index, success }) => {
        const request = window.copyRequests[index]
        if (success) request.resolve(); else request.reject(new Error('copy denied'))
        await new Promise(requestAnimationFrame)
      }, { index, success })
    }
    if (latestFirst) await settle(1, latestSuccess)
    await settle(0, !latestSuccess)
    if (!latestFirst) {
      assert.equal(await button.innerText(), 'Copy', 'obsolete completion cannot mark the pending latest attempt copied')
      assert.equal(await page.locator('[role="alert"]').textContent(), '', 'obsolete completion cannot report an error')
      await settle(1, latestSuccess)
    }
    assert.equal(await button.innerText(), latestSuccess ? 'Copied' : 'Copy')
    assert.equal(await page.locator('[role="alert"]').textContent(), latestSuccess ? '' : 'Copy failed. Select the command manually.')
    evidence.push({ scenario: `clipboard-latestFirst-${latestFirst}-latestSuccess-${latestSuccess}`, sampledFrames: 0 })
    await page.close()
  }
  results.push('four clipboard completion orderings retain only the latest attempt, including while it remains pending')

  assert.deepEqual(errors, [])
  await writeFile('test-results/settings-layout-browser.json', JSON.stringify({ sourceRef: sourceRef ?? 'working tree', environment: 'headless Chromium; actual settings UI; synthetic DSH transport', results, evidence }, null, 2))
  console.log(`${results.length} settings layout scenario groups passed`)
} finally { await browser.close() }
