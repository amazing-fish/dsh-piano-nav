/** Verify the distributable, not just the source checkout. Run after build. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { delimiter, dirname, join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'

const root = fileURLToPath(new URL('../', import.meta.url))
const requireHere = createRequire(import.meta.url)
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const artifacts = join(root, 'artifacts')
await mkdir(artifacts, { recursive: true })

// Run npm's JS entry with Node on both Windows and Unix; no shell quoting.
let npmCli
for (const directory of (process.env.PATH ?? '').split(delimiter)) {
  try {
    const executable = await realpath(join(directory, process.platform === 'win32' ? 'npm.cmd' : 'npm'))
    const candidate = process.platform === 'win32'
      ? join(dirname(executable), 'node_modules/npm/bin/npm-cli.js') : executable
    await access(candidate)
    npmCli = candidate
    break
  } catch {}
}
assert.ok(npmCli, 'npm CLI is required to verify the published tarball')
const npm = args => execFileSync(process.execPath, [npmCli, ...args], {
  cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
})
const [packed] = JSON.parse(npm(['pack', '--ignore-scripts', '--json', '--pack-destination', artifacts]))
const expected = [...manifest.files, 'package.json'].sort()
assert.deepEqual(packed.files.map(file => file.path).sort(), expected, 'package file allowlist')
assert.equal(packed.name, manifest.name)
assert.equal(packed.version, manifest.version)
const tarball = resolve(artifacts, packed.filename)
const integrity = `sha512-${createHash('sha512').update(await readFile(tarball)).digest('base64')}`
assert.equal(integrity, packed.integrity)

const install = await mkdtemp(join(artifacts, 'install-'))
try {
  // The DSH host supplies peers. Install only our actual tarball, offline,
  // then resolve host peers from the checkout's validated node_modules.
  npm(['install', '--prefix', install, '--ignore-scripts', '--legacy-peer-deps',
    '--offline', '--no-audit', '--no-fund', '--package-lock=false', tarball])
  const installedRoot = join(install, 'node_modules', manifest.name)
  const installed = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'))
  assert.equal(installed.name, manifest.name)
  assert.equal(installed.version, manifest.version)
  const patch = await readFile(join(installedRoot, 'cordis.patch.yml'), 'utf8')
  assert.match(patch, /id: sm-context-piano\b/, 'preserve persisted settings entry')
  assert.ok(patch.includes(`name: ${installed.name}`), 'DSH resolves the installed package')
  const host = await import(pathToFileURL(join(installedRoot, installed.main)).href)
  assert.equal(typeof host.Config, 'function')
  assert.equal(typeof host.apply, 'function')

  let handoff
  vm.runInNewContext(await readFile(join(installedRoot, 'lib/client.js'), 'utf8'), {
    window: { __ModuleLoader__: { load: value => { handoff = value } } },
  }, { filename: 'installed-client.js' })
  assert.equal(handoff.id, installed.name, 'client loader identity matches npm package')
  const client = handoff.factory(requireHere)
  assert.equal(typeof client.apply, 'function')
  let settings
  client.apply({
    effect: () => () => {},
    locale: { register: () => () => {}, bind: () => () => key => key },
    remote: { settings: {}, $on: () => () => {} },
    slots: {
      inject: (name, callback) => { if (name === 'settings.section') callback() },
      register: (options, component) => { if (options.name === 'settings.section') settings = [options, component] },
    },
  })
  assert.equal(settings[0].id, 'sm-context-piano', 'settings section remains compatible')
  const snapshot = { value: { language: 'en', enabled: true }, writable: true, status: 'ready' }
  const React = requireHere('react')
  const html = requireHere('react-dom/server').renderToStaticMarkup(React.createElement(settings[1], {
    scope: { subscribe: () => () => {}, getSnapshot: () => snapshot },
  }))
  for (const text of [installed.piano.displayName, `v${installed.version}`, installed.author.name,
    installed.homepage, installed.bugs.url, `dsh plugin --profile web add ${installed.name}`]) {
    assert.ok(html.includes(text), `installed settings page includes ${text}`)
  }
  assert.ok(!html.includes('@hjj345345/'), 'old installation command is absent')
} finally {
  await rm(install, { recursive: true, force: true })
}

const sourceCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
await writeFile(join(artifacts, 'package-manifest.json'), `${JSON.stringify({
  sourceCommit, name: packed.name, version: packed.version, filename: packed.filename,
  size: packed.size, unpackedSize: packed.unpackedSize, integrity, files: packed.files,
  checks: ['file allowlist', 'offline tarball install', 'host import', 'client loader', 'settings compatibility', 'rendered public identity'],
}, null, 2)}\n`)
console.log(`Package contract passed: ${packed.filename} (${packed.size} bytes, ${packed.files.length} files)`)
