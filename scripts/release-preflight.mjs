/** Fail before upload on an unexpected ref, version, artifact, or registry state. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { runNpm } from './npm-cli.mjs'

export function validateRelease(manifest, env, head, master, registryStatus) {
  assert.equal(env.GITHUB_REPOSITORY, 'amazing-fish/dsh-piano-nav', 'expected repository')
  assert.equal(env.GITHUB_REF, 'refs/heads/master', 'dispatch from master')
  assert.match(env.RELEASE_COMMIT ?? '', /^[0-9a-f]{40}$/, 'full expected SHA required')
  assert.equal(head, env.RELEASE_COMMIT, 'checkout matches requested commit')
  assert.equal(master, head, 'requested commit is still master HEAD')
  assert.match(env.RELEASE_VERSION ?? '', /^\d+\.\d+\.\d+$/, 'stable version required')
  assert.equal(manifest.name, 'dsh-piano-nav')
  assert.equal(manifest.version, env.RELEASE_VERSION, 'manifest matches requested version')
  assert.equal(manifest.repository.url, 'git+https://github.com/amazing-fish/dsh-piano-nav.git')
  assert.equal(registryStatus, 404, 'only an unpublished version may be uploaded; network/server errors fail closed')
}

export function validateArtifact(packed, bytes, manifest, head) {
  assert.equal(packed.sourceCommit, head)
  assert.equal(packed.name, manifest.name)
  assert.equal(packed.version, manifest.version)
  assert.equal(packed.filename, `dsh-piano-nav-${manifest.version}.tgz`)
  assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, packed.integrity, 'tested artifact bytes unchanged')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [major, minor, patch] = runNpm(['--version']).trim().split('.').map(Number)
  assert.ok(major > 11 || major === 11 && (minor > 5 || minor === 5 && patch >= 1), 'OIDC requires npm >=11.5.1')
  const manifest = JSON.parse(await readFile('package.json', 'utf8'))
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  const master = execFileSync('git', ['ls-remote', 'origin', 'refs/heads/master'], { encoding: 'utf8' }).trim().split(/\s/)[0]
  const response = await fetch(`https://registry.npmjs.org/${manifest.name}/${manifest.version}`, { signal: AbortSignal.timeout(30000) })
  validateRelease(manifest, process.env, head, master, response.status)
  // The second invocation also verifies the archive that the following command uploads.
  try {
    const packed = JSON.parse(await readFile('artifacts/package-manifest.json', 'utf8'))
    const bytes = await readFile(`artifacts/dsh-piano-nav-${manifest.version}.tgz`)
    validateArtifact(packed, bytes, manifest, head)
  } catch (error) {
    if (error.code !== 'ENOENT') throw error
    // The first invocation precedes packing. The publishing invocation requires it.
    if (process.env.REQUIRE_RELEASE_ARTIFACT === 'true') throw error
  }
  console.log(`Release preflight passed: ${manifest.version} at ${head}`)
}
