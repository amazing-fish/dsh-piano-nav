/** Resume GitHub delivery from an original publishing run. Never uploads to npm. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { validateArtifact } from './release-preflight.mjs'
import { verifyPublished } from './verify-published.mjs'
import { githubReleaseNotes } from './github-release-notes.mjs'

const repository = 'amazing-fish/dsh-piano-nav'

export function validateRecovery(env, run, head, manifest) {
  assert.equal(env.GITHUB_REPOSITORY, repository)
  assert.equal(env.GITHUB_REF, 'refs/heads/master')
  assert.match(env.RELEASE_COMMIT ?? '', /^[0-9a-f]{40}$/)
  assert.match(env.RELEASE_VERSION ?? '', /^\d+\.\d+\.\d+$/)
  assert.match(env.RELEASE_RUN_ID ?? '', /^[1-9]\d*$/)
  assert.equal(String(run.id), env.RELEASE_RUN_ID)
  assert.equal(run.path, '.github/workflows/publish.yml')
  assert.equal(run.event, 'workflow_dispatch')
  assert.equal(run.status, 'completed', 'original publishing run must have stopped')
  assert.equal(run.repository.full_name, repository)
  assert.equal(run.head_repository.full_name, repository)
  assert.equal(run.head_branch, 'master')
  assert.equal(run.head_sha, env.RELEASE_COMMIT)
  assert.equal(head, env.RELEASE_COMMIT)
  assert.equal(manifest.name, 'dsh-piano-nav')
  assert.equal(manifest.version, env.RELEASE_VERSION)
  assert.equal(manifest.repository.url, `git+https://github.com/${repository}.git`)
}

/** api returns null only for a missing GET resource; all other errors fail. */
export async function completeRelease({ api, upload, readAsset, verified, notes, filename }) {
  const source = verified.sourceCommit, tag = `v${verified.version}`
  const endpoint = `repos/${repository}`
  assert.match(source, /^[0-9a-f]{40}$/)
  assert.equal(filename, `dsh-piano-nav-${verified.version}.tgz`)
  let tagRef = await api('GET', `${endpoint}/git/ref/tags/${tag}`)
  if (tagRef) {
    let object = tagRef.object
    // Accept existing annotated tags, but never move a tag to another source.
    for (let depth = 0; object.type === 'tag' && depth < 8; depth++) {
      object = (await api('GET', `${endpoint}/git/tags/${object.sha}`)).object
    }
    assert.equal(object.type, 'commit')
    assert.equal(object.sha, source, 'existing tag must point to original source')
  }
  // The tag endpoint only returns published releases. Authenticated listing is
  // required to find drafts, including a draft left by an interrupted upload.
  let release = null
  for (let page = 1; ; page++) {
    const releases = await api('GET', `${endpoint}/releases?per_page=100&page=${page}`)
    assert.ok(Array.isArray(releases), 'authenticated Release listing required')
    for (const candidate of releases) if (candidate.tag_name === tag) {
      assert.equal(release, null, 'multiple Releases for the same tag; inspect manually')
      release = candidate
    }
    if (releases.length < 100) break
  }
  if (release) {
    assert.equal(release.tag_name, tag)
    assert.equal(release.prerelease, false)
  }
  const expectedNames = [filename, 'registry-verification.json']
  const existing = new Map()
  for (const asset of release?.assets ?? []) {
    assert.ok(expectedNames.includes(asset.name), 'unexpected Release asset; inspect manually')
    assert.ok(!existing.has(asset.name), 'duplicate Release asset')
    assert.equal(asset.state, 'uploaded')
    if (asset.name === filename) assert.equal(asset.digest, `sha256:${verified.sha256}`, 'existing archive bytes must match')
    else {
      const receipt = JSON.parse(await readAsset(asset.id))
      for (const key of ['name', 'version', 'sourceCommit', 'sha256', 'shasum', 'integrity', 'size', 'byteIdentical']) {
        assert.equal(receipt[key], verified[key], `existing verification receipt: ${key}`)
      }
      assert.ok(Number.isFinite(Date.parse(receipt.verifiedAt)))
      assert.ok(receipt.checks.includes('package install/load contract'))
    }
    existing.set(asset.name, asset)
  }
  // Validate all existing state before the first write. Missing pieces can resume.
  if (!tagRef) await api('POST', `${endpoint}/git/refs`, { ref: `refs/tags/${tag}`, sha: source })
  if (!release) release = await api('POST', `${endpoint}/releases`, {
    tag_name: tag, target_commitish: source, name: tag, body: notes, draft: true, prerelease: false,
  })
  for (const name of expectedNames) if (!existing.has(name)) await upload(tag, name)
  release = await api('GET', `${endpoint}/releases/${release.id}`)
  assert.equal(release.assets.length, 2, 'both verified assets must be attached before publication')
  for (const name of expectedNames) {
    const asset = release.assets.find(item => item.name === name)
    assert.equal(asset?.state, 'uploaded')
    if (name === filename) assert.equal(asset.digest, `sha256:${verified.sha256}`)
    else if (!existing.has(name)) {
      const bytes = await readAsset(asset.id)
      assert.equal(createHash('sha256').update(bytes).digest('hex'), verified.receiptSha256)
    }
  }
  if (release.draft) {
    // Only the current npm latest may become GitHub Latest; old versions leave it alone.
    release = await api('PATCH', `${endpoint}/releases/${release.id}`, {
      draft: false, prerelease: false, target_commitish: source,
      make_latest: verified.latest === verified.version ? 'true' : 'false',
    })
  }
  assert.equal(release.draft, false)
  assert.equal(release.prerelease, false)
  console.log(`Release verified: ${release.html_url}`)
  return release
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = resolve('release-source'), env = process.env
  const gh = args => execFileSync('gh', args, { encoding: 'utf8', timeout: 120000 })
  const api = async (method, path, body) => {
    try {
      return JSON.parse(execFileSync('gh', ['api', '--method', method, path, ...(body ? ['--input', '-'] : [])], {
        input: body ? JSON.stringify(body) : undefined, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000,
      }))
    } catch (error) {
      if (method === 'GET' && /\(HTTP 404\)/.test(String(error.stderr))) return null
      throw error
    }
  }
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
  // Validate the identifier before using it in an API path.
  assert.match(env.RELEASE_RUN_ID ?? '', /^[1-9]\d*$/)
  const run = await api('GET', `repos/${repository}/actions/runs/${env.RELEASE_RUN_ID}`)
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
  validateRecovery(env, run, head, manifest)
  if (process.argv.includes('--prepare')) {
    gh(['run', 'download', env.RELEASE_RUN_ID, '--repo', repository, '--name', 'npm-release-evidence', '--dir', join(root, 'artifacts')])
  }
  const packed = JSON.parse(await readFile(join(root, 'artifacts/package-manifest.json'), 'utf8'))
  validateArtifact(packed, await readFile(join(root, 'artifacts', packed.filename)), manifest, env.RELEASE_COMMIT)
  if (!process.argv.includes('--prepare')) {
    const verified = await verifyPublished({ root, requireLatest: false })
    const receipt = await readFile(join(root, 'artifacts/registry-verification.json'))
    verified.receiptSha256 = createHash('sha256').update(receipt).digest('hex')
    const notes = githubReleaseNotes(manifest, verified, await readFile(join(root, 'CHANGELOG.md'), 'utf8'), env.RELEASE_COMMIT, { requireLatest: false })
    await writeFile(join(root, 'artifacts/github-release-notes.md'), notes)
    await completeRelease({ api, verified, notes, filename: packed.filename,
      readAsset: id => gh(['api', `repos/${repository}/releases/assets/${id}`, '-H', 'Accept: application/octet-stream']),
      upload: (tag, name) => gh(['release', 'upload', tag, join(root, 'artifacts', name), '--repo', repository]),
    })
  }
}
