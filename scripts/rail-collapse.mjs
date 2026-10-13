/** Collapse projection plus real strip/native-owner interaction regressions. */
import assert from 'node:assert/strict'
import { JSDOM } from 'jsdom'
import { projectRailSlots } from '../src/client/rail-slots.ts'
import { attachKeyStrip, stackPositions } from '../src/client/strip.ts'
import { installStyles } from '../src/client/styles.ts'

const grey = Array.from({ length: 12 }, (_, i) => ({ key: `g${i}`, turn: i + 1, kind: 'output', role: 'assistant', anchorKey: `a${i}`, title: `Output ${i}`, preview: '' }))
const slots = (items = grey, active = 11, expanded = new Set(), protectedTurns = new Set()) => projectRailSlots(items, active, expanded, protectedTurns)
assert.deepEqual(slots().map(s => [s.start, s.end, s.index]), [[0, 9, 4], [9, 10, 9], [10, 11, 10], [11, 12, 11]])
assert.equal(slots(grey, 6).filter(s => s.end - s.start > 1).length, 2)
for (const kind of ['input', 'question', 'answer', 'final']) {
  const items = grey.map(item => ({ ...item }))
  items[3] = { ...items[3], kind, role: kind === 'input' || kind === 'answer' ? 'user' : 'assistant' }
  assert.ok(slots(items).some(slot => slot.start === 3 && slot.end === 4), `${kind} must stay a separate key`)
}
assert.equal(slots(grey.slice(0, 2), -1)[0].index, 0, 'even runs occupy an existing middle pitch')
assert.equal(slots(grey, 11, new Set(grey.slice(0, 9).map(item => item.key))).length, 12)
assert.ok(slots(grey, 11, new Set(), new Set([3])).some(s => s.item.key === 'g2' && s.end - s.start === 1))
assert.equal(slots([], -1).length, 0)
console.log('rail projection: center pitch, nearby keys, semantic colors, expansion and pending-turn protection passed')

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
async function check(name, run) {
  const dom = new JSDOM('<!doctype html><body><main><div data-conversation-scroll><section><nav aria-label="Turns"></nav><div data-chat-flow><article data-chat-anchor-key="u10"></article></div></section></div></main></body>', { pretendToBeVisual: true })
  const { window } = dom, { document } = window
  Object.assign(globalThis, { window, document, Event: window.Event, MutationObserver: window.MutationObserver })
  const root = document.querySelector('main'), scroll = document.querySelector('[data-conversation-scroll]'), flow = document.querySelector('[data-chat-flow]')
  Object.defineProperties(root, { clientWidth: { value: 1280 }, clientHeight: { value: 900 } })
  Object.defineProperty(scroll, 'clientHeight', { value: 800 })
  root.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 900 })
  scroll.getBoundingClientRect = () => ({ left: 0, top: 0, width: 1280, height: 800 })
  flow.getBoundingClientRect = () => ({ left: 300, top: 0, right: 1060, width: 760, height: 1000 })
  const clicks = []
  const native = document.querySelector('nav')
  for (let turn = 1; turn <= 10; turn++) {
    const button = document.createElement('button')
    button.setAttribute('aria-label', `${turn === 10 ? 'Jump' : 'Load'} ${turn}`)
    button.addEventListener('click', () => clicks.push(turn))
    native.append(button)
  }
  const node = { key: 'u10', kind: 'user', location: { turn: { turn: 10 } }, data: { content: [{ type: 'text', text: 'Current input' }] } }
  const target = observable({ order: ['u10'], nodes: { get: () => node, source: () => observable(node) }, navigation: { items: () => [{ turn: 10, anchorKey: 'u10', prompt: 'Current', response: '' }] } })
  const outline = observable(Array.from({ length: 10 }, (_, i) => ({ turn: i + 1, seq: (i + 1) * 100, prompt: `Input ${i + 1}`, response: `Output ${i + 1}` })))
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
  const press = async key => { rail().dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); await settle() }
  try {
    await until(() => rail()?.hidden === false)
    await run({ window, document, rail, bars, collapsed, point, pointer, mockWidth, press, settle, clicks, settings, selection, native })
    passed++; console.log(`ok ${passed} - ${name}`)
  } finally { stop(); stylesStop(); dom.window.close() }
}
await check('a distant run paints one standard key at its middle pitch', ({ bars, collapsed }) => {
  assert.equal(bars().length, 4)
  assert.equal(collapsed().dataset.count, '7')
  assert.equal(collapsed().dataset.key, 'turn:4')
  assert.equal(collapsed().style.width, '10px')
  assert.equal(collapsed().style.height, '2px')
  assert.equal(Number.parseFloat(collapsed().style.top), stackPositions(10)[3] - 1)
  assert.equal(bars().find(b => b.getAttribute('aria-current') === 'true').dataset.key, 'turn:10')
})
await check('hover changes only feedback and wave, never expands or navigates', async ({ bars, collapsed, point, pointer, document, clicks }) => {
  const p = point(collapsed()); await pointer(p.x, p.y)
  assert.equal(bars().length, 4); assert.equal(collapsed().style.width, '48px')
  assert.match(document.querySelector('.smcp-tooltip').textContent, /7 history keys · Click to expand/)
  assert.deepEqual(clicks, [])
})
await check('first click expands in place; a member click delegates once', async ({ rail, bars, collapsed, settle, clicks }) => {
  collapsed().click(); await settle()
  assert.equal(collapsed(), null); assert.equal(bars().length, 10); assert.deepEqual(clicks, [])
  assert.ok(bars().every(b => b.style.height === '2px'))
  assert.equal(rail().ownerDocument.activeElement, rail())
  bars().find(b => b.dataset.key === 'turn:1').click()
  assert.deepEqual(clicks, [1])
})
await check('pointer leave collapses even while the rail retains focus', async ({ rail, bars, collapsed, window, settle }) => {
  collapsed().click(); await settle()
  rail().dispatchEvent(new window.Event('pointerleave')); await settle()
  assert.equal(rail().ownerDocument.activeElement, rail()); assert.equal(bars().length, 4)
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
await check('live height settings apply equally to collapsed and ordinary keys', async ({ bars, settings, settle }) => {
  settings.set({ ...settings.getSnapshot(), keyHeight: 4, keyGap: 18 }); await settle()
  assert.ok(bars().every(b => b.style.height === '4px'))
})
await check('keyboard can reach the last member after explicit disclosure', async ({ rail, bars, press, clicks }) => {
  rail().focus(); await press('Home'); await press('Enter')
  for (let i = 0; i < 6; i++) await press('ArrowDown')
  assert.equal(bars().length, 10)
  await press('Enter'); assert.deepEqual(clicks, [7])
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
console.log(`${passed} rail collapse interaction tests passed`)
