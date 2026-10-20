/** Publish-facing notes only after registry and downloaded-artifact verification. */
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

export function githubReleaseNotes(manifest, verified, changelog, commit, { requireLatest = true } = {}) {
  assert.match(commit ?? '', /^[0-9a-f]{40}$/, 'exact release commit required')
  assert.match(manifest.version, /^\d+\.\d+\.\d+$/, 'stable version required')
  assert.equal(verified.name, manifest.name)
  assert.equal(verified.version, manifest.version)
  if (requireLatest) assert.equal(verified.latest, manifest.version)
  assert.equal(verified.sourceCommit, commit)
  assert.equal(verified.byteIdentical, true, 'downloaded artifact must match')
  assert.match(verified.sha256 ?? '', /^[0-9a-f]{64}$/)
  assert.ok(Number.isFinite(Date.parse(verified.publishedAt)), 'actual publication time required')
  const sections = changelog.split(/^## /m).slice(1)
  const section = sections.find(text => text.startsWith(`${manifest.version} `) || text.startsWith(`${manifest.version}\n`))
  assert.ok(section, 'version-specific changelog required')
  const body = section.slice(section.indexOf('\n') + 1).trim()
  assert.ok(body, 'release notes must not be empty')
  return `${body}\n\n## Verified npm package\n\n- Package: [${manifest.name}@${manifest.version}](https://www.npmjs.com/package/${manifest.name}/v/${manifest.version})\n- Published: ${verified.publishedAt}\n- Source: ${commit}\n- SHA256: ${verified.sha256}\n- Registry download matched the tested archive; host/client install-load checks passed with development host peers.\n\nInstall: \`dsh plugin --profile web add ${manifest.name}@${manifest.version}\`\n`
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'))
  const verified = JSON.parse(await readFile('artifacts/registry-verification.json', 'utf8'))
  assert.equal(manifest.version, process.env.RELEASE_VERSION)
  const notes = githubReleaseNotes(manifest, verified, await readFile('CHANGELOG.md', 'utf8'), process.env.RELEASE_COMMIT)
  await writeFile('artifacts/github-release-notes.md', notes)
}
