/** Semantic keys against original ChatView, ChatNodeSeat and question disclosure components. */
import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import path from 'node:path'
const tools = createRequire(path.resolve('.browser-tools/package.json'))
const local = createRequire(path.resolve('package.json'))
const { build } = tools('esbuild'), { chromium } = tools('playwright')
const pinned = 'c291e7961a515f6d7af9304e7fd1d257929aef26'
const dir = path.resolve('.semantic-fixture')
await mkdir(`${dir}/vendor`, { recursive: true }); await mkdir(`${dir}/contract`, { recursive: true }); await mkdir('test-results', { recursive: true })
const sources = {
  ...Object.fromEntries(['ChatView.tsx', 'ChatView.module.css', 'ChatNodeSeat.tsx', 'searchable-hidden.ts', 'TurnNavigator.tsx', 'TurnNavigator.module.css', 'turn-rail-items.ts'].map(name => [`vendor/${name}`, `packages/client/ui-chat/src/client/chat/${name}`])),
  'contract/turn-process.ts': 'packages/client/ui-chat/src/client/contract/turn-process.ts',
  'stores.ts': 'packages/client/ui-chat/src/client/stores.ts',
  'vendor/DisclosureRow.tsx': 'packages/client/ui-primitives/src/DisclosureRow.tsx',
  'vendor/DisclosureRow.module.css': 'packages/client/ui-primitives/src/DisclosureRow.module.css',
  'vendor/AskQuestionCard.tsx': 'packages/client/ui-tool/src/client/tool/components/AskQuestionCard.tsx',
  'vendor/AskQuestionCard.module.css': 'packages/client/ui-tool/src/client/tool/components/AskQuestionCard.module.css',
  'vendor/tool.ts': 'packages/client/ui-chat/src/client/conversation-nodes/tool.ts',
  'vendor/common.ts': 'packages/client/ui-chat/src/client/conversation-nodes/common.ts',
}
const known = { 'vendor/ChatNodeSeat.tsx': '40e08dbaf72bdf166a409b9c6a1f8b4fdee3b53d', 'vendor/searchable-hidden.ts': '5a0f47c82ed527479c84bea1c36dbcbe51a31506', 'vendor/DisclosureRow.tsx': 'f04ad8986a36bc2845446f3aeb211f6fecaf281c', 'vendor/tool.ts': '15f93b146514f3d0ddb6cbd7f650c56e393bb7fd' }
const hashes = {}
await Promise.all(Object.entries(sources).map(async ([file, source]) => {
  const response = await fetch(`https://raw.githubusercontent.com/deepseek-ai/deepseek-harness/${pinned}/${source}`)
  if (!response.ok) throw new Error(`Official source ${source}: ${response.status}`)
  const bytes = Buffer.from(await response.arrayBuffer())
  const hash = createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex')
  if (known[file]) assert.equal(hash, known[file], file)
  hashes[file] = hash; await writeFile(`${dir}/${file}`, bytes)
}))
await writeFile(`${dir}/helpers.ts`, 'export const SessionSeq = (value: number) => value; export default function clsx(...values: unknown[]): string { return values.flatMap(value => typeof value === "string" ? [value] : value && typeof value === "object" ? Object.entries(value).filter(([, yes]) => yes).map(([key]) => key) : []).join(" ") }')
await build({
  entryPoints: ['scripts/semantic-browser-fixture.tsx'], outfile: `${dir}/fixture.js`, bundle: true, format: 'iife', platform: 'browser', jsx: 'automatic',
  nodePaths: [path.resolve('.browser-tools/node_modules')],
  loader: { '.css': 'local-css' }, define: { 'process.env.NODE_ENV': '"development"' },
  plugins: [{ name: 'non-business-leaves', setup(b) {
    b.onResolve({ filter: /^(\.\/MessageItem\.tsx|\.\/message-chrome\.ts|\.\/icons\/index\.tsx|@deepseek-ai\/dsh-client-ui-primitives)$/ }, () => ({ path: path.resolve('scripts/semantic-browser-leaves.tsx') }))
    b.onResolve({ filter: /^(clsx|@deepseek-ai\/dsh-session\/types)$/ }, () => ({ path: `${dir}/helpers.ts` }))
    b.onResolve({ filter: /^(zustand(?:\/.*)?|immer)$/ }, args => ({ path: tools.resolve(args.path) }))
    b.onResolve({ filter: /^react(?:\/.*)?$/ }, args => ({ path: local.resolve(args.path) }))
  } }],
})
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><style>
body{margin:0;font:14px Arial;background:#f3f4f6;color:#202124}main{position:relative;margin:24px;background:white;border:1px solid #ddd}
body[data-ds-dark-theme]{background:#15151b;color:#eee}body[data-ds-dark-theme] main{background:#24242b}
[data-conversation-scroll]{height:680px;overflow-y:auto;--dsh-chat-content-width:760px;--dsh-composer-side-clearance:0px;--dsh-conversation-viewport-height:680px;--dsh-composer-height:0px;--dsw-alias-border-l4:#aaa}
</style></head><body><main><div data-conversation-scroll tabindex="0"><div id="chat"></div></div></main><script src="/fixture.js"></script></body></html>`
const server = createServer(async (req, res) => {
  if (new URL(req.url, 'http://localhost').pathname === '/') { res.setHeader('Content-Type', 'text/html'); res.end(html); return }
  if (!['/fixture.js', '/fixture.css'].includes(req.url)) { res.writeHead(404); res.end(); return }
  res.setHeader('Content-Type', req.url.endsWith('css') ? 'text/css' : 'application/javascript'); res.end(await readFile(dir + req.url))
})
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true })
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' })
await context.tracing.start({ screenshots: true, snapshots: true })
const page = await context.newPage()
let errors = [], passed = 0
const darkContrast = []
page.on('pageerror', error => errors.push(error.message))
const key = (kind, turn = 2) => page.locator(`.smcp-bar[data-kind="${kind}"][data-turn="${turn}"]`)
const start = async (query = '') => { errors = []; await page.goto(`http://127.0.0.1:${server.address().port}/${query}`); await page.waitForFunction(() => window.__smcpDebug?.mode === 'piano') }
const activate = async locator => {
  const box = await locator.boundingBox(); assert.ok(box); await page.mouse.click(box.x + 1, box.y + box.height / 2)
}
const colour = locator => locator.evaluate(el => getComputedStyle(el).backgroundColor)
const rowTop = selector => page.locator(selector).evaluate(el => el.getBoundingClientRect().top - el.closest('[data-conversation-scroll]').getBoundingClientRect().top)
async function test(name, run, query = '') { await start(query); await run(); assert.deepEqual(errors, []); passed++; console.log(`ok ${passed} - ${name}`) }
try {
  await test('real nested locations retain user inputs and one final key per closed Turn', async () => {
    assert.equal(await key('input', 1).count(), 1); assert.equal(await key('input').count(), 1)
    assert.equal(await key('final', 1).count(), 1); assert.equal(await key('final').count(), 1)
    assert.ok((await key('final').getAttribute('aria-label')).includes('Final result'))
  })
  await test('Normal mode keeps the final message separate from adjacent process prose', async () => {
    await page.evaluate(() => window.semanticFixture.normal())
    await page.waitForFunction(() => document.querySelectorAll('.smcp-bar[data-kind="output"]').length === 2)
    await activate(key('final', 1)); await page.waitForTimeout(100)
    assert.ok(Math.abs(await rowTop('[data-chat-anchor-key="f1"]') - 24) < 3)
    assert.ok(!(await key('final', 1).getAttribute('aria-label')).includes('PROCESS_1'))
  })
  await test('Compact process output keys reveal original ChatNodeSeat rows before precise landing', async () => {
    assert.equal(await page.locator('[data-chat-anchor-key="p1"]').getAttribute('hidden'), 'until-found')
    assert.equal(await key('output', 1).count(), 1)
    await activate(key('output', 1))
    await page.waitForFunction(() => !document.querySelector('[data-chat-anchor-key="p1"]').hasAttribute('hidden'))
    // Native disclosure becomes visible before the landing task resumes on rAF.
    // Wait for the same precise offset instead of treating unhide as completion.
    await page.waitForFunction(() => {
      const row = document.querySelector('[data-chat-anchor-key="p1"]')
      return Math.abs(row.getBoundingClientRect().top - row.closest('[data-conversation-scroll]').getBoundingClientRect().top - 24) < 3
    })
    assert.equal((await page.evaluate(() => window.semanticFixture.summary())).submissionCalls, 0)
  })
  await test('Compact mode exposes hidden-source question/answer keys and answer landing reveals the native process', async () => {
    assert.equal(await page.locator('[data-chat-anchor-key="tool2"]').getAttribute('hidden'), 'until-found')
    assert.equal(await key('question').count(), 2); assert.equal(await key('answer').count(), 2)
    await activate(key('answer').first())
    await page.waitForFunction(() => !document.querySelector('[data-chat-anchor-key="tool2"]').hasAttribute('hidden'))
    await page.waitForSelector('[data-chat-call-id="qa"] [data-disclosure-row][aria-expanded="true"]')
    assert.equal(await page.locator('[data-tool="ask_user_question"] dl').isVisible(), true)
    assert.equal((await page.evaluate(() => window.semanticFixture.summary())).submissionCalls, 0)
    assert.ok(await rowTop('[data-chat-anchor-key="call:qa"]') < 650)
  })
  await test('hidden-source question landing opens its process and question card without submitting', async () => {
    assert.equal(await page.locator('[data-chat-anchor-key="tool2"]').getAttribute('hidden'), 'until-found')
    assert.equal(await key('question').count(), 2)
    await activate(key('question').first())
    await page.waitForSelector('[data-chat-call-id="qa"] [data-disclosure-row][aria-expanded="true"]')
    assert.equal(await page.locator('[data-chat-anchor-key="tool2"]').getAttribute('hidden'), null)
    assert.equal((await page.evaluate(() => window.semanticFixture.summary())).submissionCalls, 0)
    await page.waitForFunction(() => {
      const row = document.querySelector('[data-chat-anchor-key="call:qa"]'), port = row.closest('[data-conversation-scroll]')
      const offset = row.getBoundingClientRect().top - port.getBoundingClientRect().top
      const target = Math.max(0, Math.min(port.scrollHeight - port.clientHeight, port.scrollTop + offset - 24))
      return Math.abs(port.scrollTop - target) < 3 && offset >= 0 && offset < port.clientHeight
    })
  })
  await test('pending questions gain recorded user-answer keys and final output on completion', async () => {
    await page.evaluate(() => window.semanticFixture.waiting())
    await page.waitForFunction(() => document.querySelectorAll('.smcp-bar[data-kind="answer"]').length === 0)
    assert.equal(await key('final').count(), 0)
    assert.ok((await key('question').first().getAttribute('aria-label')).includes('Awaiting your answer'))
    await key('question').first().evaluate(el => { window.savedQuestionKey = el })
    await page.evaluate(() => window.semanticFixture.answer())
    await page.waitForFunction(() => document.querySelectorAll('.smcp-bar[data-kind="answer"]').length === 2)
    assert.equal(await key('question').first().evaluate(el => el === window.savedQuestionKey), true)
    assert.equal(await key('final').count(), 1)
  })
  await test('navigation-only publications recover question/answer keys with unchanged order and node store', async () => {
    const before = await page.evaluate(() => ({ ...window.__smcpDebug.perf }))
    await page.evaluate(() => window.semanticFixture.navigationOnly(false))
    await page.waitForFunction(() => window.__smcpDebug.questions().display.unassembled === 4)
    assert.equal(await key('question').count(), 0); assert.equal(await key('answer').count(), 0)
    await page.evaluate(() => window.semanticFixture.navigationOnly(true))
    await page.waitForFunction(() => document.querySelectorAll('.smcp-bar[data-kind="answer"]').length === 2)
    const after = await page.evaluate(() => ({ ...window.__smcpDebug.perf }))
    assert.equal(after.nodeRebuilds, before.nodeRebuilds, 'navigation-only update does not rebuild semantic nodes')
    assert.equal(after.turnRebuilds, before.turnRebuilds + 2)
    const diagnostic = await page.evaluate(() => window.__smcpDebug.questions())
    assert.equal(diagnostic.projection.questionKeys, 2); assert.equal(diagnostic.projection.answerKeys, 2)
    assert.equal(diagnostic.display.unassembled, 0); assert.equal(diagnostic.display.assembled, 4)
    assert.ok(!JSON.stringify(diagnostic).includes('Which route'))
  })
  await test('question location recovery and absent native anchors are distinguishable without content', async () => {
    await page.evaluate(() => window.semanticFixture.locateQuestion(false))
    await page.waitForFunction(() => window.__smcpDebug.questions().projection.missingTurn === 1 && window.__smcpDebug.questions().display.assembled === 0)
    assert.equal(await key('question').count(), 0)
    await page.evaluate(() => window.semanticFixture.locateQuestion(true))
    await page.waitForFunction(() => document.querySelectorAll('.smcp-bar[data-kind="answer"]').length === 2)
    await page.evaluate(() => window.semanticFixture.dropQuestionAnchor())
    await page.waitForFunction(() => window.__smcpDebug.questions().display.unavailableAnchors === 4 && window.__smcpDebug.questions().display.assembled === 0)
    assert.equal((await page.evaluate(() => window.__smcpDebug.questions())).projection.answerKeys, 2)
  })
  await test('semantic palette distinguishes output, input, answer, question and final in light/dark themes', async () => {
    await page.evaluate(() => window.semanticFixture.normal())
    await page.waitForFunction(() => document.querySelectorAll('.smcp-bar[data-kind="output"]').length > 0)
    const input = key('input').first(), output = key('output', 1).first(), answer = key('answer').first()
    const question = key('question').first(), final = key('final').first()
    const rgb = value => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
    const neutral = ([r, g, b]) => Math.max(r, g, b) - Math.min(r, g, b) <= 32
    const blue = ([r, g, b]) => b > g && g > r
    const green = ([r, g, b]) => g > r && g > b
    const amber = ([r, g, b]) => r > g && g > b
    const purple = ([r, g, b]) => b > r && r > g
    const paintedContrast = async locator => locator.evaluate(el => {
      const parse = value => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
      const style = getComputedStyle(el)
      const surface = getComputedStyle(document.querySelector('main'))
      const fg = parse(style.backgroundColor)
      const bg = parse(surface.backgroundColor)
      const opacity = Number.parseFloat(style.opacity || '1')
      const mixed = fg.map((value, index) => value * opacity + bg[index] * (1 - opacity))
      const lum = values => values
        .map(value => value / 255)
        .map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
      const [lighter, darker] = [lum(mixed), lum(bg)].sort((a, b) => b - a)
      return { ratio: (lighter + .05) / (darker + .05), mixed, opacity }
    })
    assert.ok(neutral(rgb(await colour(output))), 'ordinary AI output should stay neutral')
    assert.ok(blue(rgb(await colour(input))), 'user input should stay blue')
    assert.ok(green(rgb(await colour(answer))), 'recorded user answer should be green')
    assert.ok(amber(rgb(await colour(question))), 'AI question should be amber')
    assert.ok(purple(rgb(await colour(final))), 'AI final result should stay purple')
    for (const [name, locator] of [['output', output], ['input', input], ['answer', answer], ['question', question], ['final', final]]) {
      const painted = await paintedContrast(locator)
      assert.ok(painted.ratio >= 3, `${name} should keep >=3:1 painted contrast in light theme; got ${painted.ratio.toFixed(2)}`)
    }
    await activate(answer); assert.ok(green(rgb(await colour(answer))), 'active answer should remain green')
    await activate(final); assert.ok(purple(rgb(await colour(final))), 'active final should remain purple')
    await page.screenshot({ path: 'test-results/semantic-keys-light.png', fullPage: true })
    await page.evaluate(() => document.body.setAttribute('data-ds-dark-theme', 'true'))
    const darkOutput = rgb(await colour(output)), darkInput = rgb(await colour(input))
    const darkAnswer = rgb(await colour(answer)), darkQuestion = rgb(await colour(question)), darkFinal = rgb(await colour(final))
    assert.ok(neutral(darkOutput) && Math.min(...darkOutput) >= 220, 'dark-theme ordinary output should be white/near-white')
    assert.ok(blue(darkInput), 'dark-theme input should stay blue')
    assert.ok(green(darkAnswer), 'dark-theme answer should stay green')
    assert.ok(amber(darkQuestion), 'dark-theme question should stay amber')
    assert.ok(purple(darkFinal), 'dark-theme final should stay purple')
    for (const [name, locator] of [['output', output], ['input', input], ['answer', answer], ['question', question], ['final', final]]) {
      const painted = await paintedContrast(locator)
      assert.ok(painted.ratio >= 3, `${name} should keep >=3:1 painted contrast in dark theme; got ${painted.ratio.toFixed(2)}`)
    }
    const contrast = await page.locator('.smcp-tooltip').evaluate(el => {
      const rgb = value => (value.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number)
      const luminance = values => values.map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4)
        .reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0)
      const background = luminance(rgb(getComputedStyle(el).backgroundColor))
      return ['.smcp-key-label', '.smcp-tooltip-title', '.smcp-tooltip-body'].map(selector => {
        const foreground = luminance(rgb(getComputedStyle(el.querySelector(selector)).color))
        return { selector, ratio: (Math.max(background, foreground) + .05) / (Math.min(background, foreground) + .05) }
      })
    })
    for (const value of contrast) assert.ok(value.ratio >= 4.5, `${value.selector}: contrast ${value.ratio}`)
    darkContrast.push(...contrast)
    await page.screenshot({ path: 'test-results/semantic-keys-dark.png', fullPage: true })
  })
  await test('question answer preview preserves custom multi-select content and roles', async () => {
    const answer = key('answer').last(), box = await answer.boundingBox(); assert.ok(box)
    await page.mouse.move(box.x + 1, box.y + box.height / 2)
    await page.waitForFunction(() => document.querySelector('.smcp-tooltip')?.textContent.includes('Windows'))
    assert.equal(await answer.getAttribute('data-role'), 'user'); assert.ok((await answer.getAttribute('aria-label')).includes('User · Answer'))
  })
  await test('disabling during disclosure cancels pending local landing without submission', async () => {
    await key('question').first().evaluate(el => { el.click(); window.semanticFixture.disable() })
    await page.waitForSelector('.smcp-unified', { state: 'detached' }); await page.waitForTimeout(100)
    assert.equal(await page.locator('nav[aria-label="Turn navigation"]').getAttribute('aria-hidden'), null)
    assert.equal((await page.evaluate(() => window.semanticFixture.summary())).submissionCalls, 0)
  })
  await test('session disappearance invalidates an in-flight question reveal', async () => {
    await key('question').first().evaluate(el => { el.click(); window.semanticFixture.disappear() })
    await page.waitForSelector('.smcp-unified', { state: 'detached' }); await page.waitForTimeout(100)
    assert.equal((await page.evaluate(() => window.semanticFixture.summary())).submissionCalls, 0)
  })
  for (const mode of ['compact', 'normal']) await test(`${mode} folded group first click lands on its first row and wheel preserves expansion`, async () => {
    if (mode === 'normal') await page.evaluate(() => window.semanticFixture.normal())
    await activate(key('input', 1))
    const group = page.locator('.smcp-bar[data-kind="output"][data-turn="2"][data-collapsed="true"]')
    if (mode === 'compact') assert.equal(await page.locator('[data-chat-anchor-key="p2"]').getAttribute('hidden'), 'until-found')
    await activate(group)
    await page.waitForFunction(() => {
      const row = document.querySelector('[data-chat-anchor-key="p2"]')
      return !row.hasAttribute('hidden') && Math.abs(row.getBoundingClientRect().top - row.closest('[data-conversation-scroll]').getBoundingClientRect().top - 24) < 3
    })
    assert.equal(await key('output').count(), 3)
    const rail = page.locator('.smcp-unified'), box = await rail.boundingBox()
    const top = await page.locator('[data-conversation-scroll]').evaluate(el => el.scrollTop)
    await page.mouse.move(box.x + 1, box.y + box.height / 2)
    for (const delta of [100, -100]) {
      await page.mouse.wheel(0, delta); await page.waitForTimeout(100)
      assert.equal(await group.count(), 0)
      assert.equal(await key('output').count(), 3)
      assert.equal(await page.locator('[data-conversation-scroll]').evaluate(el => el.scrollTop), top)
    }
    await page.screenshot({ path: `test-results/grey-first-landing-${mode}.png`, fullPage: true })
    assert.equal((await page.evaluate(() => window.semanticFixture.summary())).submissionCalls, 0)
  }, '?processCount=3&processOnly=1')
  for (const mode of ['compact', 'normal']) await test(`${mode} process group stays folded after the last purple key and subsequent navigation`, async () => {
    if (mode === 'normal') await page.evaluate(() => window.semanticFixture.normal())
    const group = page.locator('.smcp-bar[data-kind="output"][data-turn="2"][data-collapsed="true"]')
    const waitFolded = () => page.waitForFunction(() => {
      const bars = document.querySelectorAll('.smcp-bar[data-kind="output"][data-turn="2"]')
      return bars.length === 1 && bars[0].getAttribute('data-count') === '3'
    })
    await activate(key('input', 1)); await waitFolded()
    if (mode === 'compact') {
      await activate(group)
      await page.waitForFunction(() => document.querySelectorAll('.smcp-bar[data-kind="output"][data-turn="2"]').length === 3)
      await activate(key('output').first())
      await page.waitForFunction(() => !document.querySelector('[data-chat-anchor-key="p2"]').hasAttribute('hidden'))
      assert.equal(await key('output').count(), 3, 'native process reveal preserves the disclosed navigation list')
      await activate(key('final')); await waitFolded()
    }
    await activate(group)
    await page.waitForFunction(() => document.querySelectorAll('.smcp-bar[data-kind="output"][data-turn="2"]').length === 3)
    await activate(key('final')); await waitFolded()
    assert.equal(await group.getAttribute('aria-current'), 'true', 'reading inside the retired group highlights its folded representative')
    await page.screenshot({ path: `test-results/navigation-retired-${mode}.png`, fullPage: true })
    for (const target of [key('input'), key('final', 1), key('input', 1)]) { await activate(target); await waitFolded() }
    await activate(group)
    await page.waitForFunction(() => document.querySelectorAll('.smcp-bar[data-kind="output"][data-turn="2"]').length === 3)
    await activate(key('output').first())
    await page.waitForFunction(() => !document.querySelector('[data-chat-anchor-key="p2"]').hasAttribute('hidden'))
    await activate(key('output').nth(1))
    assert.equal(await key('output').count(), 3, 'consecutive native member navigation keeps the group open')
    await activate(key('final')); await waitFolded()
    assert.equal(await page.locator('[data-chat-anchor-key="p2"]').getAttribute('hidden'), null, 'rail retirement keeps native process contents visible')
    assert.equal((await page.evaluate(() => window.semanticFixture.summary())).submissionCalls, 0)
  }, '?processCount=3&processOnly=1')
  await writeFile('test-results/semantic-browser-summary.json', JSON.stringify({ passed, pinned, hashes, errors, darkContrast, note: 'Original ChatView, ChatNodeSeat, searchable-hidden, stores, DisclosureRow and AskQuestionCard; synthetic transport/messages and icon/classname helpers.' }, null, 2))
  console.log(`${passed} semantic Chromium checks passed`)
} catch (error) {
  await page.screenshot({ path: 'test-results/semantic-failure.png', fullPage: true })
  await writeFile('test-results/semantic-failure.txt', `${error.stack}\n${JSON.stringify(errors)}\n${await page.content()}`)
  throw error
} finally {
  await context.tracing.stop({ path: 'test-results/semantic-trace.zip' }); await browser.close(); await new Promise(resolve => server.close(resolve))
}
