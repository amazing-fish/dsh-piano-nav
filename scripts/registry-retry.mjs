/** Retry only npm's two publication-propagation errors, with a fixed budget. */
import { setTimeout as delay } from 'node:timers/promises'

export function npmErrorCode(error) {
  let code
  try { code = JSON.parse(String(error.stdout)).error?.code } catch {}
  return code ?? String(error.stderr).match(/(?:^|\n)npm (?:error|ERR!) code (\w+)(?:\r?\n|$)/)?.[1]
}

export async function registryRetry(operation, { attempts = 9, wait = delay, log = console.log } = {}) {
  for (let attempt = 1; ; attempt++) {
    try { return await operation() }
    catch (error) {
      const code = npmErrorCode(error)
      if (!['E404', 'ETARGET'].includes(code) || attempt >= attempts) throw error
      log(`Registry propagation (${code}); retry ${attempt + 1}/${attempts} in 15s`)
      await wait(15000)
    }
  }
}
