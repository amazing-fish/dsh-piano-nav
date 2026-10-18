/** Registry visibility is separate from upload success. Never repeats an upload. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdtemp, mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { runNpm as npm } from './npm-cli.mjs'

const expected = JSON.parse(await readFile('artifacts/package-manifest.json', 'utf8'))
const spec = `${expected.name}@${expected.version}`, registry = 'https://registry.npmjs.org'
let metadata
for (let attempt = 0; attempt < 9; attempt++) {
  try { metadata = JSON.parse(npm(['view', spec, '--json', '--prefer-online', `--registry=${registry}`])); break }
  catch (error) {
    if (!String(error.stderr).includes('E404') || attempt === 8) throw error
    console.log('Upload accepted; registry still processing, checking again in 15s')
    await delay(15000)
  }
}
assert.equal(metadata.name, expected.name); assert.equal(metadata.version, expected.version)
assert.equal(metadata.repository.url, 'git+https://github.com/amazing-fish/dsh-piano-nav.git')
assert.equal(metadata['dist-tags'].latest, expected.version)
assert.equal(metadata.dist.integrity, expected.integrity)
const download = await mkdtemp(join(tmpdir(), 'piano-registry-'))
const cache = await mkdtemp(join(tmpdir(), 'piano-npm-cache-'))
const [packed] = JSON.parse(npm(['pack', spec, '--ignore-scripts', '--json', '--cache', cache, '--pack-destination', download, `--registry=${registry}`]))
assert.equal(packed.filename, expected.filename)
const tarball = resolve(download, packed.filename), bytes = await readFile(tarball)
assert.deepEqual(bytes, await readFile(resolve('artifacts', expected.filename)), 'download matches tested artifact byte for byte')
const sha256 = createHash('sha256').update(bytes).digest('hex'), shasum = createHash('sha1').update(bytes).digest('hex')
assert.equal(shasum, metadata.dist.shasum)
execFileSync(process.execPath, ['scripts/package-contract.mjs'], { stdio: 'inherit', env: { ...process.env, PIANO_PACKAGE_TARBALL: tarball } })
await mkdir('artifacts', { recursive: true })
await writeFile('artifacts/registry-verification.json', JSON.stringify({ name: expected.name, version: expected.version, latest: metadata['dist-tags'].latest,
  sourceCommit: expected.sourceCommit, publishedAt: metadata.time[expected.version], verifiedAt: new Date().toISOString(), sha256, shasum,
  integrity: expected.integrity, size: bytes.length, files: packed.files.length, byteIdentical: true,
  checks: ['registry identity/latest', 'integrity/shasum', 'fresh-cache byte-identical download', 'package install/load contract'] }, null, 2) + '\n')
console.log(`Published package verified: ${spec}, SHA256 ${sha256}`)
