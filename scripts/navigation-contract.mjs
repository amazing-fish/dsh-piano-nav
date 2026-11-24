/** Modern Chat node identity and visibility regression tests. */
import assert from 'node:assert/strict'
import { buildNavigationNodes } from '../src/client/keys.ts'

const assistant = (key, turn, text, extra = {}) => ({
  key, kind: 'assistant-step', visibility: 'visible',
  location: { kind: 'step', turn, step: 0 },
  data: { blocks: [{ kind: 'text', text }] }, ...extra,
})
let passed = 0
const test = (name, run) => { run(); passed += 1; console.log(`ok ${passed} - ${name}`) }

test('location Turn is canonical and survives history prepend', () => {
  const a = assistant('a', 5, 'answer', { data: { turn: 99, blocks: [{ kind: 'text', text: 'answer' }] } })
  const before = buildNavigationNodes([a])
  const after = buildNavigationNodes([assistant('older', 4, 'older'), a])
  assert.equal(before[0].turn, 5)
  assert.equal(after[1].key, before[0].key)
})

test('adjacent outputs from different Turns are not merged', () => {
  assert.equal(buildNavigationNodes([assistant('a', 1, 'first'), assistant('b', 2, 'second')]).length, 2)
})

test('adjacent outputs with no known Turn are not speculatively merged', () => {
  assert.equal(buildNavigationNodes([
    assistant('a', undefined, 'first'), assistant('b', undefined, 'second'),
  ]).length, 2)
})

test('adjacent visible outputs in the same Turn still merge', () => {
  const keys = buildNavigationNodes([assistant('a', 1, 'first'), assistant('b', 1, 'second')])
  assert.equal(keys.length, 1)
  assert.match(keys[0].preview, /first[\s\S]*second/)
})

test('folded assistant process output stays navigable and breaks continuity on both sides', () => {
  const keys = buildNavigationNodes([
    assistant('a', 1, 'first'), assistant('hidden', 1, 'not visible', { visibility: 'hidden' }),
    assistant('b', 1, 'second'),
  ])
  assert.equal(keys.length, 3)
  assert.deepEqual(keys.map(key => key.anchorKey), ['a', 'hidden', 'b'])
  assert.equal(keys[1].preview, 'not visible')
})

test('hidden legacy assistant output participates while non-assistant hidden nodes remain excluded', () => {
  const keys = buildNavigationNodes([
    assistant('legacy', 1, 'Process', { kind: 'assistant', visibility: 'hidden' }),
    { key: 'hidden-user', kind: 'user', visibility: 'hidden', data: { content: [{ type: 'text', text: 'Excluded' }] } },
  ])
  assert.deepEqual(keys.map(key => key.anchorKey), ['legacy'])
})

test('reasoning and tools split visible output without leaking into preview', () => {
  const keys = buildNavigationNodes([assistant('a', 1, '', { data: { blocks: [
    { kind: 'text', text: 'first' }, { kind: 'reasoning', text: 'private reasoning' },
    { kind: 'tool-call', text: 'private tool data' }, { kind: 'text', text: 'second' },
  ] } })])
  assert.deepEqual(keys.map(key => key.key), ['a::output:0', 'a::output:1'])
  assert.ok(keys.every(key => !key.preview.includes('private')))
})

test('image-only user messages remain navigable', () => {
  const keys = buildNavigationNodes([{ key: 'u', kind: 'user', visibility: 'visible', location: { turn: 1 }, data: {
    content: [{ type: 'image' }],
  } }])
  assert.equal(keys[0].preview, '[image]')
})

test('empty or malformed payload does not create a phantom key', () => {
  assert.deepEqual(buildNavigationNodes([{ key: 'u', kind: 'user', data: null }]), [])
})

test('preview and title remain bounded', () => {
  const [key] = buildNavigationNodes([assistant('a', 1, 'a'.repeat(10000))])
  assert.ok(key.preview.length <= 521)
  assert.ok(key.title.length <= 141)
})

// DSH 0.2.2 emits the user's own turn input as `turn-trigger` (and a goal
// command as `command-input`) while older builds used `user`/`steering`.
// Accepting only the legacy names dropped the blue key without any error.
test('every host name for user-authored input still produces an input key', () => {
  const userNode = (key, kind, turn) => ({
    key, kind, visibility: 'visible', location: { kind: 'step', turn },
    data: { content: [{ type: 'text', text: `asked from ${kind}` }] },
  })
  for (const kind of ['user', 'steering', 'turn-trigger', 'command-input']) {
    const keys = buildNavigationNodes([userNode(`k-${kind}`, kind, 7)])
    assert.equal(keys.length, 1, `${kind} produced no key`)
    assert.equal(keys[0].kind, 'input', `${kind} did not map to an input key`)
    assert.equal(keys[0].role, 'user')
  }
})

test('a non-user kind still yields no input key', () => {
  for (const kind of ['assistant-step', 'tool-call', 'turn-process', 'context', 'turn-tail']) {
    const keys = buildNavigationNodes([{
      key: `k-${kind}`, kind, visibility: 'visible', location: { kind: 'step', turn: 3 },
      data: { content: [{ type: 'text', text: 'not user authored' }] },
    }])
    assert.equal(keys.filter(key => key.kind === 'input').length, 0, `${kind} became an input key`)
  }
})
console.log(`${passed} navigation contract tests passed`)
