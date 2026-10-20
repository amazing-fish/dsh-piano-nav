import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { registryRetry } from './registry-retry.mjs'
import { verifyPublished } from './verify-published.mjs'
import { validateRecovery, completeRelease } from './recover-release.mjs'

const npmError = code => Object.assign(new Error(code), { stdout: JSON.stringify({ error: { code } }) })
const waits = [], quiet = { wait: async ms => waits.push(ms), log: () => {} }
for (const code of ['E404', 'ETARGET']) {
  let calls = 0
  assert.equal(await registryRetry(() => { if (++calls < 3) throw npmError(code); return 'ready' }, quiet), 'ready')
  assert.equal(calls, 3)
}
for (const code of ['E401', 'E403', 'E500', 'ECONNRESET', 'EINTEGRITY']) {
  let calls = 0
  await assert.rejects(() => registryRetry(() => { calls++; throw npmError(code) }, quiet), new RegExp(code))
  assert.equal(calls, 1)
}
let exhausted = 0
await assert.rejects(() => registryRetry(() => { exhausted++; throw npmError('ETARGET') }, quiet), /ETARGET/)
assert.equal(exhausted, 9)
assert.ok(waits.every(ms => ms === 15000))
let stderrCalls = 0
await registryRetry(() => { if (++stderrCalls === 1) throw { stderr: 'npm error code ETARGET\n' } }, quiet)
assert.equal(stderrCalls, 2)
console.log('Registry retry: both propagation codes recover; 9-attempt bound; auth/network/integrity errors fail immediately')

const root = await mkdtemp(join(tmpdir(), 'piano-recovery-test-'))
const bytes = Buffer.from('original frozen package fixture'), source = 'a'.repeat(40)
const sha = algorithm => createHash(algorithm).update(bytes).digest('hex')
const expected = { name: 'dsh-piano-nav', version: '1.3.5', filename: 'dsh-piano-nav-1.3.5.tgz', sourceCommit: source,
  integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` }
try {
  await mkdir(join(root, 'artifacts'))
  await writeFile(join(root, 'artifacts/package-manifest.json'), JSON.stringify(expected))
  await writeFile(join(root, 'artifacts', expected.filename), bytes)
  let viewCalls = 0, packCalls = 0, installs = 0
  const caches = new Set()
  const metadata = { ...expected, repository: { url: 'git+https://github.com/amazing-fish/dsh-piano-nav.git' },
    'dist-tags': { latest: '1.3.5' }, dist: { integrity: expected.integrity, shasum: sha('sha1') }, time: { '1.3.5': '2026-10-20T06:19:43Z' } }
  const npm = args => {
    assert.ok(args.includes('--prefer-online'))
    assert.ok(args.includes('--fetch-retries=0'))
    if (args[0] === 'view') { viewCalls++; return JSON.stringify(metadata) }
    assert.equal(args[0], 'pack')
    caches.add(args[args.indexOf('--cache') + 1])
    if (++packCalls < 3) throw npmError('ETARGET')
    // Synchronous npm returns after the download is written; model that boundary.
    return JSON.stringify([{ filename: expected.filename, files: Array(12).fill({}) }])
  }
  const { copyFileSync } = await import('node:fs')
  const fixtureNpm = args => {
    const result = npm(args)
    if (args[0] === 'pack') copyFileSync(join(root, 'artifacts', expected.filename), join(args[args.indexOf('--pack-destination') + 1], expected.filename))
    return result
  }
  const verified = await verifyPublished({ root, npm: fixtureNpm, retry: operation => registryRetry(operation, quiet),
    contract: async tarball => { installs++; assert.deepEqual(await readFile(tarball), bytes) } })
  assert.equal(viewCalls, 1); assert.equal(packCalls, 3); assert.equal(caches.size, 3); assert.equal(installs, 1)
  assert.equal(verified.sha256, sha('sha256'))
  metadata['dist-tags'].latest = '1.3.6'
  await assert.rejects(() => verifyPublished({ root, npm: fixtureNpm }), /1\.3\.6/)
  await verifyPublished({ root, requireLatest: false, npm: fixtureNpm, contract: () => { installs++ } })
  assert.equal(installs, 2)
  metadata.dist.integrity = 'mismatch'
  await assert.rejects(() => verifyPublished({ root, requireLatest: false, npm: fixtureNpm }), /mismatch/)
  assert.equal(installs, 2)
  console.log('Verifier: metadata success → pack ETARGET → fresh-cache recovery → byte/installation checks; historical version and integrity failure covered')
} finally { await rm(root, { recursive: true, force: true }) }

const env = { GITHUB_REPOSITORY: 'amazing-fish/dsh-piano-nav', GITHUB_REF: 'refs/heads/master', RELEASE_COMMIT: source,
  RELEASE_VERSION: '1.3.5', RELEASE_RUN_ID: '123' }
const run = { id: 123, path: '.github/workflows/publish.yml', event: 'workflow_dispatch', status: 'completed',
  repository: { full_name: env.GITHUB_REPOSITORY }, head_repository: { full_name: env.GITHUB_REPOSITORY }, head_branch: 'master', head_sha: source }
const manifest = { name: expected.name, version: expected.version, repository: { url: `git+https://github.com/${env.GITHUB_REPOSITORY}.git` } }
validateRecovery(env, run, source, manifest)
for (const change of [{ RELEASE_RUN_ID: '124' }, { RELEASE_COMMIT: 'master' }, { RELEASE_VERSION: '1.3.6' }, { GITHUB_REF: 'refs/heads/test' }]) {
  assert.throws(() => validateRecovery({ ...env, ...change }, run, source, manifest))
}
for (const change of [{ path: '.github/workflows/verify.yml' }, { head_sha: 'b'.repeat(40) }, { status: 'in_progress' },
  { event: 'pull_request' }, { head_branch: 'test' }, { head_repository: { full_name: 'other/repo' } }]) {
  assert.throws(() => validateRecovery(env, { ...run, ...change }, source, manifest))
}
console.log('Recovery provenance: original repository/workflow/run/source/version required; failed completed publish runs remain recoverable')

function releaseFixture({ draft = true, latest = '1.3.5', missing = false } = {}) {
  const verified = { ...expected, sourceCommit: source, latest, sha256: sha('sha256'), shasum: sha('sha1'), size: bytes.length,
    byteIdentical: true, verifiedAt: '2026-10-21T00:00:00Z', checks: ['package install/load contract'] }
  const receipt = JSON.stringify(verified)
  verified.receiptSha256 = createHash('sha256').update(receipt).digest('hex')
  const state = { tag: missing ? null : { object: { type: 'commit', sha: source } },
    release: missing ? null : { id: 1, tag_name: 'v1.3.5', draft, prerelease: false, html_url: 'https://github.com/example/release', assets: [] },
    receipts: new Map(), writes: [], failUpload: false, prefix: [], pages: [] }
  const addAsset = name => {
    const asset = { id: (state.release.assets.length + 1) * 10, name, state: 'uploaded', digest: `sha256:${verified.sha256}` }
    state.release.assets.push(asset)
    if (name === 'registry-verification.json') state.receipts.set(asset.id, receipt)
  }
  const api = async (method, path, body) => {
    if (method !== 'GET') state.writes.push({ method, path, body })
    if (path.includes('/git/ref/')) return structuredClone(state.tag)
    if (path.endsWith('/git/refs')) { state.tag = { object: { type: 'commit', sha: body.sha } }; return state.tag }
    // Match GitHub's actual distinction: lookup-by-tag cannot see a draft.
    if (path.includes('/releases/tags/')) return state.release?.draft ? null : structuredClone(state.release)
    if (path.includes('/releases?')) {
      const page = Number(new URL(`https://api.github.com/${path}`).searchParams.get('page'))
      state.pages.push(page)
      return structuredClone([...state.prefix, ...(state.release ? [state.release] : [])].slice((page - 1) * 100, page * 100))
    }
    if (method === 'POST' && path.endsWith('/releases')) {
      assert.equal(state.release, null, 'cannot create a duplicate Release')
      state.release = { id: 1, ...body, assets: [], html_url: 'https://github.com/example/release' }
    }
    if (method === 'PATCH') Object.assign(state.release, body)
    return structuredClone(state.release)
  }
  return { state, addAsset, options: { api, verified, filename: expected.filename, notes: 'verified release notes',
    readAsset: id => state.receipts.get(id), upload: async (_tag, name) => {
      if (state.failUpload && name === 'registry-verification.json') throw Error('interrupted upload')
      state.writes.push({ upload: name }); addAsset(name)
    } } }
}
for (const missing of [false, true]) {
  const f = releaseFixture({ missing })
  await completeRelease(f.options)
  const writes = f.state.writes.length
  await completeRelease(f.options)
  assert.equal(f.state.writes.length, writes, 'second completion performs no writes')
  assert.equal(f.state.release.assets.length, 2)
}
{
  const f = releaseFixture()
  f.state.prefix = Array.from({ length: 100 }, (_, id) => ({ id: id + 100, tag_name: `v0.0.${id}`, draft: false }))
  await completeRelease(f.options)
  assert.deepEqual(f.state.pages, [1, 2], 'existing draft found beyond first page')
  assert.equal(f.state.writes.filter(x => x.method === 'POST' && x.path.endsWith('/releases')).length, 0, 'no replacement Release created')
}
{
  const f = releaseFixture()
  f.state.prefix = [{ ...f.state.release, id: 2 }]
  await assert.rejects(() => completeRelease(f.options), /multiple Releases/)
  assert.equal(f.state.writes.length, 0)
}
{
  const f = releaseFixture()
  f.state.failUpload = true
  await assert.rejects(() => completeRelease(f.options), /interrupted/)
  assert.equal(f.state.release.draft, true)
  f.state.failUpload = false
  await completeRelease(f.options)
  assert.equal(f.state.writes.filter(x => x.upload === expected.filename).length, 1)
}
for (const invalid of ['tag', 'tarball', 'receipt', 'prerelease']) {
  const f = releaseFixture()
  if (invalid === 'tag') f.state.tag.object.sha = 'b'.repeat(40)
  if (invalid === 'prerelease') f.state.release.prerelease = true
  if (invalid === 'tarball') { f.addAsset(expected.filename); f.state.release.assets[0].digest = 'sha256:wrong' }
  if (invalid === 'receipt') { f.addAsset('registry-verification.json'); f.state.receipts.set(10, JSON.stringify({ ...f.options.verified, sourceCommit: 'b'.repeat(40) })) }
  await assert.rejects(() => completeRelease(f.options))
  assert.equal(f.state.writes.length, 0, 'inconsistent existing state is never overwritten')
}
{
  const f = releaseFixture({ latest: '1.3.6' })
  await completeRelease(f.options)
  assert.equal(f.state.writes.find(x => x.method === 'PATCH').body.make_latest, 'false')
}
console.log('Release completion: missing/draft/public states, paginated draft lookup, interruption/resume, no duplicate uploads, conflict rejection and historical Latest preservation passed')
