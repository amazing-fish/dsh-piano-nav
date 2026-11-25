/** Verify the distributable, not just the source checkout. Run after build. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'
import vm from 'node:vm'
import { runNpm } from './npm-cli.mjs'

const root = fileURLToPath(new URL('../', import.meta.url))
const requireHere = createRequire(import.meta.url)
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
const artifacts = join(root, 'artifacts')
await mkdir(artifacts, { recursive: true })

const npm = args => runNpm(args, { cwd: root })
const parsePackOutput = raw => {
  const parsed = JSON.parse(raw)
  return Array.isArray(parsed) ? parsed[0] : (parsed[manifest.name] ?? Object.values(parsed)[0])
}
// A registry download can exercise exactly the same install/load contract.
const suppliedTarball = process.env.PIANO_PACKAGE_TARBALL
const packed = parsePackOutput(npm(['pack', ...(suppliedTarball ? [resolve(suppliedTarball), '--dry-run'] : []), '--ignore-scripts', '--json', '--pack-destination', artifacts]))
const expected = [...manifest.files, 'package.json'].sort()
assert.deepEqual(packed.files.map(file => file.path).sort(), expected, 'package file allowlist')
assert.equal(packed.name, manifest.name)
assert.equal(packed.version, manifest.version)
const tarball = suppliedTarball ? resolve(suppliedTarball) : resolve(artifacts, packed.filename)
const integrity = `sha512-${createHash('sha512').update(await readFile(tarball)).digest('base64')}`
assert.equal(integrity, packed.integrity)

const install = await mkdtemp(join(artifacts, 'install-'))
try {
  // The DSH host supplies peers. Install only our actual tarball, offline,
  // then resolve host peers from the checkout's validated node_modules.
  npm(['install', '--prefix', install, '--ignore-scripts', '--legacy-peer-deps',
    '--offline', '--no-audit', '--no-fund', '--package-lock=false', tarball])
  const installedRoot = join(install, 'node_modules', manifest.name)
  const installedRealRoot = await realpath(installedRoot)
  const installed = JSON.parse(await readFile(join(installedRoot, 'package.json'), 'utf8'))
  assert.equal(installed.name, manifest.name)
  assert.equal(installed.version, manifest.version)
  assert.equal(installed.dsh?.manifestVersion, 1, 'DSH manifest version is declared')
  assert.equal(installed.dsh?.bundle?.patch, './cordis.patch.yml', 'DSH bundle patch path is declared')
  assert.equal(installed.dsh?.client?.platform, 'web', 'DSH client platform is web')

  // Verify DSH plugin display metadata: icon, exported locale/*.json, and subdirectory meta.detail.
  const installedRequire = createRequire(join(install, 'package.json'))
  assert.equal(installedRequire.resolve(`${installed.name}/package.json`), join(installedRealRoot, 'package.json'))
  assert.equal(installedRequire.resolve(`${installed.name}/cordis.patch.yml`), join(installedRealRoot, 'cordis.patch.yml'))
  assert.equal(typeof installed.icon, 'string', 'manifest icon path is declared')
  assert.ok(!isAbsolute(installed.icon) && !/^[A-Za-z][A-Za-z\d+.-]*:/u.test(installed.icon), 'manifest icon must be relative')
  const iconFile = await realpath(resolve(installedRealRoot, installed.icon))
  const iconRel = relative(installedRealRoot, iconFile)
  assert.ok(iconRel !== '..' && !iconRel.startsWith(`..${sep}`) && !isAbsolute(iconRel), 'icon stays inside package')
  const iconStat = await stat(iconFile)
  assert.ok(iconStat.isFile() && iconStat.size > 0 && iconStat.size <= 256 * 1024, 'icon is a regular file <= 256 KiB')
  const iconSvg = await readFile(iconFile, 'utf8')
  assert.match(iconSvg, /^<svg\b[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/, 'icon is a valid SVG')
  assert.doesNotMatch(iconSvg, /<(?:script|style|image|foreignObject|text|animate|animateTransform|animateMotion|set)\b|\bon[a-z]+\s*=|\b(?:xlink:)?href\s*=\s*["'](?!#)|\burl\s*\(\s*["']?(?!#)/i, 'icon SVG is self-contained geometry')

  const englishLocale = installedRequire.resolve(`${installed.name}/locale/en.json`)
  for (const lang of ['en', 'zh', 'zh-tw']) {
    const localePath = installedRequire.resolve(`${installed.name}/locale/${lang}.json`)
    assert.equal(dirname(localePath), dirname(englishLocale), `locale/${lang}.json shares the English locale directory`)
    const { meta } = JSON.parse(await readFile(localePath, 'utf8'))
    assert.equal(typeof meta?.title, 'string', `locale/${lang}.json meta.title`)
    assert.ok(meta.title.trim().length > 0, `locale/${lang}.json meta.title non-empty`)
    assert.equal(typeof meta?.description, 'string', `locale/${lang}.json meta.description`)
    assert.ok(meta.description.trim().length > 0, `locale/${lang}.json meta.description non-empty`)
    assert.equal(typeof meta?.detail, 'string', `locale/${lang}.json meta.detail`)
    assert.ok(meta.detail.includes('/') && !meta.detail.startsWith('/') && !meta.detail.includes('..') && /\.(?:md|markdown)$/i.test(meta.detail),
      `locale/${lang}.json meta.detail must be a subdirectory Markdown path`)
    const detailFile = await realpath(resolve(installedRealRoot, meta.detail))
    const detailRel = relative(installedRealRoot, detailFile)
    assert.ok(detailRel !== '..' && !detailRel.startsWith(`..${sep}`) && !isAbsolute(detailRel), 'detail doc stays inside package')
    const detailContent = await readFile(detailFile, 'utf8')
    assert.ok(detailContent.trim().length > 0 && !detailContent.startsWith('---'), `detail doc ${meta.detail} is non-empty Markdown without front matter`)
  }

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
  checks: ['file allowlist', 'offline tarball install', 'DSH plugin metadata/icon/locale/detail', 'host import', 'client loader', 'settings compatibility', 'rendered public identity'],
}, null, 2)}\n`)
console.log(`Package contract passed: ${packed.filename} (${packed.size} bytes, ${packed.files.length} files)`)
