/** Collapse projection plus real strip/native-owner interaction regressions. */
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { projectRailSlots } from '../src/client/rail-slots.ts'
import { buildNavigationNodes } from '../src/client/keys.ts'
import { buildPianoItems } from '../src/client/navigation-model.ts'
import { attachKeyStrip, stackPositions } from '../src/client/strip.ts'
import { installStyles } from '../src/client/styles.ts'
import { railFixtureData } from './rail-fixture-data.mjs'

const grey = Array.from({ length: 12 }, (_, i) => ({ key: `g${i}`, turn: 1, kind: 'output', role: 'assistant', anchorKey: `a${i}`, title: `Output ${i}`, preview: '' }))
const slots = (items = grey, active = 11, expanded = new Set(), protectedTurns = new Set()) => projectRailSlots(items, active, expanded, protectedTurns)
assert.deepEqual(slots().map(s => [s.start, s.end, s.sourceIndex, s.displayIndex]), [[0, 9, 4, 0], [9, 10, 9, 1], [10, 11, 10, 2], [11, 12, 11, 3]])
assert.equal(slots(grey, 6).filter(s => s.end - s.start > 1).length, 2)
for (const kind of ['input', 'question', 'answer', 'final']) {
  const items = grey.map(item => ({ ...item }))
  items[3] = { ...items[3], kind, role: kind === 'input' || kind === 'answer' ? 'user' : 'assistant' }
  assert.ok(slots(items).some(slot => slot.start === 3 && slot.end === 4), `${kind} must stay a separate key`)
}
assert.equal(slots(grey.slice(0, 2), -1)[0].sourceIndex, 0, 'representative identity stays a real member')
assert.equal(slots(grey, 11, new Set(grey.slice(0, 9).map(item => item.key))).length, 12)
assert.equal(slots(grey, 11, new Set(), new Set([1])).length, 12)
for (const extra of [{ role: 'turn', kind: undefined }, { role: 'turn', kind: 'output' }, { role: 'assistant', kind: undefined }]) {
  assert.equal(slots(grey.map(item => ({ ...item, ...extra }))).length, 12, 'history and ambiguous semantics never collapse')
}
const twoTurns = grey.slice(0, 8).map((item, i) => ({ ...item, turn: i < 4 ? 1 : 2 }))
assert.deepEqual(slots(twoTurns, -1).map(s => [s.start, s.end]), [[0, 4], [4, 8]], 'groups never cross a Turn')
assert.equal(slots([], -1).length, 0)
console.log('rail projection: process-only semantics, independent history, Turn boundaries, display indices and protection passed')

const foldedTurns = Array.from({ length: 12 }, (_, i) => ({ turn: i + 1, prompt: '', response: '', anchor: { kind: 'loaded', key: `h${i}-0` } }))
const foldedNodes = foldedTurns.flatMap(({ turn }, i) => [0, 1].map(step => ({ key: `h${i}-${step}`, kind: 'assistant-step', visibility: 'hidden', location: { turn: { turn } }, data: { blocks: [{ kind: 'text', text: `Process ${step}` }] } })))
const foldedItems = buildPianoItems(foldedTurns, buildNavigationNodes(foldedNodes), String)
assert.deepEqual(projectRailSlots(foldedItems, -1, new Set(), new Set()).map(slot => slot.end - slot.start), Array(12).fill(2), 'all twelve folded history turns produce their own complete grey key')
const foldedRun = grey.slice(0, 8).map(item => ({ ...item, folded: true }))
for (let active = -1; active <= 10; active++) {
  assert.deepEqual(projectRailSlots(foldedRun, active, new Set(), new Set()).map(slot => slot.end - slot.start), [8], 'folded prose stays one run even at or near the reader')
}
assert.equal(projectRailSlots(foldedRun, 7, new Set(foldedRun.map(item => item.key)), new Set()).length, 8, 'explicit rail expansion wins over transcript folding')
assert.equal(projectRailSlots(foldedRun, 7, new Set(), new Set([1])).length, 8, 'busy/requested/failed Turn protection is retained')
const retired = new Set(grey.map(item => item.key))
assert.equal(projectRailSlots(grey, 6, new Set(), new Set(), retired).length, 1, 'explicit retirement overrides reading proximity')
assert.equal(projectRailSlots(grey, 6, retired, new Set(), retired).length, 12, 'explicit re-expansion overrides retirement')
assert.equal(projectRailSlots(grey, 6, new Set(), new Set([1]), retired).length, 12, 'native pending/failure protection still wins')
assert.ok(foldedItems.every(item => item.folded === true), 'source folding survives the semantic-to-navigation projection')

const observable = initial => {
  let value = initial
  const listeners = new Set()
  return { getSnapshot: () => value, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) }, set(next) { value = next; for (const fn of [...listeners]) fn() } }
}
const until = async ready => {
  const deadline = Date.now() + 3000
  while (!ready()) {
    assert.ok(Date.now() < deadline, 'strip update timed out')
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}
let passed = 0
async function check(name, run, historyOnly = false, options = {}) {
  const dom = new JSDOM('<!doctype html><body><main><div data-conversation-scroll><section><nav aria-label="Turns"></nav><div data-chat-flow></div></section></div></main></body>', { pretendToBeVisual: true })
  const { window } = dom, { document } = window
  Object.assign(globalThis, { window, document, Event: window.Event, MutationObserver: window.MutationObserver })
  const root = document.querySelector('main'), scroll = document.querySelector('[data-conversation-scroll]'), flow = document.querySelector('[data-chat-flow]')
  Object.defineProperties(root, { clientWidth: { value: 1280 }, clientHeight: { value: 900 } })
  Object.defineProperty(scroll, 'clientHeight', { value: 800 })
  root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 900 })
  scroll.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 800 })
  flow.getBoundingClientRect = () => ({ left: 300, top: 0, right: 1060, width: 760, height: 1000 })
  const data = railFixtureData(historyOnly, options), nodeMap = new Map(data.nodes.map(node => [node.key, node]))
  data.nodes.forEach((node, index) => {
    const row = document.createElement('article'); row.dataset.chatAnchorKey = node.key
    if (node.visibility === 'hidden') {
      row.setAttribute('hidden', 'until-found'); row.dataset.turnProcessHidden = 'true'
      row.addEventListener('beforematch', () => row.removeAttribute('hidden'))
    }
    row.getBoundingClientRect = () => ({ top: index * 40 - scroll.scrollTop, left: 300, width: 760, height: 35 })
    flow.append(row)
  })
  let readingAnchor = data.currentAnchor
  document.elementsFromPoint = () => [flow.querySelector(`[data-chat-anchor-key="${readingAnchor}"]`)]
  const clicks = [], native = document.querySelector('nav')
  for (const { turn } of data.outline) {
    const button = document.createElement('button')
    button.setAttribute('aria-label', `${data.navigation.some(item => item.turn === turn) ? 'Jump' : 'Load'} ${turn}`)
    button.addEventListener('click', () => clicks.push(turn)); native.append(button)
  }
  const sources = new Map()
  const store = { get: key => nodeMap.get(key), source: key => {
    if (!sources.has(key)) sources.set(key, observable(nodeMap.get(key)))
    return sources.get(key)
  } }
  const target = observable({ order: data.nodes.map(node => node.key), nodes: store, navigation: { items: () => data.navigation } })
  const outline = observable(data.outline)
  const session = { ...observable({ loadingOlder: false }), sessionId: 's1', projections: { faceOf: () => outline } }
  const binding = { session }, selection = observable('s1')
  const settings = observable({ language: 'en', enabled: true, keyHeight: 2, keyGap: 12, maxVisible: 20 })
  const ctx = {
    locale: { bind: () => (key, args) => key === 'chat.turnNavigation.label' ? 'Turns' : `${key.endsWith('jumpLoad') ? 'Load' : 'Jump'} ${args.turn}` },
    sessions: { list: observable({ ids: ['s1'], byId: {}, phase: 'ready', projectionsBySession: {} }), binding: id => id === 's1' ? binding : { session: { ...session, sessionId: id } } },
    uiConversation: { binding: () => ({ target: () => target }) },
  }
  const stylesStop = installStyles()
  const stop = attachKeyStrip(ctx, () => 'Piano', selection, settings)
  const rail = () => document.querySelector('.smcp-unified')
  const bars = () => [...document.querySelectorAll('.smcp-bar')]
  const collapsed = () => document.querySelector('.smcp-bar[data-collapsed="true"]')
  const settle = async () => { await new Promise(resolve => window.requestAnimationFrame(() => window.requestAnimationFrame(resolve))) }
  const point = button => ({ x: Number.parseFloat(rail().style.left) + 1, y: Number.parseFloat(rail().style.top) + Number.parseFloat(button.style.top) + Number.parseFloat(button.style.height) / 2 })
  // jsdom does not lay out CSS; emulate only painted width for the #19 gate.
  const mockWidth = () => { for (const button of bars()) button.getBoundingClientRect = () => ({ width: Number.parseFloat(button.style.width) }) }
  const pointer = async (x, y) => { mockWidth(); rail().dispatchEvent(new window.MouseEvent('pointermove', { clientX: x, clientY: y, bubbles: true })); await settle() }
  const compact = count => {
    const list = bars().sort((a, b) => Number.parseFloat(a.style.top) - Number.parseFloat(b.style.top))
    const { keyGap, keyHeight } = settings.getSnapshot()
    assert.equal(list.length, count)
    list.forEach((bar, i) => { assert.equal(Number.parseFloat(bar.style.height), keyHeight); if (i) assert.equal(Number.parseFloat(bar.style.top) - Number.parseFloat(list[i - 1].style.top), keyGap) })
    assert.equal(Number.parseFloat(list.at(-1).style.top) - Number.parseFloat(list[0].style.top) + keyHeight, (count - 1) * keyGap + keyHeight)
  }
  const read = async key => { readingAnchor = key; scroll.dispatchEvent(new window.Event('scroll')); await settle() }
  const press = async key => { rail().dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); await settle() }
  try {
    await until(() => rail()?.hidden === false)
    await run({ window, document, rail, bars, collapsed, point, pointer, mockWidth, press, settle, clicks, settings, selection, native, scroll, compact, read, target, sources, nodeMap, flow, data, until })
    passed++; console.log(`ok ${passed} - ${name}`)
  } finally { stop(); stylesStop(); dom.window.close() }
}
await check('seven process outputs collapse into four compact slots spanning 38px', ({ bars, collapsed, compact }) => {
  assert.equal(bars().length, 4)
  assert.equal(collapsed().dataset.count, '7')
  compact(4); assert.equal(collapsed().dataset.role, 'assistant')
  assert.equal(collapsed().style.width, '10px')
  assert.equal(collapsed().style.height, '2px')
  assert.equal(Number.parseFloat(collapsed().style.top), stackPositions(4)[0] - 1)
  assert.equal(bars().find(b => b.getAttribute('aria-current') === 'true').dataset.kind, 'final')
})
await check('hover changes only feedback and wave, never expands or navigates', async ({ bars, collapsed, point, pointer, document, clicks }) => {
  const projections = globalThis.__smcpDebug.perf.railProjections
  const p = point(collapsed()); await pointer(p.x, p.y)
  assert.equal(bars().length, 4); assert.equal(collapsed().style.width, '48px')
  assert.match(document.querySelector('.smcp-tooltip').textContent, /AI · Process output \(7 segments\) · Click to expand/)
  const history = bars().find(b => b.dataset.key === 'turn:2')
  assert.ok(Math.abs(Number.parseFloat(history.style.width) - (10 + 38 * Math.exp(-1 / (2 * 1.35 ** 2)))) < 0.00001, 'wave follows adjacent displayed keys')
  assert.deepEqual(clicks, [])
  assert.equal(globalThis.__smcpDebug.perf.railProjections, projections, 'hover reuses the full projection instead of scanning history again')
})
await check('first click expands compactly without scrolling; member click delegates once', async ({ rail, bars, collapsed, settle, clicks, compact, scroll }) => {
  const top = scroll.scrollTop
  collapsed().click(); await settle()
  compact(10); assert.equal(scroll.scrollTop, top)
  assert.equal(collapsed(), null); assert.equal(bars().length, 10); assert.deepEqual(clicks, [])
  assert.ok(bars().every(b => b.style.height === '2px'))
  assert.equal(rail().ownerDocument.activeElement, rail())
  bars().find(b => b.dataset.key === 'turn:1').click()
  assert.deepEqual(clicks, [1])
})
await check('pointer leave and blur preserve explicit expansion and only retire hover', async ({ rail, bars, collapsed, window, settle, scroll, compact }) => {
  const top = scroll.scrollTop
  collapsed().click(); await settle()
  rail().dispatchEvent(new window.Event('pointerleave')); await settle()
  assert.equal(rail().ownerDocument.activeElement, rail()); compact(10)
  rail().blur(); await settle(); compact(10); assert.equal(scroll.scrollTop, top)
})
await check('focus and keyboard browsing do not expand; Enter is explicit disclosure', async ({ rail, bars, collapsed, press, document, clicks }) => {
  rail().focus(); await press('Home')
  assert.equal(bars().length, 4)
  assert.equal(document.getElementById(rail().getAttribute('aria-activedescendant')), collapsed())
  await press('Enter'); assert.equal(bars().length, 10); assert.deepEqual(clicks, [])
  await press('Enter'); assert.deepEqual(clicks, [1])
})
await check('blank right margin and hidden pitch slots are inert', async ({ rail, bars, collapsed, point, pointer, mockWidth, window, settle, clicks }) => {
  const p = point(collapsed())
  await pointer(p.x + 30, p.y)
  assert.equal(rail().getAttribute('aria-activedescendant'), null)
  mockWidth(); rail().dispatchEvent(new window.MouseEvent('click', { clientX: p.x + 30, clientY: p.y, bubbles: true })); await settle()
  await pointer(p.x, p.y - 24)
  assert.equal(rail().getAttribute('aria-activedescendant'), null)
  rail().dispatchEvent(new window.MouseEvent('click', { clientX: p.x, clientY: p.y - 24, bubbles: true })); await settle()
  assert.equal(bars().length, 4); assert.deepEqual(clicks, [])
})
await check('Escape and session change retire disclosure state', async ({ bars, collapsed, press, settle, selection }) => {
  collapsed().click(); await settle(); await press('Escape'); assert.equal(bars().length, 4)
  collapsed().click(); await settle(); selection.set('s2'); await settle(); assert.equal(bars().length, 4)
})
await check('live height settings apply equally to collapsed and ordinary keys', async ({ bars, settings, settle, collapsed, compact }) => {
  settings.set({ ...settings.getSnapshot(), keyHeight: 4, keyGap: 18 }); await settle()
  assert.ok(bars().every(b => b.style.height === '4px'))
  compact(4); collapsed().click(); await settle(); compact(10)
})
await check('keyboard can reach the last member after explicit disclosure', async ({ rail, bars, press, clicks, scroll }) => {
  rail().focus(); await press('Home'); await press('Enter')
  for (let i = 0; i < 6; i++) await press('ArrowDown')
  assert.equal(bars().length, 10)
  await press('Enter'); assert.deepEqual(clicks, [1]); assert.equal(scroll.scrollTop, 12 * 40 - 24)
})
await check('keyboard selection and two activations in one frame do not use stale slots', ({ rail, bars, window, clicks }) => {
  rail().focus()
  for (const key of ['Home', 'Enter', 'Enter']) rail().dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  assert.equal(bars().length, 10); assert.deepEqual(clicks, [1])
})
await check('bar motion is width-only and reduced-motion remains instantaneous', ({ document }) => {
  const css = document.getElementById('smcp-panel-styles').textContent
  assert.match(css, /transition: width 82ms cubic-bezier\(\.2, \.8, \.2, 1\);/)
  assert.match(css, /prefers-reduced-motion: reduce/)
  assert.doesNotMatch(css.slice(css.indexOf('.smcp-bar {'), css.indexOf('.smcp-bar-current,')), /transition:.*(?:top|height|background-color|opacity)/)
})
await check('true history entries never collapse and activate their native load on the first click', async ({ bars, collapsed, clicks, compact, settle }) => {
  compact(10); assert.equal(collapsed(), null)
  bars().find(b => b.dataset.key === 'turn:1').click(); assert.deepEqual(clicks, [1]); await settle(); compact(10)
}, true)
await check('mixed history entry stays independent and loads directly', ({ bars, clicks, compact }) => {
  compact(4); bars().find(b => b.dataset.key === 'turn:2').click(); assert.deepEqual(clicks, [2])
})
await check('all three languages name the process group correctly', async ({ collapsed, settings, settle }) => {
  for (const [language, copy] of [['en', 'AI · Process output (7 segments) · Click to expand'], ['zh', 'AI · 过程输出（7 段）· 点击展开'], ['zh-TW', 'AI · 過程輸出（7 段）· 點擊展開']]) {
    settings.set({ ...settings.getSnapshot(), language }); await settle(); assert.equal(collapsed().getAttribute('aria-label'), copy)
  }
})
await check('same selected key repositions tooltip as reading changes compression', async ({ bars, point, pointer, document, read, rail, compact }) => {
  const history = bars().find(b => b.dataset.key === 'turn:2'), p = point(history)
  await pointer(p.x, p.y)
  const tooltip = document.querySelector('.smcp-tooltip'), oldTop = tooltip.style.top
  await read('p6'); compact(7)
  assert.notEqual(tooltip.style.top, oldTop)
  assert.equal(Number.parseFloat(tooltip.style.top), Number.parseFloat(rail().style.top) + Number.parseFloat(history.style.top) + 1 - 48)
  assert.equal(document.getElementById(rail().getAttribute('aria-activedescendant')), history)
})
console.log(`${passed} rail collapse interaction tests passed`)

await check('folded history projects a complete 12-output group at the window edge and fits every member on expansion', async ({ bars, collapsed, settings, settle, press, compact, clicks }) => {
  settings.set({ ...settings.getSnapshot(), maxVisible: 15 }); await settle()
  assert.equal(collapsed().dataset.count, '12')
  assert.equal(bars().filter(b => b.dataset.role === 'turn').length, 12, 'history turns keep separate entries')
  collapsed().click(); await settle()
  assert.equal(bars().filter(b => b.dataset.kind === 'output').length, 12)
  assert.equal(collapsed(), null); compact(15); assert.deepEqual(clicks, [])
  await press('Escape'); assert.equal(collapsed().dataset.count, '12')
}, false, { processCount: 12, hidden: true, leadingHistory: 11 })

await check('passive scrolling and keyed/structural streaming updates cannot retire the expanded history window', async ({ rail, bars, collapsed, settle, read, target, nodeMap, sources, window, data }) => {
  collapsed().click(); await settle()
  const memberKeys = () => bars().filter(b => b.dataset.kind === 'output').map(b => b.dataset.key).sort()
  const before = memberKeys()
  rail().dispatchEvent(new window.Event('pointerleave')); rail().blur(); await read('u3')
  assert.deepEqual(memberKeys(), before)
  const final = { ...nodeMap.get('f3'), data: { ...nodeMap.get('f3').data, blocks: [{ kind: 'text', text: 'Streaming update' }] } }
  nodeMap.set('f3', final); sources.get('f3').set(final)
  await new Promise(resolve => setTimeout(resolve, 150)); await settle()
  assert.deepEqual(memberKeys(), before)
  const first = { ...nodeMap.get('u3'), key: 'prepended', data: { content: [{ type: 'text', text: 'Inserted input' }] } }
  nodeMap.set(first.key, first)
  target.set({ ...target.getSnapshot(), order: [first.key, ...data.nodes.map(node => node.key)] }); await settle()
  assert.deepEqual(memberKeys(), before)
}, false, { processCount: 12, hidden: true, leadingHistory: 11 })

await check('hidden output navigation reveals its native process wrapper before precise landing', async ({ bars, collapsed, settle, clicks, flow, scroll, until }) => {
  collapsed().click(); await settle()
  const member = bars().find(b => b.dataset.key.includes('p11::output'))
  assert.ok(member); member.click()
  await until(() => clicks.length === 1); await settle()
  assert.equal(flow.querySelector('[data-chat-anchor-key="p11"]').hasAttribute('hidden'), false)
  assert.deepEqual(clicks, [1]); assert.equal(scroll.scrollTop, 22 * 40 - 24)
}, false, { processCount: 12, hidden: true })

await check('longer-than-capacity groups retain every member for keyboard browsing and wheel explicitly retires expansion', async ({ rail, bars, collapsed, settings, settle, press, window, clicks, document }) => {
  settings.set({ ...settings.getSnapshot(), maxVisible: 5 }); await settle()
  assert.equal(collapsed().dataset.count, '12')
  collapsed().click(); await settle(); assert.equal(bars().length, 5)
  assert.ok(document.getElementById(rail().getAttribute('aria-activedescendant')), 'oversized expansion selects a visible member')
  await press('Home')
  for (let i = 0; i < 11; i++) await press('ArrowDown')
  assert.ok(document.getElementById(rail().getAttribute('aria-activedescendant')).dataset.key.includes('p11::output'))
  rail().dispatchEvent(new window.WheelEvent('wheel', { deltaY: -100, cancelable: true })); await settle()
  assert.equal(collapsed().dataset.count, '12'); assert.deepEqual(clicks, [])
}, false, { processCount: 12, hidden: true })
console.log(`${passed} total rail interaction tests passed`)

await check('folded outputs ignore adjacent reading protection; DOM-only reveal restores it even with hidden source nodes', async ({ bars, collapsed, read, flow, settle, nodeMap, rail }) => {
  await read('u3')
  assert.equal(collapsed().dataset.count, '8')
  assert.equal(bars().filter(b => b.dataset.kind === 'output').length, 1)
  for (const row of flow.querySelectorAll('[data-chat-anchor-key^="p"]')) row.removeAttribute('hidden')
  await settle(); await read('p7')
  assert.equal(nodeMap.get('p7').visibility, 'hidden', 'native disclosure need not republish node visibility')
  assert.equal(bars().filter(b => b.dataset.kind === 'output' && b.dataset.collapsed === 'false').length, 3)
  assert.equal(collapsed().dataset.count, '5')
  for (const row of flow.querySelectorAll('[data-chat-anchor-key^="p"]')) row.setAttribute('hidden', 'until-found')
  await settle(); await read('u3')
  assert.equal(collapsed().dataset.count, '8')
  assert.equal(bars().filter(b => b.dataset.kind === 'output').length, 1)
}, false, { processCount: 8, hidden: true })

await check('native folded DOM also overrides a visible source hint while keyed streaming retains the decision', async ({ bars, collapsed, flow, read, settle, sources, nodeMap }) => {
  for (const row of flow.querySelectorAll('[data-chat-anchor-key^="p"]')) {
    row.dataset.turnProcessHidden = 'true'; row.setAttribute('hidden', 'until-found')
  }
  await settle(); await read('u3')
  assert.equal(nodeMap.get('p7').visibility, 'visible')
  assert.equal(collapsed().dataset.count, '8')
  const next = { ...nodeMap.get('p7'), data: { ...nodeMap.get('p7').data, blocks: [{ kind: 'text', text: 'Updated hidden process' }] } }
  nodeMap.set('p7', next); sources.get('p7').set(next)
  await new Promise(resolve => setTimeout(resolve, 150)); await settle()
  assert.equal(bars().filter(b => b.dataset.kind === 'output').length, 1)
  assert.equal(collapsed().dataset.count, '8')
}, false, { processCount: 8 })
await check('a folded group containing the native active turn keeps the current-key indicator on its representative', async ({ bars, collapsed, document, native, settle }) => {
  document.elementsFromPoint = () => []
  native.querySelector('[aria-label="Jump 1"]').setAttribute('aria-current', 'true'); await settle()
  assert.equal(collapsed().dataset.count, '8')
  assert.equal(collapsed().getAttribute('aria-current'), 'true')
  assert.equal(collapsed().classList.contains('smcp-bar-current'), true)
  assert.equal(collapsed().style.width, '24px')
  assert.equal(bars().filter(b => b.getAttribute('aria-current') === 'true').length, 1)
}, false, { processCount: 8, hidden: true })
console.log(`${passed} total rail interaction tests passed including folded reading protection`)

await check('final navigation retires visible prose even when the reading line stays in the old group', async ({ bars, collapsed, settle, read, clicks, press, selection }) => {
  collapsed().click(); await settle()
  await read('p1')
  assert.equal(bars().filter(b => b.dataset.kind === 'output').length, 3)
  bars().find(b => b.dataset.kind === 'final').click(); await settle()
  const folded = () => {
    assert.equal(bars().filter(b => b.dataset.kind === 'output').length, 1)
    assert.equal(collapsed().dataset.count, '3')
    assert.equal(collapsed().getAttribute('aria-current'), 'true')
  }
  folded(); assert.deepEqual(clicks, [3])
  bars().find(b => b.dataset.kind === 'input').click(); await settle(); folded()
  await read('p2'); folded()
  collapsed().click(); await settle()
  assert.equal(bars().filter(b => b.dataset.kind === 'output').length, 3)
  await press('Escape'); folded()
  selection.set('s2'); await settle()
  assert.equal(collapsed(), null, 'retired member keys must not leak to another session with the same node keys')
}, false, { processCount: 3 })

await check('opening another group retires the old one even when reading moves into it', async ({ bars, settle, read, clicks }) => {
  const outputs = turn => bars().filter(b => b.dataset.kind === 'output' && b.dataset.turn === String(turn))
  outputs(1)[0].click(); await settle(); assert.equal(outputs(1).length, 3)
  outputs(2)[0].click(); await settle()
  assert.equal(outputs(1).length, 1); assert.equal(outputs(1)[0].dataset.count, '3')
  assert.equal(outputs(2).length, 3)
  await read('p1'); assert.equal(outputs(1).length, 1); assert.equal(outputs(2).length, 3)
  outputs(1)[0].click(); await settle()
  assert.equal(outputs(1).length, 3); assert.equal(outputs(2).length, 1)
  assert.deepEqual(clicks, [], 'group replacement never navigates')
}, false, { processCount: 3, processGroups: 2 })

await check('disabled history geometry click and keyboard retire expansion without attempting navigation', async ({ bars, collapsed, settle, native, rail, point, mockWidth, window, clicks, press }) => {
  native.querySelector('[aria-label="Load 2"]').remove(); await settle()
  const blocked = () => bars().find(b => b.dataset.key === 'turn:2')
  assert.equal(blocked().disabled, true)
  collapsed().click(); await settle()
  mockWidth(); const p = point(blocked())
  rail().dispatchEvent(new window.MouseEvent('click', { clientX: p.x, clientY: p.y, bubbles: true })); await settle()
  assert.equal(collapsed().dataset.count, '3'); assert.deepEqual(clicks, [])
  collapsed().click(); await settle()
  await press('End'); await press('ArrowUp'); await press('ArrowUp'); await press('Enter')
  assert.equal(collapsed().dataset.count, '3'); assert.deepEqual(clicks, [])
}, false, { processCount: 3 })
console.log(`${passed} total rail interaction tests passed including navigation retirement`)
