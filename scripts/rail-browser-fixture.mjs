/** Shared real-strip Chromium fixture; synthetic Session data, native DOM contract. */
import { createRequire } from 'node:module'
import path from 'node:path'
const tools = createRequire(path.resolve('.browser-tools/package.json'))
const { build } = tools('esbuild')
export async function buildRailFixture() {
  const { outputFiles } = await build({
  stdin: { resolveDir: path.resolve('scripts'), sourcefile: 'rail-fixture.ts', contents: `
    import { attachKeyStrip } from '../src/client/strip.ts'
    import { installStyles } from '../src/client/styles.ts'
    import { railFixtureData } from './rail-fixture-data.mjs'
    const observable = value => {
      const listeners = new Set()
      return { getSnapshot: () => value, subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn) }, set(next) { value = next; for (const fn of listeners) fn() } }
    }
    const selection = observable('s1')
    const sources = new Map()
    const data = railFixtureData(window.historyOnly === true, window.railOptions), nodeMap = new Map(data.nodes.map(node => [node.key, node]))
    const clicks = [], nav = document.querySelector('nav'), flow = document.querySelector('[data-chat-flow]')
    for (const { turn } of data.outline) {
      const button = document.createElement('button'); button.setAttribute('aria-label', (data.navigation.some(item => item.turn === turn) ? 'Jump ' : 'Load ') + turn)
      button.onclick = () => clicks.push(turn); nav.append(button)
    }
    for (const node of data.nodes) {
      const row = document.createElement('article'); row.dataset.chatAnchorKey = node.key
      row.textContent = node.kind === 'user' ? node.data.content[0].text : node.data.blocks?.[0]?.text ?? ''
      row.hidden = node.kind !== 'user' && node.kind !== 'assistant-step'; flow.append(row)
      if (node.visibility === 'hidden') {
        row.setAttribute('hidden', 'until-found'); row.dataset.turnProcessHidden = 'true'
        row.addEventListener('beforematch', () => row.removeAttribute('hidden'))
      }
    }
    const scroll = document.querySelector('[data-conversation-scroll]'), current = flow.querySelector('[data-chat-anchor-key="' + data.currentAnchor + '"]')
    scroll.scrollTop += current.getBoundingClientRect().top - scroll.getBoundingClientRect().top - 80
    const target = observable({ order: data.nodes.map(node => node.key), nodes: { get: key => nodeMap.get(key), source: key => { if (!sources.has(key)) sources.set(key, observable(nodeMap.get(key))); return sources.get(key) } }, navigation: { items: () => data.navigation } })
    const outline = observable(data.outline)
    const session = { ...observable({ loadingOlder: false }), sessionId: 's1', projections: { faceOf: () => outline } }
    const binding = { session }
    const ctx = {
      locale: { bind: () => (key, args) => key === 'chat.turnNavigation.label' ? 'Turns' : (key.endsWith('jumpLoad') ? 'Load ' : 'Jump ') + args.turn },
      sessions: { list: observable({}), binding: id => id === 's1' ? binding : undefined }, uiConversation: { binding: () => ({ target: () => target }) }
    }
    const settings = observable({ language: 'en', enabled: true, keyHeight: 2, keyGap: 12, maxVisible: 20 })
    const stylesStop = installStyles()
    const stop = attachKeyStrip(ctx, () => 'Piano', selection, settings)
    window.railFixture = { clicks, settings, selection, target, sources, nodeMap, flow, scroll, dispose: () => { stop(); stylesStop() } }
  `, loader: 'ts' }, bundle: true, write: false, format: 'iife', platform: 'browser',
})
  return outputFiles[0].text
}
export const railHtml = `<!doctype html><html><head><style>
      body{margin:0;font:14px Arial;background:#f4f5f7}main{position:relative;margin:24px;background:white;border:1px solid #ddd}
      [data-conversation-scroll]{height:800px;overflow:auto}[data-chat-flow]{margin-left:300px;width:760px;height:2200px}
      body[data-ds-dark-theme]{background:#15151b;color:#eee}body[data-ds-dark-theme] main{background:#24242b}
      article{box-sizing:border-box;height:100px;padding:24px;border:1px solid #ddd;border-radius:8px}nav{position:absolute;left:0}
    </style></head><body><main><div data-conversation-scroll><section><nav aria-label="Turns"></nav><div data-chat-flow></div></section></div></main></body></html>`
