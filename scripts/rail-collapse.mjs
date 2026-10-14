/** Collapse projection plus real strip/native-owner interaction regressions. */
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { projectRailSlots } from '../src/client/rail-slots.ts'
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
async function check(name, run, historyOnly = false) {
  const dom = new JSDOM('<!doctype html><body><main><div data-conversation-scroll><section><nav aria-label="Turns"></nav><div data-chat-flow></div></section></div></main></body>', { pretendToBeVisual: true })
  const { window } = dom, { document } = window
  Object.assign(globalThis, { window, document, Event: window.Event, MutationObserver: window.MutationObserver })
  const root = document.querySelector('main'), scroll = document.querySelector('[data-conversation-scroll]'), flow = document.querySelector('[data-chat-flow]')
  Object.defineProperties(root, { clientWidth: { value: 1280 }, clientHeight: { value: 900 } })
  Object.defineProperty(scroll, 'clientHeight', { value: 800 })
  root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 900 })
  scroll.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 800 })
  flow.getBoundingClientRect = () => ({ left: 300, top: 0, right: 1060, width: 760, height: 1000 })
  const data = railFixtureData(historyOnly), nodeMap = new Map(data.nodes.map(node => [node.key, node]))
  data.nodes.forEach((node, index) => {
    const row = document.createElement('article'); row.dataset.chatAnchorKey = node.key
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
  const target = observable({ order: data.nodes.map(node => node.key), nodes: { get: key => nodeMap.get(key), source: key => observable(nodeMap.get(key)) }, navigation: { items: () => data.navigation } })
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
    await run({ window, document, rail, bars, collapsed, point, pointer, mockWidth, press, settle, clicks, settings, selection, native, scroll, compact, read })
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
  const p = point(collapsed()); await pointer(p.x, p.y)
  assert.equal(bars().length, 4); assert.equal(collapsed().style.width, '48px')
  assert.match(document.querySelector('.smcp-tooltip').textContent, /AI · Process output \(7 segments\) · Click to expand/)
  const history = bars().find(b => b.dataset.key === 'turn:2')
  assert.ok(Math.abs(Number.parseFloat(history.style.width) - (10 + 38 * Math.exp(-1 / (2 * 1.35 ** 2)))) < 0.00001, 'wave follows adjacent displayed keys')
  assert.deepEqual(clicks, [])
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
await check('pointer leave collapses even while the rail retains focus', async ({ rail, bars, collapsed, window, settle, scroll, compact }) => {
  const top = scroll.scrollTop
  collapsed().click(); await settle()
  rail().dispatchEvent(new window.Event('pointerleave')); await settle()
  assert.equal(rail().ownerDocument.activeElement, rail()); assert.equal(bars().length, 4)
  compact(4); assert.equal(scroll.scrollTop, top)
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
await check('Escape, blur and session change retire disclosure state', async ({ rail, bars, collapsed, press, settle, selection }) => {
  collapsed().click(); await settle(); await press('Escape'); assert.equal(bars().length, 4)
  collapsed().click(); await settle(); rail().blur(); await settle(); assert.equal(bars().length, 4)
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
