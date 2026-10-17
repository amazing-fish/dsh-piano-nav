/** Schema and persistence boundaries for user-provided semantic colors. */
import assert from 'node:assert/strict'
import { COLOR_FIELDS, DEFAULT_COLORS, paletteStyle } from '../src/core/colors.ts'
import { DEFAULT_SETTINGS, SETTINGS_FIELDS, decodeSettings, validateSettings } from '../src/core/config.ts'
import { createPianoRemoteSettings } from '../src/client/remote-settings.ts'
import { Config } from '../lib/index.js'

assert.deepEqual(decodeSettings({}), DEFAULT_SETTINGS, 'old documents keep theme defaults')
for (const field of Object.values(COLOR_FIELDS)) {
  for (const invalid of ['red', '#abc', '#12345678', 'url(https://example.test)', '#123456;display:none', 123, null]) {
    assert.equal(decodeSettings({ [field]: invalid })[field], '')
    if (invalid === null) assert.equal(Config({ [field]: invalid })[field].get(), '')
    else assert.throws(() => Config({ [field]: invalid }))
    assert.deepEqual(paletteStyle({ [field]: invalid }), {})
  }
  for (const valid of ['', '#12aBcF']) {
    assert.equal(Config({ [field]: valid })[field].get(), valid)
    assert.equal(decodeSettings({ [field]: valid })[field], valid)
    assert.doesNotThrow(() => validateSettings({ ...DEFAULT_SETTINGS, [field]: valid }))
  }
}
let stored = { enabled: true, language: 'en', keyGap: 15 }, revision = 1
const events = new Set(), writes = []
let fail = false
const remote = { settings: {
  describe: async () => ({ ok: true, value: { writable: true, namespaces: [{ ns: 'sm-context-piano', value: stored, revision }] } }),
  mutate: async (ns, ops, expected) => {
    if (fail) throw new Error('simulated failed persistence')
    assert.equal(expected, revision)
    for (const op of ops) { if (op.op === 'set') stored[op.path[0]] = op.value; else delete stored[op.path[0]] }
    revision++; writes.push(ops)
    return { ok: true, value: { ns, value: { ...stored }, revision } }
  },
}, $on: (_, listener) => { events.add(listener); return () => events.delete(listener) } }
const ready = async controller => { await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(controller.scope.getSnapshot().status, 'ready') }
let controller = createPianoRemoteSettings(remote); await ready(controller)
await Promise.all(Object.values(COLOR_FIELDS).map((field, i) => controller.scope.set(field, `#${String(i + 1).repeat(6)}`)))
assert.equal(writes.length, 6, 'concurrent edits serialize revisions')
controller.dispose(); controller = createPianoRemoteSettings(remote); await ready(controller)
assert.equal(controller.source.getSnapshot().colorQuestion, '#333333', 'fresh controller reads persisted override')
fail = true
await assert.rejects(controller.scope.set('colorQuestion', '#abcdef'))
assert.equal(controller.source.getSnapshot().colorQuestion, '#333333', 'failed write retains stored color')
fail = false
await controller.scope.reset()
assert.deepEqual(controller.source.getSnapshot(), DEFAULT_SETTINGS)
assert.deepEqual(writes.at(-1).map(op => op.path[0]).sort(), [...SETTINGS_FIELDS].sort(), 'one reset clears every field')
assert.deepEqual(paletteStyle(controller.source.getSnapshot()), {})
controller.dispose(); assert.equal(events.size, 0)
console.log('Color schema, old documents, CSS validation, persisted reload, revision queue, failed write and complete reset passed')
