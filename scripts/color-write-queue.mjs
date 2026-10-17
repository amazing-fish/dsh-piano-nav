/** Exercise actual remote settings with explicitly controlled transport completions. */
import assert from 'node:assert/strict'
import { setImmediate as tick } from 'node:timers/promises'
import { createPianoRemoteSettings } from '../src/client/remote-settings.ts'
import { COLOR_FIELDS } from '../src/core/colors.ts'
import { SETTINGS_FIELDS } from '../src/core/config.ts'

async function fixture() {
  let value = {}, revision = 1, active = 0, peak = 0
  const attempts = []
  const remote = { settings: {
    describe: async () => ({ ok: true, value: { writable: true, namespaces: [{ ns: 'sm-context-piano', value: { ...value }, revision }] } }),
    mutate: async (ns, ops, expected) => {
      const gate = Promise.withResolvers()
      const attempt = { ops: structuredClone(ops), expected, ...gate }
      attempts.push(attempt); peak = Math.max(peak, ++active)
      try {
        await gate.promise
        assert.equal(expected, revision, 'each transport call uses the current revision')
        for (const op of ops) {
          if (op.op === 'set') value[op.path[0]] = op.value
          else delete value[op.path[0]]
        }
        revision++
        return { ok: true, value: { ns, value: { ...value }, revision } }
      } finally { active-- }
    },
  }, $on: () => () => {} }
  const controller = createPianoRemoteSettings(remote)
  await tick()
  assert.equal(controller.scope.getSnapshot().status, 'ready')
  return { controller, scope: controller.scope, attempts, state: () => ({ value, revision, peak }),
    drain: async () => { for (let i = 0; i < attempts.length; i++) { attempts[i].resolve(); await tick() } },
  }
}

const warnings = [], originalWarn = console.warn
console.warn = (...args) => warnings.push(args)
let passed = 0
try {
  for (const field of Object.values(COLOR_FIELDS)) {
    const f = await fixture(), first = f.scope.set(field, '#100000')
    await tick()
    let finished = 0
    const pending = Array.from({ length: 100 }, (_, i) => f.scope.set(field, `#${(i + 2).toString(16).padStart(6, '0')}`).then(() => { finished++ }))
    assert.equal(f.attempts.length, 1)
    assert.equal(finished, 0)
    assert.equal(f.attempts[0].ops[0].value, '#100000', 'an in-flight request is immutable')
    f.attempts[0].resolve(); await tick()
    assert.equal(f.attempts.length, 2)
    assert.equal(f.attempts[1].ops[0].value, '#000065')
    assert.equal(finished, 0, 'coalesced callers wait for the retained value, not the first request')
    f.attempts[1].resolve(); await Promise.all([first, ...pending])
    assert.equal(finished, 100)
    assert.equal(f.state().value[field], '#000065')
    assert.equal(f.state().peak, 1)
    f.controller.dispose(); passed++
  }

  {
    const f = await fixture(), first = f.scope.set('colorInput', '#100000')
    await tick()
    const pending = [f.scope.set('colorInput', '#200000'), f.scope.set('colorInput', '')]
    await f.drain(); await Promise.all([first, ...pending])
    assert.deepEqual(f.attempts.map(a => a.ops[0].value), ['#100000', ''], 'automatic theme color is a valid retained final choice')
    assert.equal(f.controller.source.getSnapshot().colorInput, '')
    f.controller.dispose(); passed++
  }
  {
    const f = await fixture(), writes = [f.scope.set('colorInput', '#100000')]
    await tick()
    for (const [field, color] of [['colorInput', '#200000'], ['colorInput', '#300000'], ['colorOutput', '#400000'], ['colorInput', '#500000'], ['colorInput', '#600000']]) writes.push(f.scope.set(field, color))
    await f.drain(); await Promise.all(writes)
    assert.deepEqual(f.attempts.map(a => a.ops[0].value), ['#100000', '#300000', '#400000', '#600000'], 'different fields preserve ordering boundaries')
    assert.equal(f.state().value.colorOutput, '#400000')
    assert.equal(f.state().value.colorInput, '#600000')
    f.controller.dispose(); passed++
  }
  {
    const f = await fixture(), writes = [f.scope.set('colorInput', '#100000')]
    await tick()
    writes.push(f.scope.set('colorInput', '#200000'), f.scope.reset(Object.values(COLOR_FIELDS)), f.scope.set('colorInput', '#300000'), f.scope.unset('colorInput'), f.scope.set('colorInput', '#400000'), f.scope.reset(), f.scope.set('language', 'en'), f.scope.set('keyGap', 10), f.scope.set('keyGap', 11))
    await f.drain(); await Promise.all(writes)
    assert.deepEqual(f.attempts.map(a => a.ops.map(op => [op.op, op.path[0], op.value])), [
      [['set', 'colorInput', '#100000']], [['set', 'colorInput', '#200000']],
      Object.values(COLOR_FIELDS).map(field => ['unset', field, undefined]),
      [['set', 'colorInput', '#300000']], [['unset', 'colorInput', undefined]], [['set', 'colorInput', '#400000']],
      SETTINGS_FIELDS.map(field => ['unset', field, undefined]),
      [['set', 'language', 'en']], [['set', 'keyGap', 10]], [['set', 'keyGap', 11]],
    ])
    assert.equal(f.state().value.colorInput, undefined)
    assert.equal(f.state().value.keyGap, 11)
    f.controller.dispose(); passed++
  }
  {
    const f = await fixture(), first = f.scope.set('colorInput', '#100000')
    await tick()
    const pending = [f.scope.set('colorInput', '#200000'), f.scope.set('colorInput', '#300000')]
    const result = Promise.allSettled(pending), error = Object.assign(new Error('Config field "colorInput" is not volatile'), { code: 'settings/rejected' })
    f.attempts[0].resolve(); await first; await tick()
    const beforeWarnings = warnings.length
    f.attempts[1].reject(error)
    assert.ok((await result).every(r => r.status === 'rejected' && r.reason === error))
    assert.equal(warnings.length, beforeWarnings + 1, 'one warning per failed transport, not per coalesced caller')
    assert.equal(warnings.at(-1)[1].code, 'settings/rejected')
    assert.match(warnings.at(-1)[1].message, /not volatile/)
    assert.equal(f.controller.source.getSnapshot().colorInput, '#100000', 'failed merged write retains stored value')
    const retry = f.scope.set('colorInput', '#400000'); await tick()
    f.attempts[2].resolve(); await retry
    assert.equal(f.controller.source.getSnapshot().colorInput, '#400000')
    f.controller.dispose(); passed++
  }
  {
    const f = await fixture(), first = f.scope.set('colorInput', '#100000')
    await tick()
    const pending = f.scope.set('colorInput', '#200000'), result = Promise.allSettled([first, pending])
    f.controller.dispose(); f.attempts[0].resolve()
    const settled = await result
    assert.equal(settled[1].status, 'rejected')
    assert.equal(f.attempts.length, 1, 'disposal prevents queued transport calls')
    passed++
  }
} finally { console.warn = originalWarn }
console.log(`${passed} color write queue scenarios passed`)
