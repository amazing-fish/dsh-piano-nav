/** Comparable real-component drag workload; held transport isolates rendering. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { cpus, platform, arch } from 'node:os'
import { buildRailFixture, railHtml } from './rail-browser-fixture.mjs'
const { chromium } = createRequire(path.resolve('.browser-tools/package.json'))('playwright')
const sourceRef = process.env.COLOR_SOURCE_REF, baseline = !!sourceRef
const bundle = await buildRailFixture({ settingsPage: true, sourceRef })
const browser = await chromium.launch({ headless: true }), runs = []
const html = railHtml.replace('</head>', '<style>#settings-panel{position:absolute;top:24px;left:430px;width:760px;padding:0 12px 24px;background:#f4f5f7;box-sizing:border-box}</style></head>')
try {
  for (const rate of [1, 4]) for (let repeat = 0; repeat < 3; repeat++) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' })
    const errors = []; page.on('pageerror', e => errors.push(e.message))
    await page.setContent(html)
    await page.evaluate(() => {
      window.holdWrites = true; window.fixtureSettings = { language: 'en', colorInput: '#123456' }
      window.commits = []; window.profileSettings = (_id, _phase, duration) => window.commits.push(duration)
    })
    await page.addScriptTag({ content: bundle })
    await page.waitForFunction(() => window.__smcpDebug?.mode === 'piano' && document.querySelector('input[type=color]:enabled'))
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    const cdp = await page.context().newCDPSession(page)
    await cdp.send('Emulation.setCPUThrottlingRate', { rate }); await cdp.send('Performance.enable')
    const before = (await cdp.send('Performance.getMetrics')).metrics
    const result = await page.evaluate(async () => {
      const strip = document.querySelector('.smcp-strip'), input = document.querySelector('input[type=color]')
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      const set = CSSStyleDeclaration.prototype.setProperty, remove = CSSStyleDeclaration.prototype.removeProperty
      const rect = Element.prototype.getBoundingClientRect
      let cssWrites = 0, geometryReads = 0
      CSSStyleDeclaration.prototype.setProperty = function(...args) { if (this === strip.style) cssWrites++; return set.apply(this, args) }
      CSSStyleDeclaration.prototype.removeProperty = function(...args) { if (this === strip.style) cssWrites++; return remove.apply(this, args) }
      Element.prototype.getBoundingClientRect = function(...args) { geometryReads++; return rect.apply(this, args) }
      const perf = { ...window.__smcpDebug.perf }, handlers = [], inputs = [], frameGaps = [], mismatches = []
      window.commits.length = 0
      let previous, finalColor
      for (let frame = 0; frame < 60; frame++) {
        const now = await new Promise(resolve => requestAnimationFrame(resolve))
        if (previous !== undefined) frameGaps.push(now - previous)
        previous = now
        const start = performance.now()
        for (let sample = 0; sample < 4; sample++) {
          finalColor = '#' + (0x100000 + frame * 4 + sample).toString(16)
          const inputStart = performance.now()
          setter.call(input, finalColor); input.dispatchEvent(new Event('input', { bubbles: true }))
          inputs.push(performance.now() - inputStart)
        }
        handlers.push(performance.now() - start)
        // One visual sample per frame, never a forced style read per input.
        await Promise.resolve()
        const colors = ['.smcp-legend-key', '.smcp-preview-rail .smcp-bar', '.smcp-strip .smcp-bar'].map(selector => getComputedStyle(document.querySelector(selector + '[data-kind=input]')).getPropertyValue('--smcp-key').trim())
        if (colors.some(color => color !== finalColor) || input.value !== finalColor) mismatches.push({ frame, colors, finalColor, picker: input.value })
      }
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))
      const percentile = (values, p) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1]
      const measured = { inputs: 240, cssWrites, geometryReads,
        railRenders: window.__smcpDebug.perf.renders - perf.renders,
        railProjections: window.__smcpDebug.perf.railProjections - perf.railProjections,
        reactCommits: window.commits.length, reactRenderMs: window.commits.reduce((a, b) => a + b, 0),
        batchCpuMs: handlers.reduce((a, b) => a + b, 0), batchP95Ms: percentile(handlers, .95), inputP95Ms: percentile(inputs, .95),
        frameGapP95Ms: percentile(frameGaps, .95), mismatches,
        saving: window.settingsFixture.controller.scope.getSnapshot().saving,
        completedWrites: window.settingsFixture.writes.length }
      CSSStyleDeclaration.prototype.setProperty = set; CSSStyleDeclaration.prototype.removeProperty = remove; Element.prototype.getBoundingClientRect = rect
      return measured
    })
    const after = (await cdp.send('Performance.getMetrics')).metrics
    for (const name of ['LayoutCount', 'LayoutDuration', 'RecalcStyleCount', 'RecalcStyleDuration', 'TaskDuration']) result[name] = after.find(m => m.name === name).value - before.find(m => m.name === name).value
    assert.deepEqual(errors, []); assert.deepEqual(result.mismatches, [], 'picker, legend, preview and rail agree in the input frame')
    assert.equal(result.completedWrites, 0); assert.equal(result.saving, true)
    if (!baseline) { assert.equal(result.railRenders, 0, 'pure colors do not run navigation/layout'); assert.equal(result.geometryReads, 0, 'color dragging never reads geometry') }
    runs.push({ cpuThrottle: rate, repeat, ...result }); await page.close()
  }
} finally { await browser.close() }
await mkdir('test-results', { recursive: true })
await writeFile(`test-results/color-drag-${baseline ? 'before' : 'after'}.json`, JSON.stringify({ source: sourceRef ?? 'working-tree', device: { cpu: cpus()[0]?.model, platform: platform(), arch: arch(), node: process.version }, environment: 'Headless Chromium 140 / Linux container; development React 18.3.1; 1280x900; 60 frames x 4 distinct native-style inputs; same fixture with held transport; one computed-style sample per frame; CPU 1x and 4x, three trials each. Frame gaps are not paint latency or Windows native picker performance.', runs }, null, 2))
console.log(JSON.stringify(runs.map(({ cpuThrottle, repeat, cssWrites, geometryReads, railRenders, reactCommits, reactRenderMs, batchCpuMs, batchP95Ms, inputP95Ms, LayoutDuration, RecalcStyleDuration, frameGapP95Ms }) => ({ cpuThrottle, repeat, cssWrites, geometryReads, railRenders, reactCommits, reactRenderMs, batchCpuMs, batchP95Ms, inputP95Ms, LayoutDuration, RecalcStyleDuration, frameGapP95Ms })), null, 2))
