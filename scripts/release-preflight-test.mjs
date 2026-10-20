import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { validateRelease, validateArtifact } from './release-preflight.mjs'
const sha = 'a'.repeat(40), other = 'b'.repeat(40)
const manifest = { name: 'dsh-piano-nav', version: '1.3.3', repository: { url: 'git+https://github.com/amazing-fish/dsh-piano-nav.git' } }
const env = { GITHUB_REPOSITORY: 'amazing-fish/dsh-piano-nav', GITHUB_REF: 'refs/heads/master', RELEASE_COMMIT: sha, RELEASE_VERSION: '1.3.3' }
assert.doesNotThrow(() => validateRelease(manifest, env, sha, sha, 404))
for (const change of [{ GITHUB_REF: 'refs/heads/unreviewed' }, { GITHUB_REPOSITORY: 'someone/fork' }, { RELEASE_COMMIT: 'master' }, { RELEASE_VERSION: '1.3.4' }, { RELEASE_VERSION: '1.3.3-rc.1' }]) {
  assert.throws(() => validateRelease(manifest, { ...env, ...change }, sha, sha, 404))
}
assert.throws(() => validateRelease(manifest, env, other, other, 404))
assert.throws(() => validateRelease(manifest, env, sha, other, 404))
for (const status of [200, 401, 403, 429, 500, 503]) assert.throws(() => validateRelease(manifest, env, sha, sha, status))
const bytes = Buffer.from('tested tarball'), packed = { sourceCommit: sha, name: manifest.name, version: manifest.version,
  filename: 'dsh-piano-nav-1.3.3.tgz', integrity: 'sha512-' + createHash('sha512').update(bytes).digest('base64') }
assert.doesNotThrow(() => validateArtifact(packed, bytes, manifest, sha))
assert.throws(() => validateArtifact(packed, Buffer.from('changed tarball'), manifest, sha))
for (const change of [{ sourceCommit: other }, { version: '1.3.4' }, { filename: 'other.tgz' }, { name: 'other-package' }]) {
  assert.throws(() => validateArtifact({ ...packed, ...change }, bytes, manifest, sha))
}
console.log('Release guard: valid intent accepted; wrong ref/repository/version/commit, master drift, existing release and registry failures rejected')

// Market-facing release notes cannot claim unverified or mismatched publication.
const { githubReleaseNotes } = await import('./github-release-notes.mjs')
const releaseManifest = { name: 'dsh-piano-nav', version: '1.3.4' }
const verifiedRelease = { ...releaseManifest, latest: '1.3.4', sourceCommit: 'a'.repeat(40),
  byteIdentical: true, sha256: 'b'.repeat(64), publishedAt: '2026-10-19T03:00:00.000Z' }
const releaseLog = '# Changelog\n\n## 1.3.4 — release preparation\n\n- Stable groups.\n\n## 1.3.3 — earlier\n\n- Earlier change.\n'
const notes = githubReleaseNotes(releaseManifest, verifiedRelease, releaseLog, 'a'.repeat(40))
assert.match(notes, /Stable groups/)
assert.doesNotMatch(notes, /Earlier change/)
assert.match(notes, /dsh-piano-nav@1\.3\.4/)
for (const invalid of [{ version: '1.3.3' }, { sourceCommit: 'c'.repeat(40) }, { byteIdentical: false }, { publishedAt: null }, { sha256: '' }]) {
  assert.throws(() => githubReleaseNotes(releaseManifest, { ...verifiedRelease, ...invalid }, releaseLog, 'a'.repeat(40)))
}
assert.throws(() => githubReleaseNotes(releaseManifest, verifiedRelease, '## 1.3.3\nOld notes', 'a'.repeat(40)))
assert.match(githubReleaseNotes(releaseManifest, { ...verifiedRelease, latest: '1.3.5' }, releaseLog, 'a'.repeat(40), { requireLatest: false }), /Stable groups/)
assert.throws(() => githubReleaseNotes(releaseManifest, { ...verifiedRelease, latest: '1.3.5' }, releaseLog, 'a'.repeat(40)))
console.log('GitHub Release notes: exact version/source/verified artifact required; only selected changelog included')
