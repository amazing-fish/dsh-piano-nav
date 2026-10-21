/** Release only a version increase from the exact, successfully verified push. */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
const verify = await readFile('.github/workflows/verify.yml', 'utf8')
assert.match(verify, /push:\s*\n\s+branches:\s*\[master\]/, 'master merges must run the complete verification workflow')
const { capturePushIntent, resolveRelease } = await import('./release-trigger.mjs')
const publish = await readFile('.github/workflows/publish.yml', 'utf8')
assert.match(publish, /workflow_run:\s*\n\s+workflows: \[Navigator compatibility\]/)
assert.match(publish, /branches: \[master\]\s*\n\s+types: \[completed\]/)
assert.match(verify, /run: node scripts\/release-trigger\.mjs prepare/)
assert.match(publish, /run-id: \$\{\{ github\.event\.workflow_run\.id \}\}/)
assert.match(publish, /if: needs\.resolve\.outputs\.publish == 'true'/)
assert.match(publish, /needs: \[resolve, publish\]/)
assert.match(publish, /RELEASE_COMMIT: \$\{\{ needs\.resolve\.outputs\.commit \}\}/)
assert.match(publish, /id-token: write/)
assert.match(publish, /group:.*ignored-publish-/)

const repository = 'amazing-fish/dsh-piano-nav', ref = 'refs/heads/master'
const before = 'a'.repeat(40), head = 'b'.repeat(40), other = 'c'.repeat(40)
const previous = { name: 'dsh-piano-nav', version: '1.3.5' }, manifest = { ...previous, version: '1.3.6' }
const push = { repository: { full_name: repository }, ref, before, after: head, deleted: false, forced: false }
const intent = capturePushIntent(push, head, previous, manifest)
assert.equal(intent.publish, true); assert.equal(intent.commit, head)
assert.equal(capturePushIntent(push, head, manifest, manifest).publish, false)
for (const v of ['1.4.0', '2.0.0', '10.0.0']) assert.equal(capturePushIntent(push, head, previous, { ...manifest, version: v }).publish, true)
for (const v of ['1.3.4', '1.2.99', '0.99.99', '1.3.6-rc.1', '01.3.6', '1.3.6\npublish=true']) {
  assert.throws(() => capturePushIntent(push, head, previous, { ...manifest, version: v }))
}
for (const change of [{ ref: 'refs/heads/feature' }, { before: '0'.repeat(40) }, { before: head }, { after: other },
  { forced: true }, { deleted: true }, { repository: { full_name: 'someone/fork' } }]) {
  assert.throws(() => capturePushIntent({ ...push, ...change }, head, previous, manifest))
}
const run = { event: 'push', status: 'completed', conclusion: 'success', name: 'Navigator compatibility',
  path: '.github/workflows/verify.yml', head_repository: { full_name: repository }, head_branch: 'master', head_sha: head }
const env = { GITHUB_EVENT_NAME: 'workflow_run', GITHUB_REPOSITORY: repository, GITHUB_REF: ref }
const input = { event: { workflow_run: run }, env, intent, previous, manifest, head, master: head }
assert.deepEqual(resolveRelease(input), { publish: true, version: '1.3.6', commit: head })
for (const change of [{ event: 'pull_request' }, { conclusion: 'failure' }, { conclusion: 'cancelled' }, { status: 'in_progress' },
  { name: 'Unrelated build' }, { path: '.github/workflows/untrusted.yml' }, { head_repository: { full_name: 'someone/fork' } },
  { head_branch: 'feature' }, { head_sha: other }]) {
  assert.throws(() => resolveRelease({ ...input, event: { workflow_run: { ...run, ...change } } }))
}
for (const change of [{ schema: 2 }, { publish: false }, { version: '1.3.7' }, { commit: other }, { repository: 'someone/fork' }, { before: 'master' }]) {
  assert.throws(() => resolveRelease({ ...input, intent: { ...intent, ...change } }))
}
assert.throws(() => resolveRelease({ ...input, master: other }))
for (const change of [{ GITHUB_EVENT_NAME: 'pull_request' }, { GITHUB_REPOSITORY: 'someone/fork' }, { GITHUB_REF: 'refs/heads/feature' }]) {
  assert.throws(() => resolveRelease({ ...input, env: { ...env, ...change } }))
}
assert.equal(resolveRelease({ ...input, intent: capturePushIntent(push, head, manifest, manifest), previous: manifest, master: other }).publish, false)
const manual = { ...input, intent: undefined, previous: undefined, env: { ...env, GITHUB_EVENT_NAME: 'workflow_dispatch' }, event: { inputs: { commit: head, version: '1.3.6' } } }
assert.equal(resolveRelease(manual).publish, true)
assert.throws(() => resolveRelease({ ...manual, master: other }))
for (const change of [{ commit: 'master' }, { commit: other }, { version: '1.3.5' }, { version: '1.3.6-rc.1' }]) {
  assert.throws(() => resolveRelease({ ...manual, event: { inputs: { ...manual.event.inputs, ...change } } }))
}
console.log('Release trigger: version increases selected; unchanged versions skip; untrusted/failed runs, tampered intent, wrong source and master drift rejected')

// Exercise both CLIs with real Git history. A batch push may bump the version
// before its final commit, so HEAD^ alone cannot recover the original intent.
const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
const { tmpdir } = await import('node:os')
const { join, resolve } = await import('node:path')
const { execFileSync } = await import('node:child_process')
const root = await mkdtemp(join(tmpdir(), 'piano-release-trigger-'))
const script = resolve('scripts/release-trigger.mjs')
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
const commit = message => { git(['add', '.']); git(['-c', 'user.name=Release contract', '-c', 'user.email=contract@example.invalid', 'commit', '-m', message]); return git(['rev-parse', 'HEAD']) }
const eventFile = join(root, 'event.json'), output = join(root, 'output')
const invoke = (mode, eventName) => execFileSync(process.execPath, [script, mode], { cwd: root, encoding: 'utf8', env: {
  ...process.env, ...env, GITHUB_EVENT_NAME: eventName, GITHUB_EVENT_PATH: eventFile, GITHUB_OUTPUT: output,
}, stdio: ['ignore', 'pipe', 'pipe'] })
try {
  git(['init', '-b', 'master']); git(['remote', 'add', 'origin', root])
  await writeFile(join(root, 'package.json'), JSON.stringify(previous)); const base = commit('old version')
  await writeFile(join(root, 'package.json'), JSON.stringify(manifest)); const bumped = commit('new version')
  await writeFile(join(root, 'notes.txt'), 'same batch, later documentation'); const after = commit('batch tail')
  await writeFile(eventFile, JSON.stringify({ ...push, before: base, after }))
  invoke('prepare', 'push')
  const batch = JSON.parse(await readFile(join(root, 'artifacts/release-intent.json'), 'utf8'))
  assert.equal(batch.publish, true); assert.equal(batch.before, base); assert.equal(batch.commit, after)
  await writeFile(eventFile, JSON.stringify({ workflow_run: { ...run, head_sha: after } }))
  invoke('resolve', 'workflow_run')
  assert.match(await readFile(output, 'utf8'), new RegExp(`publish=true\\nversion=1.3.6\\ncommit=${after}`))
  // Unchanged version does not reach the publishing job.
  await writeFile(eventFile, JSON.stringify({ ...push, before: bumped, after }))
  invoke('prepare', 'push'); await writeFile(output, '')
  await writeFile(eventFile, JSON.stringify({ workflow_run: { ...run, head_sha: after } }))
  invoke('resolve', 'workflow_run'); assert.match(await readFile(output, 'utf8'), /publish=false/)
  // Manual recovery of an unpublished release does not require a CI artifact.
  await rm(join(root, 'artifacts/release-intent.json')); await writeFile(output, '')
  await writeFile(eventFile, JSON.stringify({ inputs: { commit: after, version: '1.3.6' } }))
  invoke('resolve', 'workflow_dispatch'); assert.match(await readFile(output, 'utf8'), /publish=true/)
} finally { await rm(root, { recursive: true, force: true }) }
console.log('Release CLI: real Git batch push, unchanged-version skip, exact output SHA and manual fallback passed')
