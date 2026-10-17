/** Replays the seeded regression input through both actual component versions. */
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildRailFixture, railHtml } from './rail-browser-fixture.mjs'
import { xyTrajectory } from './xy-trajectory.mjs'
const tools = createRequire(path.resolve('.browser-tools/package.json'))
const { chromium } = tools('playwright')
const baseline = 'a8894d17371f7e0843d53cbb5539b4c07bc0de54', seed = 0x20261017
const bundles = [await buildRailFixture({ sourceRef: baseline }), await buildRailFixture()]
const browser = await chromium.launch({ headless: true }), pages = [], metrics = []
await mkdir('test-results/xy-frames', { recursive: true })
try {
  for (const content of bundles) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
    await page.setContent(railHtml); await page.evaluate(() => { window.historyOnly = true })
    await page.addScriptTag({ content }); await page.clock.pauseAt(new Date('2026-01-01T00:00:10Z')); await page.clock.runFor(160)
    const geometry = await page.evaluate(() => {
      const rail = document.querySelector('.smcp-unified'), root = rail.offsetParent.getBoundingClientRect()
      const x = root.left + parseFloat(rail.style.left), top = root.top + parseFloat(rail.style.top)
      const ys = [...rail.querySelectorAll('.smcp-bar')].map(el => top + parseFloat(el.style.top) + parseFloat(el.style.height) / 2).sort((a, b) => a - b)
      return { x, y: ys[0], pitch: ys[1] - ys[0], rows: ys.length }
    })
    const clip = { x: geometry.x - 5, y: geometry.y - 5, width: 65, height: (geometry.rows - 1) * geometry.pitch + 10 }
    pages.push({ page, geometry, clip })
  }
  const board = await browser.newPage({ viewport: { width: 1180, height: 630 } })
  await board.setContent(`<!doctype html><html><style>
  *{box-sizing:border-box}body{margin:0;padding:24px 28px;background:#f5f5f2;color:#17212b;font:15px Arial}
  h1{font-size:27px;margin:0 0 7px}header p,footer{color:#64717b;font-size:12px;margin:0}#phase{font-size:19px;font-weight:600;margin:18px 0 14px}
  main{display:grid;grid-template-columns:270px 1fr 1fr;gap:16px}section{background:white;border:1px solid #dce2e4;border-radius:14px;padding:16px;height:452px}h2{margin:0 0 14px;font-size:17px}#after h2{color:#17685f}.sub{font-size:12px;color:#64717b;line-height:1.7}
  .content{display:flex;gap:10px}.rail{position:relative;flex:none;width:195px;height:356px;overflow:hidden}.rail img{width:195px;height:auto;position:absolute;top:0;left:0;image-rendering:pixelated}.cursor{position:absolute;width:11px;height:11px;background:#ec8e26;border:2px solid white;box-shadow:0 0 0 1px #a85705;border-radius:50%;transform:translate(-50%,-50%)}.info{min-width:0;font-size:13px;line-height:1.7}.info strong{display:block;font:19px monospace;margin:7px 0}.preview{width:100%;max-height:100px;object-fit:contain;object-position:left top;border:1px solid #edf0ef}.preview-row{height:60px;margin-top:4px;overflow:hidden}.preview-row img{width:100%;height:auto}#coords{font:16px monospace;margin:8px 0}svg{width:100%;height:240px}footer{margin-top:13px}
  </style><header><h1>Seeded X + Y pointer replay</h1><p>Actual plugin components · same seed & input · 3× rail detail · sampled replay, not real-time playback</p></header><div id="phase"></div><main>
  <section><h2>Joint X/Y input</h2><div class="sub">Seed 0x20261017 · orange dot = latest input<br>Horizontal: X / CSS px · Vertical: key row</div><div id="coords"></div><div id="plot"></div><div class="sub">Dashed: ordinary key hover limit (13px).</div></section>
  <section id="before"><h2>Before · master a8894d1</h2><div class="content"></div></section><section id="after"><h2>Experiment · stable core</h2><div class="content"></div></section></main><footer>Synthetic Session; trusted mouse except explicit same-task bursts. Controlled rAF/CSS sample clocks. No FPS or Windows host claim.</footer></html>`)
  const plan = xyTrajectory(seed, pages[0].geometry.rows), history = []
  const labels = { diagonal: 'Diagonal sweep with random drift', 'edge-jitter': 'X boundary jitter + Y random walk', 'fast-reversal': 'Random jumps and immediate reversals', 'coalesced-burst': 'Same-frame X/Y bursts · final point wins', 'settle-inside': 'Hold inside the core', 'continuous-xy': 'Continuous X + Y changes inside the core', 'settle-outside': 'Leave and settle' }
  let frame = 0, stillCaptured = false
  for (let stepIndex = 0; stepIndex < plan.steps.length; stepIndex++) {
    const step = plan.steps[stepIndex], point = step.points.at(-1), captures = []
    history.push(...step.points)
    for (const [versionIndex, { page, geometry: g, clip }] of pages.entries()) {
      const absolute = p => ({ x: g.x + p.x, y: g.y + p.y * g.pitch })
      if (step.points.length === 1) { const p = absolute(point); await page.mouse.move(p.x, p.y) }
      else await page.evaluate(points => {
        const rail = document.querySelector('.smcp-unified')
        for (const p of points) rail.dispatchEvent(new PointerEvent('pointermove', { clientX: p.x, clientY: p.y }))
      }, step.points.map(absolute))
      await page.clock.runFor(step.dt)
      await page.evaluate(() => {
        window.captureAnimations ??= new WeakMap()
        for (const a of document.getAnimations()) {
          if (!window.captureAnimations.has(a)) window.captureAnimations.set(a, performance.now() - Number(a.currentTime ?? 0))
          a.pause(); a.currentTime = performance.now() - window.captureAnimations.get(a)
        }
      })
      const state = await page.evaluate(() => ({ selected: document.querySelector('.smcp-bar-hover')?.dataset.key ?? null,
        preview: !!document.querySelector('.smcp-tooltip-visible'), widths: [...document.querySelectorAll('.smcp-bar')].map(el => el.getBoundingClientRect().width) }))
      if (stepIndex % 2 === 0 || stepIndex === plan.steps.length - 1) {
        const railImage = await page.screenshot({ clip })
        captures.push({ ...state, railImage: railImage.toString('base64'),
          mouseX: (g.x + point.x - clip.x) * 3, mouseY: (g.y + point.y * g.pitch - clip.y) * 3 })
      }
      metrics.push({ step: stepIndex, version: versionIndex === 0 ? 'before' : 'after', ...state })
    }
    if (captures.length === 0) continue
    await board.evaluate(({ captures, point, trail, label, dt, count, rows }) => {
      document.querySelector('#phase').textContent = label + (count > 1 ? ` (${count} inputs)` : '')
      document.querySelector('#coords').textContent = `X ${point.x.toFixed(1)} · Y ${(point.y + 1).toFixed(2)} · ${dt}ms`
      const px = p => 22 + p.x / 58 * 184, py = p => 12 + p.y / (rows - 1) * 260
      document.querySelector('#plot').innerHTML = `<svg viewBox="0 0 232 300" aria-label="Input trajectory"><rect x="22" y="12" width="184" height="260" fill="#f4f7f7" stroke="#cbd6d7"/>${Array.from({ length: rows }, (_, i) => `<line x1="22" x2="206" y1="${py({ y: i })}" y2="${py({ y: i })}" stroke="#e0e7e7"/><text x="5" y="${py({ y: i }) + 4}" font-size="10" fill="#6b777c">${i + 1}</text>`).join('')}<line x1="${px({ x: 13 })}" x2="${px({ x: 13 })}" y1="12" y2="272" stroke="#36897d" stroke-dasharray="4 3"/><polyline points="${trail.map(p => `${px(p)},${py(p)}`).join(' ')}" fill="none" stroke="#d69a5b" stroke-width="1.5" opacity=".65"/><circle cx="${px(point)}" cy="${py(point)}" r="5" fill="#ec8e26"/><text x="22" y="290" font-size="11">0</text><text x="190" y="290" font-size="11">58px</text></svg>`
      captures.forEach((c, i) => {
        document.querySelectorAll('.content')[i].innerHTML = `<div class="rail"><img src="data:image/png;base64,${c.railImage}"><span class="cursor" style="left:${c.mouseX}px;top:${c.mouseY}px"></span></div><div class="info">Hover<strong>${c.selected ?? 'OFF'}</strong>Preview<br>${c.preview ? 'OPEN' : 'CLOSED'}<br><br>Peak width<strong>${Math.max(...c.widths).toFixed(1)}px</strong></div>`
      })
    }, { captures, point, trail: history.slice(-20), label: labels[step.phase], dt: step.dt, count: step.points.length, rows: pages[0].geometry.rows })
    await board.locator('.rail img').evaluateAll(images => Promise.all(images.map(img => img.decode())))
    await board.screenshot({ path: `test-results/xy-frames/${String(frame++).padStart(3, '0')}.png` })
    if (!stillCaptured && step.phase === 'edge-jitter' && captures[0].selected !== captures[1].selected) {
      await board.screenshot({ path: 'test-results/xy-random.png' }); stillCaptured = true
    }
  }
  await writeFile('test-results/xy-capture.json', JSON.stringify({ baseline, seed, frameCount: frame, replayFrameMs: 100,
    source: 'Actual baseline and experiment components, synthetic Session, controlled sample clocks; every input replayed, every second step captured; not real-time playback', plan, metrics }, null, 2))
  console.log(`${frame} seeded X/Y comparison frames captured`)
} finally { await browser.close() }
