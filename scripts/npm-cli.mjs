/** Invoke npm with Node on Unix and Windows, without a shell or credential reads. */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'

let cli
for (const directory of (process.env.PATH ?? '').split(delimiter)) {
  try {
    const executable = realpathSync(join(directory, process.platform === 'win32' ? 'npm.cmd' : 'npm'))
    const candidate = process.platform === 'win32' ? join(dirname(executable), 'node_modules/npm/bin/npm-cli.js') : executable
    if (existsSync(candidate)) { cli = candidate; break }
  } catch {}
}
assert.ok(cli, 'npm CLI is required')
export const runNpm = (args, options = {}) => execFileSync(process.execPath, [cli, ...args], {
  encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options,
})
