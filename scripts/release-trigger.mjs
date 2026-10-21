/** Carry the exact push range through CI before granting publication access. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

const repository = 'amazing-fish/dsh-piano-nav', ref = 'refs/heads/master'
const sha = value => {
  assert.match(value ?? '', /^[0-9a-f]{40}$/, 'exact commit SHA required')
  assert.notEqual(value, '0'.repeat(40), 'existing commit required')
  return value
}
const version = value => {
  assert.match(value ?? '', /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/, 'stable version required')
  return value.split('.').map(BigInt)
}
function plan(range, previous, manifest) {
  assert.equal(range.repository, repository); assert.equal(range.ref, ref)
  sha(range.before); sha(range.commit); assert.notEqual(range.before, range.commit)
  assert.equal(previous.name, 'dsh-piano-nav'); assert.equal(manifest.name, previous.name)
  const before = version(previous.version), after = version(manifest.version)
  const different = after.findIndex((part, i) => part !== before[i])
  if (different !== -1) assert.ok(after[different] > before[different], 'version must increase')
  return { schema: 1, ...range, version: manifest.version, publish: different !== -1 }
}

export function capturePushIntent(event, head, previous, manifest) {
  assert.equal(event.deleted, false); assert.equal(event.forced, false, 'force pushes do not authorize publication')
  assert.equal(event.after, head, 'checkout matches the push')
  return plan({ repository: event.repository?.full_name, ref: event.ref, before: event.before, commit: event.after }, previous, manifest)
}

export function resolveRelease({ event, env, intent, previous, manifest, head, master }) {
  assert.equal(env.GITHUB_REPOSITORY, repository); assert.equal(env.GITHUB_REF, ref)
  sha(head)
  let result
  if (env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    assert.equal(sha(event.inputs?.commit), head)
    version(event.inputs.version); assert.equal(event.inputs.version, manifest.version)
    result = { publish: true, version: manifest.version, commit: head }
  } else {
    assert.equal(env.GITHUB_EVENT_NAME, 'workflow_run')
    const run = event.workflow_run
    assert.equal(run?.event, 'push'); assert.equal(run.status, 'completed'); assert.equal(run.conclusion, 'success')
    assert.equal(run.name, 'Navigator compatibility'); assert.equal(run.path, '.github/workflows/verify.yml')
    assert.equal(run.head_repository?.full_name, repository); assert.equal(run.head_branch, 'master')
    assert.equal(run.head_sha, head, 'publish only the commit that passed CI')
    assert.equal(intent?.schema, 1)
    const expected = plan({ repository: intent.repository, ref: intent.ref, before: intent.before, commit: head }, previous, manifest)
    assert.deepEqual(intent, expected, 'CI intent matches the original push range and checked-out manifests')
    result = { publish: intent.publish, version: intent.version, commit: head }
  }
  if (result.publish) assert.equal(master, head, 'release commit is still master HEAD')
  return result
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const git = args => execFileSync('git', args, { encoding: 'utf8' }).trim()
  const readManifest = commit => JSON.parse(git(['show', `${sha(commit)}:package.json`]))
  const event = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'))
  const head = git(['rev-parse', 'HEAD']), manifest = readManifest(head)
  if (process.argv[2] === 'prepare') {
    assert.equal(process.env.GITHUB_EVENT_NAME, 'push')
    const intent = capturePushIntent(event, head, readManifest(event.before), manifest)
    git(['merge-base', '--is-ancestor', sha(event.before), head])
    await mkdir('artifacts', { recursive: true })
    await writeFile('artifacts/release-intent.json', JSON.stringify(intent, null, 2) + '\n')
    console.log(`CI release intent: ${intent.publish ? 'version increase' : 'unchanged version'} ${intent.version} at ${head}`)
  } else {
    assert.equal(process.argv[2], 'resolve')
    let intent, previous
    if (process.env.GITHUB_EVENT_NAME === 'workflow_run') {
      intent = JSON.parse(await readFile('artifacts/release-intent.json', 'utf8'))
      previous = readManifest(intent.before)
      git(['merge-base', '--is-ancestor', sha(intent.before), head])
    }
    const result = resolveRelease({ event, env: process.env, intent, previous, manifest, head,
      master: git(['ls-remote', 'origin', ref]).split(/\s/)[0] })
    await appendFile(process.env.GITHUB_OUTPUT, `publish=${result.publish}\nversion=${result.version}\ncommit=${result.commit}\n`)
    console.log(result.publish ? `Release selected: ${result.version} at ${head}` : `Release skipped: version ${result.version} unchanged`)
  }
}
