/** Registry visibility is separate from upload success. Never repeats an upload. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { runNpm } from './npm-cli.mjs'
import { registryRetry } from './registry-retry.mjs'

export async function verifyPublished({ root = process.cwd(), requireLatest = true,
  npm = args => runNpm(args, { cwd: root }), retry = registryRetry,
  contract = tarball => execFileSync(process.execPath, [join(root, 'scripts/package-contract.mjs')], {
    cwd: root, stdio: 'inherit', env: { ...process.env, PIANO_PACKAGE_TARBALL: tarball },
  }),
} = {}) {
  const expected = JSON.parse(await readFile(join(root, 'artifacts/package-manifest.json'), 'utf8'))
  const spec = `${expected.name}@${expected.version}`, registry = 'https://registry.npmjs.org'
  const online = ['--prefer-online', '--fetch-retries=0', '--fetch-timeout=30000', `--registry=${registry}`]
  const metadata = await retry(() => JSON.parse(npm(['view', spec, '--json', ...online])))
  assert.equal(metadata.name, expected.name); assert.equal(metadata.version, expected.version)
  assert.equal(metadata.repository.url, 'git+https://github.com/amazing-fish/dsh-piano-nav.git')
  if (requireLatest) assert.equal(metadata['dist-tags'].latest, expected.version)
  assert.equal(metadata.dist.integrity, expected.integrity)
  const download = await mkdtemp(join(tmpdir(), 'piano-registry-'))
  const [packed] = await retry(async () => {
    // A fresh cache on every attempt avoids retaining a stale packument miss.
    const cache = await mkdtemp(join(tmpdir(), 'piano-npm-cache-'))
    return JSON.parse(npm(['pack', spec, '--ignore-scripts', '--json', '--cache', cache, '--pack-destination', download, ...online]))
  })
  assert.equal(packed.filename, expected.filename)
  const tarball = resolve(download, packed.filename), bytes = await readFile(tarball)
  assert.deepEqual(bytes, await readFile(resolve(root, 'artifacts', expected.filename)), 'download matches tested artifact byte for byte')
  const sha256 = createHash('sha256').update(bytes).digest('hex'), shasum = createHash('sha1').update(bytes).digest('hex')
  assert.equal(shasum, metadata.dist.shasum)
  assert.equal(`sha512-${createHash('sha512').update(bytes).digest('base64')}`, expected.integrity)
  await contract(tarball)
  await mkdir(join(root, 'artifacts'), { recursive: true })
  const verified = { name: expected.name, version: expected.version, latest: metadata['dist-tags'].latest,
    sourceCommit: expected.sourceCommit, publishedAt: metadata.time[expected.version], verifiedAt: new Date().toISOString(), sha256, shasum,
    integrity: expected.integrity, size: bytes.length, files: packed.files.length, byteIdentical: true,
    checks: [requireLatest ? 'registry identity/latest' : 'registry identity (historical version; latest unchanged)', 'integrity/shasum', 'fresh-cache byte-identical download', 'package install/load contract'] }
  await writeFile(join(root, 'artifacts/registry-verification.json'), JSON.stringify(verified, null, 2) + '\n')
  console.log(`Published package verified: ${spec}, SHA256 ${sha256}`)
  return verified
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await verifyPublished()
