/** Fixed-input product captures, not generated mockups or a frame-rate benchmark. */
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { buildRailFixture, railHtml } from './rail-browser-fixture.mjs'
const tools = createRequire(path.resolve('.browser-tools/package.json'))
const { chromium } = tools('playwright')
const baseline = 'a8894d17371f7e0843d53cbb5539b4c07bc0de54'
const bundles = [await buildRailFixture({ sourceRef: baseline }), await buildRailFixture()]
const browser = await chromium.launch({ headless: true })
await mkdir('test-results/horizontal-frames', { recursive: true })
const pages = []
try {
  for (const content of bundles) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.clock.install({ time: new Date('2026-01-01T00:00:00Z') })
    await page.setContent(railHtml)
    await page.evaluate(() => { window.historyOnly = true })
    await page.addScriptTag({ content })
    await page.clock.pauseAt(new Date('2026-01-01T00:00:10Z'))
    await page.clock.runFor(64)
    const p = await page.locator('.smcp-bar[data-key="turn:4"]').evaluate(el => {
      const r = el.getBoundingClientRect(); return { x: r.x, y: r.y + r.height / 2 }
    })
    const rail = await page.locator('.smcp-bar').evaluateAll(els => { const boxes = els.map(el => el.getBoundingClientRect()); const y = Math.min(...boxes.map(r => r.y)); return { y, height: Math.max(...boxes.map(r => r.bottom)) - y } })
    pages.push({ page, p, clip: { x: p.x - 6, y: rail.y - 4, width: 64, height: rail.height + 8 }, mouseX: 55 })
    await page.mouse.move(p.x + 55, p.y)
  }
  const board = await browser.newPage({ viewport: { width: 1180, height: 620 } })
  await board.setContent(`<!doctype html><html><style>
    *{box-sizing:border-box}body{margin:0;padding:26px 30px;background:#f5f5f2;color:#17212b;font:16px Arial}
    h1{font-size:27px;margin:0 0 7px}header p{margin:0;color:#65717b;font-size:13px}
    #phase{margin:20px 0 14px;font-size:20px;font-weight:600}main{display:grid;grid-template-columns:1fr 1fr;gap:24px}
    section{background:white;border:1px solid #dbe0e3;border-radius:16px;padding:18px;height:450px}
    h2{margin:0 0 15px;font-size:19px}.content{display:flex;gap:16px;height:366px}.rail{position:relative;flex:none;overflow:hidden;width:192px;height:366px;background:#fff;border-radius:8px}
    .rail img{width:192px;height:auto;position:absolute;top:0;left:0;image-rendering:pixelated}
    .cursor{position:absolute;width:12px;height:12px;background:#ec8e26;border:2px solid #fff;box-shadow:0 0 0 1px #a85705;border-radius:50%;transform:translate(-50%,-50%)}
    .info{flex:1;min-width:0}.width{font:26px monospace;margin:9px 0}.state{font-size:14px;margin:12px 0 22px}.preview{width:100%;height:auto;border-radius:8px}.off{font-size:14px;color:#74808a;padding-top:20px;border-top:1px solid #dbe0e3}
    footer{color:#65717b;font-size:12px;margin-top:14px}#after h2{color:#17685f}
    </style><header><h1>Horizontal pointer: entry, exit & reversal</h1><p>Actual plugin components · same input · 3× rail detail · sampled clock replay at 5× slower speed</p></header>
    <div id="phase"></div><main><section id="before"><h2>Before · master</h2><div class="content"></div></section><section id="after"><h2>Experiment · stable hover core</h2><div class="content"></div></section></main>
    <footer>Synthetic Session data. Orange dot = replayed pointer. Clicks use painted pixels; no Windows host or FPS claim.</footer></html>`)
  const plan = [
    ['Idle', 55, 4], ['Enter the key core', 1, 7], ['Hold on the key', 1, 5],
    ['Move right, beyond the core', 30, 8], ['Return to the core', 1, 7],
    ['Leave briefly', 55, 3], ['Reverse before exit finishes', 1, 8], ['Leave and settle', 55, 8],
  ]
  const metrics = []; let index = 0
  for (const [label, x, count] of plan) {
    for (const item of pages) { item.mouseX = x; await item.page.mouse.move(item.p.x + x, item.p.y) }
    for (let frame = 0; frame < count; frame++) {
      const captures = []
      for (const { page, p, clip, mouseX } of pages) {
        await page.clock.runFor(16)
        // Match native CSS transition progress to the sampled clock as well.
        await page.evaluate(() => {
          window.captureAnimations ??= new WeakMap()
          for (const animation of document.getAnimations()) {
            if (!window.captureAnimations.has(animation)) window.captureAnimations.set(animation, performance.now() - Number(animation.currentTime ?? 0))
            animation.pause(); animation.currentTime = performance.now() - window.captureAnimations.get(animation)
          }
        })
        const state = await page.evaluate(() => ({
          width: document.querySelector('.smcp-bar[data-key="turn:4"]').getBoundingClientRect().width,
          selected: document.querySelector('.smcp-bar-hover')?.dataset.key,
          preview: !!document.querySelector('.smcp-tooltip-visible'),
        }))
        const railImage = await page.screenshot({ clip })
        const previewImage = state.preview ? await page.locator('.smcp-tooltip').screenshot() : null
        captures.push({ ...state, railImage: railImage.toString('base64'), previewImage: previewImage?.toString('base64'),
          mouseX: (p.x + mouseX - clip.x) * 3, mouseY: (p.y - clip.y) * 3 })
      }
      await board.evaluate(({ label, captures }) => {
        document.querySelector('#phase').textContent = label
        captures.forEach((capture, i) => {
          document.querySelectorAll('.content')[i].innerHTML = `<div class="rail"><img src="data:image/png;base64,${capture.railImage}"><span class="cursor" style="left:${capture.mouseX}px;top:${capture.mouseY}px"></span></div><div class="info"><div>Painted key width</div><div class="width">${capture.width.toFixed(1)} px</div><div class="state">Hover ${capture.selected ? 'ON' : 'OFF'}</div>${capture.previewImage ? `<img class="preview" src="data:image/png;base64,${capture.previewImage}">` : '<div class="off">Preview closed</div>'}</div>`
        })
      }, { label, captures })
      await board.locator('.rail img').evaluateAll(images => Promise.all(images.map(img => img.decode())))
      const name = `test-results/horizontal-frames/${String(index++).padStart(3,'0')}.png`
      await board.screenshot({ path: name })
      if ((label === 'Enter the key core' && frame === 2) || (label === 'Move right, beyond the core' && frame === 2)) {
        await board.screenshot({ path: `test-results/horizontal-${label.startsWith('Enter') ? 'entry' : 'exit'}.png` })
      }
      metrics.push({ label, frame, before: { width: captures[0].width, selected: captures[0].selected }, after: { width: captures[1].width, selected: captures[1].selected } })
    }
  }
  await writeFile('test-results/horizontal-capture.json', JSON.stringify({ baseline, frameCount: index, logicalFrameMs: 16, replayFrameMs: 80, source: 'Actual components; synthetic data; controlled rAF and native CSS animation sample clocks', metrics }, null, 2))
  console.log(`${index} comparison frames captured`)
} finally { await browser.close() }
