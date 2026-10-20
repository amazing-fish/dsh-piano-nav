/** Original ChatView + ChatNodeSeat + disclosure/card, with synthetic Session transport. */
import React, { useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatView } from '../.semantic-fixture/vendor/ChatView.tsx'
import { DisclosureRow } from '../.semantic-fixture/vendor/DisclosureRow.tsx'
import { AskQuestionCard } from '../.semantic-fixture/vendor/AskQuestionCard.tsx'
import { toolDefinition } from '../.semantic-fixture/vendor/tool.ts'
import { attachKeyStrip } from '../src/client/strip.ts'
import { installStyles } from '../src/client/styles.ts'
const observable = (initial: any) => {
  let value = initial
  const listeners = new Set<() => void>()
  return { getSnapshot: () => value, subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } }, set(next: any) { value = next; for (const fn of [...listeners]) fn() } }
}
const identity = (x: any) => x
const selector = (store: any, select = identity) => select(useSyncExternalStore(store.subscribe, store.getSnapshot))
const view = observable({ turnProcesses: [] as any[] })
const state = observable({ openState: 'open', openError: null, hasMore: false, loadingOlder: false, running: false, queue: [], pendingSubmissions: [] })
const chat = observable(null)
const outline = observable([])
const selection = observable({ current: 's1', byId: { s1: { cwd: '/fixture' } } })
const activeSession = observable<string | undefined>('s1')
const settings = observable({ language: 'en', enabled: true, keyHeight: 3, keyGap: 16, maxVisible: 30 })
let compact = true
let pending = false
let submissionCalls = 0
let mounted = 0
const fixtureOptions = new URLSearchParams(window.location.search)
const processCount = Number(fixtureOptions.get('processCount') ?? 1)
const withQuestions = !fixtureOptions.has('processOnly')
const nodes = new Map<string, any>()
const sources = new Map<string, any>()
const specs = new Map<string, any>()
let loadedNavigation: any[] = []
const turn = (n: number) => ({ turn: n, data: new Map() })
const node = (key: string, kind: string, n: number, seq: number, data: any) => ({ key, kind, target: 'chat', visibility: 'visible', anchorSeq: seq, location: { kind: 'step', turn: turn(n), step: { step: data.step ?? 0 } }, data })
const assistant = (key: string, n: number, step: number, text: string) => {
  const blocks = [{ kind: 'text', text }]
  return node(key, 'assistant-step', n, n * 100 + step * 10, { status: 'settled', turn: n, step, blocks, finalNode: { kind: 'assistant', seq: n * 100 + step * 10 + 1, messageId: key, turn: n, step, blocks } })
}
const questions = [{ id: 'route', question: 'Which route should we take?', options: [{ label: 'A' }, { label: 'B' }], multi_select: false }, { id: 'checks', question: 'Which checks should run?', multi_select: true }]
const answers = [{ id: 'checks', selected: ['Unit', 'Browser'], custom: 'Windows' }, { id: 'route', selected: ['B'] }]
function projectedQuestion(seq: number) {
  // Run the pinned official call/result projection, rather than inventing a
  // settled root. In particular, an absent event isError becomes boolean false.
  const location = { kind: 'step', turn: turn(2), step: { step: 1 } }
  const start = { location, event: { type: 'tool/call', seq, time: 1,
    data: { callId: 'qa', name: 'ask_user_question', arguments: JSON.stringify({ questions }), turn: 2, step: 1 } } }
  let state = toolDefinition.start!(undefined as any, start as any)
  const matches: any[] = [start]
  if (!pending) {
    const result = { location, event: { type: 'tool/result', seq: seq + 1, time: 2,
      data: { message: { source: { callId: 'qa' }, content: [{ content: [{ type: 'text', text: JSON.stringify({ answers }) }] }] } } } }
    state = toolDefinition.update!({ state } as any, result as any)
    matches.push(result)
  }
  return toolDefinition.buildViewNode!({ key: 'tool2', id: 'qa', start, matches, state } as any) as any
}
function rebuild() {
  nodes.clear(); specs.clear()
  const order: string[] = []
  const navigation: any[] = []
  const add = (value: any) => { nodes.set(value.key, value); order.push(value.key) }
  for (let n = 1; n <= 2; n++) {
    const answerStep = processCount + 1
    const final = assistant(`f${n}`, n, answerStep, `FINAL_${n}: This is the completed result, not the process note.`)
    const closed = n === 1 || !pending
    add(node(`u${n}`, 'user', n, n * 100, { content: [{ type: 'text', text: `Input ${n}: solve this task` }] }))
    for (let step = 1; step <= processCount; step++) {
      add({ ...assistant(step === 1 ? `p${n}` : `p${n}-${step}`, n, step, `PROCESS_${n}_${step}: working through the task`), visibility: 'hidden' })
    }
    if (n === 2 && withQuestions) {
      add({ ...projectedQuestion(n * 100 + answerStep * 10 - 5), visibility: 'hidden' })
    }
    const spec = { turn: n, controlAnchorSeq: n * 100 + answerStep * 10 - 2, processStartSeq: n * 100 + 10, answerAnchorSeq: closed ? n * 100 + answerStep * 10 : null, answerStep: closed ? answerStep : null, inlineReasoning: false, messageCount: processCount, toolCallCount: n === 2 && withQuestions ? 1 : 0, subagentCount: 0 }
    add(node(`control${n}`, 'turn-process', n, spec.controlAnchorSeq, spec))
    if (closed) { add(final); add(node(`tail${n}`, 'turn-tail', n, n * 100 + (answerStep + 1) * 10, { turn: n, seq: n * 100 + (answerStep + 1) * 10, time: 0, closing: final.data })) }
    for (const [key, value] of nodes) if (value.location.turn.turn === n) specs.set(key, { turn: n, spec, turnClosed: closed, hasExternalProcess: true, compactAnswer: false })
    navigation.push({ turn: n, anchorKey: `u${n}`, prompt: `Input ${n}`, response: closed ? `FINAL_${n}` : '' })
  }
  const store = {
    get: (key: string) => nodes.get(key),
    values: () => [...nodes.values()],
    source: (key: string) => {
      if (!sources.has(key)) sources.set(key, observable(nodes.get(key)))
      return sources.get(key)
    },
  }
  loadedNavigation = navigation
  chat.set({ order, nodes: store, navigation: { items: () => loadedNavigation }, timeline: { turnOrder: [], turns: new Map() } })
  for (const [key, source] of sources) source.set(nodes.get(key))
  outline.set(navigation.map(item => ({ ...item, seq: item.turn * 100 })))
}
function Tool({ root }: any) {
  const [open, setOpen] = useState(false)
  const card = root.kind === 'tool-result' ? {
    kind: 'answered', skippedLabel: 'Skipped', questions: questions.map(q => {
      const answer = answers.find(a => a.id === q.id)
      const lines = !q.multi_select && answer?.custom ? [answer.custom]
        : [...(answer?.selected ?? []), ...(answer?.custom ? [answer.custom] : [])]
      return { id: q.id, question: q.question, answers: lines }
    }),
  } : { kind: 'unanswered', verdict: 'Awaiting your answer', questions }
  return <div data-chat-anchor-key="call:qa" data-chat-call-id="qa">
    <div data-tool="ask_user_question">
      <DisclosureRow title="Interactive question" icon={<span>?</span>} open={open} expandable expandOnRowClick onToggle={() => setOpen(!open)}>
        <AskQuestionCard card={card as any} />
        <button onClick={() => submissionCalls++}>Submission sentinel: never click</button>
      </DisclosureRow>
    </div>
  </div>
}
function Message({ node: value, turnProcess }: any) {
  if (value.kind === 'turn-tail') return null
  if (value.kind === 'turn-process') return <button onClick={() => turnProcess?.setOpen(!turnProcess.open)}>Show native process</button>
  if (value.kind === 'tool-call') return <Tool root={value.data.root} />
  const user = value.kind === 'user'
  return <article style={{ padding: 20, minHeight: user ? 75 : 155, border: '1px solid #ccc', borderRadius: 10 }}>
    <b>{user ? 'User' : 'AI'}</b><p>{user ? value.data.content[0].text : value.data.blocks.map((block: any) => block.kind === 'text' ? block.text : '').join('\n')}</p>
  </article>
}
const t = (key: string, args?: any) => key === 'chat.turnNavigation.label' ? 'Turn navigation' : key === 'chat.turnNavigation.jump' ? `Jump to turn ${args.turn}` : key === 'chat.turnNavigation.jumpLoad' ? `Load and jump to turn ${args.turn}` : key
rebuild()
const session = { ...state, sessionId: 's1', projections: { faceOf: () => outline } }
const binding = { session }
const app = createRoot(document.getElementById('chat')!)
const props: any = {
  sessionId: 's1', useChat: (s: any) => selector(chat, s), useSession: (s: any) => selector(state, s), useSessions: (s: any) => selector(selection, s),
  useProjection: () => selector(outline), useChatNode: (key: string, s = identity) => selector(chat.getSnapshot().nodes.source(key), s),
  useChatNodeProcess: (key: string) => { selector(chat); return specs.get(key) }, useStore: (s: any) => selector(view, s),
  actions: { setTurnProcessOpen(n: number, answerStep: number, open: boolean) { view.set({ turnProcesses: [...view.getSnapshot().turnProcesses.filter((entry: any) => entry.turn !== n), ...(open ? [{ turn: n, answerStep }] : [])] }) } },
  renderSlot: (_: string, owner: any) => <Message key={owner.node.key} {...owner} />,
  openFile: async () => {}, openSkill: () => {}, loadOlder: () => {}, loadThrough: () => { throw new Error('No history request expected') }, loadImage: () => '', openView: () => {},
  chatScroll: { read: () => null, save: () => {} }, forkAt: () => {}, fileMentions: () => undefined, useTranscriptView: (s: any) => s(compact ? 'compact' : 'normal'), t,
}
const render = () => app.render(<ChatView key={mounted} {...props} />)
render(); installStyles()
const ctx: any = { locale: { bind: () => t }, sessions: { list: selection, binding: () => binding }, uiConversation: { binding: () => ({ target: () => chat }) } }
const dispose = attachKeyStrip(ctx, (() => 'Piano navigation') as any, activeSession, settings)
;(window as any).semanticFixture = {
  summary: () => ({ submissionCalls, processOpen: view.getSnapshot().turnProcesses }),
  waiting() { pending = true; state.set({ ...state.getSnapshot(), running: true }); rebuild() },
  answer() { pending = false; state.set({ ...state.getSnapshot(), running: false }); rebuild() },
  navigationOnly(loaded: boolean) {
    loadedNavigation = outline.getSnapshot().filter((item: any) => loaded || item.turn !== 2)
    chat.set({ ...chat.getSnapshot() })
  },
  locateQuestion(located: boolean) {
    const value = nodes.get('tool2')
    const next = { ...value, location: located ? { kind: 'step', turn: turn(2), step: { step: 1 } } : { kind: 'unresolved' } }
    nodes.set('tool2', next); sources.get('tool2')?.set(next)
  },
  dropQuestionAnchor() { document.querySelector('[data-chat-anchor-key="tool2"]')?.remove() },
  normal() { compact = false; mounted++; render() },
  disable() { settings.set({ ...settings.getSnapshot(), enabled: false }) },
  disappear() { activeSession.set(undefined); selection.set({ current: undefined, byId: {} }); app.unmount() },
  stop: dispose,
}
