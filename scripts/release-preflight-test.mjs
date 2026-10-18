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
