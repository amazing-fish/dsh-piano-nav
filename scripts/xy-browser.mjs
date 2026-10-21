/** Real strip + trusted X/Y input; reproducible random paths, no generated UI. */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildRailFixture, railHtml } from './rail-browser-fixture.mjs'
import { xyTrajectory } from './xy-trajectory.mjs'
const tools = createRequire(path.resolve('.browser-tools/package.json'))
const { chromium } = tools('playwright')
const browser = await chromium.launch({ headless: true })
const bundle = await buildRailFixture()
const results = [], traces = []
await mkdir('test-results', { recursive: true })
const snapshot = page => page.evaluate(() => {
  const reads = window.pointerGeometryReads
  window.pointerGeometryReads = 0
  const selected = document.querySelector('.smcp-bar-hover')
  return {
    reads, hitGeometry: window.pointerHitGeometry, selected: selected?.dataset.key ?? null,
    described: document.querySelector('.smcp-unified').getAttribute('aria-activedescendant'), selectedId: selected?.id ?? null,
    preview: document.querySelector('.smcp-tooltip').textContent,
    visible: !!document.querySelector('.smcp-tooltip-visible'),
    perf: { ...window.__smcpDebug.perf }, clicks: [...window.railFixture.clicks],
    bars: [...document.querySelectorAll('.smcp-bar')].map(el => ({ key: el.dataset.key,
      width: parseFloat(el.style.width), painted: el.getBoundingClientRect().width, base: el.classList.contains('smcp-bar-current') ? 24 : 10,
      transition: getComputedStyle(el).transitionProperty })),
  }
})
try {
  for (const fixture of ['history', 'collapsed']) for (const reducedMotion of ['no-preference', 'reduce']) {
    for (const deviceScaleFactor of [1, 1.25, 1.5]) for (const theme of ['light', 'dark']) {
      const seed = (Number(process.env.XY_SEED ?? 0x20261017) + results.length * 0x9E3779B9) >>> 0
      const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion, deviceScaleFactor })
      const errors = []; page.on('pageerror', e => errors.push(e.message))
      const trace = { fixture, reducedMotion, deviceScaleFactor, theme, seed, samples: [] }; traces.push(trace)
      try {
        await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
        await page.setContent(railHtml)
        await page.evaluate(({ fixture, theme }) => {
          window.historyOnly = fixture === 'history'
          window.railOptions = { hidden: true, processCount: 12, leadingHistory: 6 }
          if (theme === 'dark') document.body.setAttribute('data-ds-dark-theme', '')
        }, { fixture, theme })
        await page.addScriptTag({ content: bundle })
        await page.clock.pauseAt(new Date('2026-01-01T00:00:10Z')); await page.clock.runFor(160)
        // ResizeObserver delivery follows native rendering, outside the mocked
        // rAF clock. Finish that initial lifecycle before measuring pointer-only
        // work, then flush the render scheduled by the strip's observer.
        await page.evaluate(() => new Promise(resolve => {
          const observer = new ResizeObserver(() => { observer.disconnect(); resolve() })
          observer.observe(document.querySelector('[data-chat-flow]'))
        }))
        await page.clock.runFor(32)
        const geometry = await page.evaluate(() => {
          const rail = document.querySelector('.smcp-unified'), parent = rail.offsetParent.getBoundingClientRect()
          // Positioning contract uses the containing block's cached outer origin.
          const x = parent.left + parseFloat(rail.style.left), top = parent.top + parseFloat(rail.style.top)
          const bars = [...rail.querySelectorAll('.smcp-bar')].map(el => ({ key: el.dataset.key,
            y: top + parseFloat(el.style.top) + parseFloat(el.style.height) / 2,
            base: el.classList.contains('smcp-bar-current') ? 24 : 10 }))
            .sort((a, b) => a.y - b.y)
          return { x, bars }
        })
        assert.ok(geometry.bars.length >= 6)
        if (fixture === 'collapsed') assert.ok(await page.locator('.smcp-bar[data-collapsed="true"]').count() > 0)
        const pitch = geometry.bars[1].y - geometry.bars[0].y
        const absolute = p => ({ x: geometry.x + p.x, y: geometry.bars[0].y + p.y * pitch })
        const expected = (p, hitGeometry, renderedBars) => {
          // At an exact row midpoint, the existing rail chooses the earlier row.
          const index = Math.max(0, Math.min(geometry.bars.length - 1, Math.ceil(p.y - .5)))
          assert.equal(hitGeometry.key, geometry.bars[index].key, 'Y selects the nearest actual key')
          // Capture the DOM paint at hit time: animation can advance after the previous sample.
          // The new Y offset can narrow the key in this frame: both boundaries apply.
          return p.x <= hitGeometry.painted + 3 && p.x <= renderedBars[index].painted + 3 ? geometry.bars[index].key : null
        }
        const plan = xyTrajectory(seed, geometry.bars.length)
        trace.geometry = geometry; trace.steps = plan.steps
        await page.evaluate(() => {
          window.pointerGeometryReads = 0
          for (const bar of document.querySelectorAll('.smcp-bar')) {
            const rect = bar.getBoundingClientRect.bind(bar)
            bar.getBoundingClientRect = () => {
              window.pointerGeometryReads++
              const box = rect()
              window.pointerHitGeometry = { key: bar.dataset.key, painted: box.width }
              return box
            }
          }
        })
        let previous = await snapshot(page), first = previous
        let sameKeyChecks = 0, jointChanges = 0, rawInputs = 0
        for (let i = 0; i < plan.steps.length; i++) {
          const step = plan.steps[i], last = step.points.at(-1)
          // Snapshot geometry reads do not belong to the component's hit testing.
          await page.evaluate(() => { window.pointerGeometryReads = 0; window.pointerHitGeometry = null })
          if (step.points.length === 1) {
            const p = absolute(last); await page.mouse.move(p.x, p.y)
          } else {
            // Explicit same-task burst: trusted input is used by every other phase.
            await page.evaluate(points => {
              const rail = document.querySelector('.smcp-unified')
              for (const p of points) rail.dispatchEvent(new PointerEvent('pointermove', { clientX: p.x, clientY: p.y }))
            }, step.points.map(absolute))
          }
          rawInputs += step.points.length
          await page.clock.runFor(step.dt)
          const current = await snapshot(page)
          trace.samples.push({ step: i, selected: current.selected, hitGeometry: current.hitGeometry, widths: current.bars.map(b => +b.painted.toFixed(3)), reads: current.reads })
          assert.equal(current.selected, expected(last, current.hitGeometry, current.bars), `seed=${seed} step=${i} ${step.phase}: latest X/Y owns selection within the current paint`)
          assert.equal(current.visible, current.selected !== null, 'preview visibility agrees with the current hit')
          assert.equal(current.described, current.selectedId, 'accessible target agrees with the current hit')
          assert.deepEqual(current.clicks, [], 'hover trajectories never navigate or expand groups')
          assert.equal(current.reads, 1, 'one hit geometry read for the final input, including a burst')
          assert.ok(current.bars.every(b => b.painted >= b.base - .04 && b.painted <= 48.04), 'paint remains within the finite envelope')
          assert.ok(current.bars.every(b => Math.abs(b.width - b.painted) < .04 && b.transition === 'none'), 'paint follows this frame without stale CSS chasing')
          if (current.selected && current.selected === previous.selected) {
            assert.equal(current.preview, previous.preview, 'same-key X/Y jitter keeps preview identity'); sameKeyChecks++
          }
          const strengths = current.bars.map(b => (b.painted - b.base) / (48 - b.base))
          const peak = strengths.indexOf(Math.max(...strengths))
          // Exclude only zero-amplitude entry and subpixel ties at a row midpoint.
          if (current.selected && Math.max(...strengths) > .1 && Math.abs(last.y % 1 - .5) > .03) {
            assert.equal(current.bars[peak].key, current.selected, 'wave position follows Y even while X entry/exit is interrupted')
          }
          if (step.phase === 'continuous-xy') {
            assert.equal(current.bars[peak].key, current.selected, 'settled wave peak follows the latest Y, including reversals')
            assert.notDeepEqual(current.bars.map(b => b.width), previous.bars.map(b => b.width), 'joint X/Y movement changes the painted wave')
            jointChanges++
          }
          previous = current
        }
        for (const counter of ['hitTests', 'nodeRebuilds', 'itemRebuilds', 'turnRebuilds', 'domReconciles', 'mappedAnchorRebuilds', 'railProjections']) {
          assert.equal(previous.perf[counter], first.perf[counter], `${counter} stays outside X/Y-only work`)
        }
        assert.ok(previous.bars.every(b => Math.abs(b.painted - b.base) < .04), 'the final exit fully retires every wave')
        const idle = previous.perf.renders
        await page.clock.runFor(500)
        assert.equal((await snapshot(page)).perf.renders, idle, 'settled random movement leaves no animation loop')
        // A random blank coordinate must stay inert even with a preceding queued hit.
        const blank = absolute({ x: 55, y: plan.steps.at(-1).points[0].y })
        await page.evaluate(({ inside, blank }) => {
          const rail = document.querySelector('.smcp-unified')
          rail.dispatchEvent(new PointerEvent('pointermove', { clientX: inside.x, clientY: inside.y }))
          rail.dispatchEvent(new MouseEvent('click', { clientX: blank.x, clientY: blank.y, bubbles: true }))
        }, { inside: absolute({ x: 2, y: 1.2 }), blank })
        await page.clock.runFor(160)
        assert.deepEqual((await snapshot(page)).clicks, [], 'queued diagonal input cannot authorize a blank click')
        assert.deepEqual(errors, [])
        const result = { fixture, reducedMotion, deviceScaleFactor, theme, seed, samples: plan.steps.length, rawInputs, sameKeyChecks, jointChanges }
        results.push(result); console.log(`ok ${results.length} - ${JSON.stringify(result)}`)
      } finally { await page.close() }
    }
  }
} finally {
  await writeFile('test-results/xy-pointer-traces.json', JSON.stringify(traces))
  await browser.close()
}
await writeFile('test-results/xy-browser.json', JSON.stringify({ passed: results.length,
  source: 'Actual strip; synthetic history/collapsed Session; seeded trusted diagonal/jitter/reversal paths plus explicitly dispatched same-task bursts; controlled rAF; DPR is not Windows host acceptance',
  samples: results.reduce((n, r) => n + r.samples, 0), rawInputs: results.reduce((n, r) => n + r.rawInputs, 0), results }, null, 2))
console.log(`${results.length} seeded X/Y Chromium scenarios passed`)
