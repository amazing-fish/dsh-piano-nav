/** Shared live color preview, exercised through the actual settings controller. */
import assert from 'node:assert/strict'
import { setImmediate as tick } from 'node:timers/promises'
import { createPianoRemoteSettings } from '../src/client/remote-settings.ts'
import { COLOR_FIELDS } from '../src/core/colors.ts'

async function fixture(initial = {}) {
  let value = { ...initial }, revision = 1, writable = true
  const requests = [], listeners = new Set(), reads = []
  let holdReads = false
  const remote = { settings: {
    describe: async () => {
      const result = { ok: true, value: { writable, namespaces: [{ ns: 'sm-context-piano', revision, value: { ...value } }] } }
      if (!holdReads) return result
      const gate = Promise.withResolvers(); reads.push({ ...gate, result }); return gate.promise
    },
    mutate: async (ns, ops) => {
      const gate = Promise.withResolvers(); requests.push({ ...gate, ops: structuredClone(ops) })
      await gate.promise
      for (const op of ops) { if (op.op === 'set') value[op.path[0]] = op.value; else delete value[op.path[0]] }
      return { ok: true, value: { ns, revision: ++revision, value: { ...value } } }
    },
  }, $on: (_, fn) => { listeners.add(fn); return () => listeners.delete(fn) } }
  const c = createPianoRemoteSettings(remote); await tick()
  return { ...c, requests, reads, persisted: () => value,
    holdReads: () => { holdReads = true },
    external: next => { value = { ...next }; revision++ },
    refresh: () => { for (const fn of listeners) fn('sm-context-piano') },
    readOnly: () => { writable = false },
  }
}
let passed = 0
const check = async (name, run) => { await run(); console.log(`ok ${++passed} - ${name}`) }
for (const field of Object.values(COLOR_FIELDS)) await check(`${field}: live preview and automatic selection precede transport`, async () => {
  const f = await fixture({ [field]: '#123456' })
  const a = f.scope.set(field, '#445566')
  assert.equal(f.source.getSnapshot()[field], '#445566')
  assert.equal(f.scope.getSnapshot().saving, true)
  assert.equal(f.persisted()[field], '#123456')
  assert.strictEqual(f.scope.getSnapshot().value, f.source.getSnapshot())
  await tick()
  const b = f.scope.set(field, '')
  assert.equal(f.source.getSnapshot()[field], '')
  f.requests[0].resolve(); await a; await tick()
  assert.equal(f.source.getSnapshot()[field], '', 'old acknowledgment cannot repaint the old color')
  f.requests[1].resolve(); await b
  assert.equal(f.scope.getSnapshot().saving, false)
  assert.equal(f.persisted()[field], '')
  f.dispose()
})
await check('failed older request preserves newer color intent', async () => {
  const f = await fixture({ colorInput: '#123456' })
  const a = f.scope.set('colorInput', '#445566').catch(error => error); await tick()
  const b = f.scope.set('colorInput', '#778899')
  f.requests[0].reject(new Error('older write failed')); assert.ok(await a instanceof Error); await tick()
  assert.equal(f.source.getSnapshot().colorInput, '#778899')
  assert.equal(f.scope.getSnapshot().saving, true)
  f.requests[1].resolve(); await b; f.dispose()
})
await check('failed latest request rolls back to the last confirmed color', async () => {
  const f = await fixture({ colorInput: '#123456' })
  const a = f.scope.set('colorInput', '#445566'); await tick()
  const b = f.scope.set('colorInput', '#778899').catch(error => error)
  f.requests[0].resolve(); await a; await tick()
  f.requests[1].reject(new Error('latest write failed')); assert.ok(await b instanceof Error)
  assert.equal(f.source.getSnapshot().colorInput, '#445566')
  assert.equal(f.scope.getSnapshot().saving, false)
  f.dispose()
})
await check('palette reset and later edit have independent rollback ownership', async () => {
  const f = await fixture({ colorInput: '#123456', colorOutput: '#654321' })
  const reset = f.scope.reset(Object.values(COLOR_FIELDS)).catch(error => error)
  assert.equal(f.source.getSnapshot().colorInput, '')
  assert.equal(f.source.getSnapshot().colorOutput, '')
  await tick(); const edit = f.scope.set('colorInput', '#778899')
  f.requests[0].reject(new Error('reset failed')); await reset; await tick()
  assert.equal(f.source.getSnapshot().colorInput, '#778899')
  assert.equal(f.source.getSnapshot().colorOutput, '#654321')
  f.requests[1].resolve(); await edit; f.dispose()
})
await check('unset previews automatic color without changing queue order', async () => {
  const f = await fixture({ colorInput: '#123456' })
  const unset = f.scope.unset('colorInput')
  assert.equal(f.source.getSnapshot().colorInput, '')
  await tick(); assert.equal(f.requests[0].ops[0].op, 'unset')
  f.requests[0].resolve(); await unset; assert.equal(f.source.getSnapshot().colorInput, ''); f.dispose()
})
await check('stale describe cannot undo a completed color write', async () => {
  const f = await fixture({ colorInput: '#123456' })
  const write = f.scope.set('colorInput', '#445566'); await tick()
  f.holdReads(); f.refresh(); await tick()
  f.requests[0].resolve(); await write
  f.reads[0].resolve(f.reads[0].result); await tick()
  assert.equal(f.source.getSnapshot().colorInput, '#445566')
  assert.equal(f.scope.getSnapshot().revision, 2); f.dispose()
})
await check('external updates are retained beneath an outstanding local color', async () => {
  const f = await fixture({ colorInput: '#123456' })
  const write = f.scope.set('colorInput', '#445566').catch(error => error); await tick()
  f.external({ colorInput: '#778899', keyGap: 18 }); f.refresh(); await tick()
  assert.equal(f.source.getSnapshot().colorInput, '#445566')
  assert.equal(f.source.getSnapshot().keyGap, 18)
  f.requests[0].reject(new Error('conflicting write failed')); await write
  assert.equal(f.source.getSnapshot().colorInput, '#778899'); f.dispose()
})
await check('non-color values keep host-confirmed semantics; read-only writes never preview', async () => {
  const f = await fixture({ keyGap: 12, colorInput: '#123456' })
  const gap = f.scope.set('keyGap', 18); assert.equal(f.source.getSnapshot().keyGap, 12)
  await tick(); f.requests[0].resolve(); await gap
  f.readOnly(); f.refresh(); await tick()
  const color = f.scope.set('colorInput', '#445566').catch(error => error)
  assert.equal(f.source.getSnapshot().colorInput, '#123456')
  assert.equal(f.scope.getSnapshot().saving, false); assert.ok(await color instanceof Error); f.dispose()
})
await check('permission loss hides the pending preview and preserves confirmed state', async () => {
  const f = await fixture({ colorInput: '#123456' })
  const write = f.scope.set('colorInput', '#445566').catch(error => error); await tick()
  f.readOnly(); f.refresh(); await tick()
  assert.equal(f.source.getSnapshot().colorInput, '#123456')
  assert.equal(f.scope.getSnapshot().saving, false)
  f.requests[0].reject(new Error('permission lost')); await write; f.dispose()
})
await check('disposal prevents late notifications and queued writes', async () => {
  const f = await fixture({ colorInput: '#123456' })
  let notifications = 0; f.scope.subscribe(() => { notifications++ })
  const a = f.scope.set('colorInput', '#445566'); await tick()
  const b = f.scope.set('colorInput', '#778899').catch(error => error)
  f.dispose(); const stopped = notifications
  f.requests[0].resolve(); await a; assert.ok(await b instanceof Error)
  assert.equal(notifications, stopped); assert.equal(f.requests.length, 1)
})
console.log(`${passed} shared color preview checks passed`)
