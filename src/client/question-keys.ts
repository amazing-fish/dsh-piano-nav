/** Read-only ask_user_question projection. Never invokes a responder or tool. */
import type { ChatConversationViewNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { KeyDescriptor } from './keys.ts'
const MAX_JSON_LENGTH = 262_144
const MAX_CALLS = 4096
/** Counts only: never retain call ids, prompts, arguments, or answer text. */
export function createQuestionDiagnostics() {
  return { toolNodes: 0, calls: 0, duplicateCallIds: 0, missingCallHead: 0, scanLimited: 0,
    askCalls: 0, missingTurn: 0, invalidQuestions: 0, invalidResults: 0,
    pending: 0, answered: 0, unanswered: 0, error: 0, questionKeys: 0, answerKeys: 0 }
}
type QuestionDiagnostics = ReturnType<typeof createQuestionDiagnostics>
const object = (value: unknown): Record<string, unknown> | null => typeof value === 'object' && value !== null && !Array.isArray(value)
  ? value as Record<string, unknown> : null
const text = (value: unknown): string => typeof value === 'string' ? value : ''
const bounded = (value: string, limit: number): string => value.length <= limit ? value : `${value.slice(0, limit).trimEnd()}…`
function parse(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || value.length > MAX_JSON_LENGTH) return null
  try { return object(JSON.parse(value)) } catch { return null }
}
function uniqueById(values: readonly unknown[]): Map<string, Record<string, unknown>> {
  const result = new Map<string, Record<string, unknown>>()
  const duplicates = new Set<string>()
  for (const value of values) {
    const entry = object(value), id = text(entry?.id)
    if (entry === null || id === '' || duplicates.has(id)) continue
    if (result.has(id)) { result.delete(id); duplicates.add(id) } else result.set(id, entry)
  }
  return result
}
function resultObject(call: Record<string, unknown>): Record<string, unknown> | null {
  if (call.kind !== 'tool-result' || call.isError !== false || !Array.isArray(call.content)) return null
  let raw = ''
  for (const value of call.content) {
    const block = object(value)
    if (block?.type !== 'text' || typeof block.text !== 'string') continue
    if (raw.length + block.text.length > MAX_JSON_LENGTH) return null
    raw += block.text
  }
  return parse(raw)
}
interface OwnedCall { node: ChatConversationViewNode; call: Record<string, unknown> }
interface NodeCallSummary {
  calls: readonly { id: string; call: Record<string, unknown> }[]
  hasAsk: boolean
  scanLimited: boolean
}
function extractNodeCalls(node: ChatConversationViewNode): NodeCallSummary {
  const root = object(object(node.data)?.root)
  if (root === null) return { calls: [], hasAsk: false, scanLimited: false }
  // Fast path for the common single-call leaf (no subCalls): avoids Set/array allocations.
  if (!Array.isArray(root.subCalls) || root.subCalls.length === 0) {
    const id = text(root.callId)
    if (id === '') return { calls: [], hasAsk: false, scanLimited: false }
    const head = root.kind === 'tool-result' ? object(root.call) : root
    return { calls: [{ id, call: root }], hasAsk: head?.name === 'ask_user_question', scanLimited: false }
  }
  const visited = new Set<object>()
  const stack = [root]
  const calls: { id: string; call: Record<string, unknown> }[] = []
  let hasAsk = false
  let scanLimited = false
  while (stack.length > 0) {
    if (visited.size >= MAX_CALLS) { scanLimited = true; break }
    const call = stack.pop()!
    if (visited.has(call)) continue
    visited.add(call)
    const id = text(call.callId)
    if (id !== '') {
      calls.push({ id, call })
      const head = call.kind === 'tool-result' ? object(call.call) : call
      if (head?.name === 'ask_user_question') hasAsk = true
    }
    if (Array.isArray(call.subCalls)) {
      if (call.subCalls.length > MAX_CALLS) { scanLimited = true; break }
      for (let i = call.subCalls.length - 1; i >= 0; i--) {
        const child = object(call.subCalls[i]); if (child !== null) stack.push(child)
      }
    }
  }
  return scanLimited ? { calls: [], hasAsk: false, scanLimited: true } : { calls, hasAsk, scanLimited: false }
}

/** Fast check for whether an updated tool-call node cannot affect question keys or duplicate-call census. */
export function canSkipToolCallUpdate(
  previous: ChatConversationViewNode | undefined,
  next: ChatConversationViewNode | undefined,
): boolean {
  if (previous === undefined || next === undefined || previous.kind !== 'tool-call' || next.kind !== 'tool-call') return false
  const prevSummary = extractNodeCalls(previous)
  if (prevSummary.hasAsk || prevSummary.scanLimited) return false
  const nextSummary = extractNodeCalls(next)
  if (nextSummary.hasAsk || nextSummary.scanLimited) return false
  if (prevSummary.calls.length !== nextSummary.calls.length) return false
  for (let i = 0; i < prevSummary.calls.length; i++) {
    if (prevSummary.calls[i].id !== nextSummary.calls[i].id) return false
  }
  return true
}

/** Census precedes emission: no first-wins answers from duplicate call identities. */
function uniqueCalls(nodes: readonly ChatConversationViewNode[], diagnostic?: QuestionDiagnostics): Map<string, OwnedCall> {
  if (diagnostic === undefined) {
    let anyAsk = false
    const summaries: { node: ChatConversationViewNode; calls: readonly { id: string; call: Record<string, unknown> }[] }[] = []
    for (const node of nodes) {
      if (node.kind !== 'tool-call') continue
      const summary = extractNodeCalls(node)
      if (summary.scanLimited) return new Map()
      if (summary.hasAsk) anyAsk = true
      if (summary.calls.length > 0) summaries.push({ node, calls: summary.calls })
    }
    if (!anyAsk) return new Map()
    const calls = new Map<string, OwnedCall>()
    const duplicates = new Set<string>()
    for (const { node, calls: nodeCalls } of summaries) {
      for (const { id, call } of nodeCalls) {
        if (duplicates.has(id)) continue
        if (calls.has(id)) { calls.delete(id); duplicates.add(id) }
        else calls.set(id, { node, call })
      }
    }
    return calls
  }
  const calls = new Map<string, OwnedCall>()
  const duplicates = new Set<string>()
  for (const node of nodes) {
    if (node.kind !== 'tool-call') continue
    diagnostic.toolNodes++
    const root = object(object(node.data)?.root)
    if (root === null) continue
    const visited = new Set<object>()
    const stack = [root]
    while (stack.length > 0) {
      if (visited.size >= MAX_CALLS) { diagnostic.scanLimited++; return new Map() }
      const call = stack.pop()!
      if (visited.has(call)) continue
      visited.add(call)
      diagnostic.calls++
      if (call.kind === 'tool-result' && object(call.call) === null) diagnostic.missingCallHead++
      const id = text(call.callId)
      if (id !== '' && !duplicates.has(id)) {
        if (calls.has(id)) { calls.delete(id); duplicates.add(id); diagnostic.duplicateCallIds++ }
        else calls.set(id, { node, call })
      }
      if (Array.isArray(call.subCalls)) {
        if (call.subCalls.length > MAX_CALLS) { diagnostic.scanLimited++; return new Map() }
        for (let i = call.subCalls.length - 1; i >= 0; i--) {
          const child = object(call.subCalls[i]); if (child !== null) stack.push(child)
        }
      }
    }
  }
  return calls
}

export function buildQuestionKeys(
  nodes: readonly ChatConversationViewNode[],
  locate: (node: ChatConversationViewNode) => number | null,
  diagnostic?: QuestionDiagnostics,
): ReadonlyMap<string, KeyDescriptor[]> {
  const byNode = new Map<string, KeyDescriptor[]>()
  for (const [callId, { node, call }] of uniqueCalls(nodes, diagnostic)) {
    const turn = locate(node)
    const head = call.kind === 'tool-result' ? object(call.call) : call
    if (head?.name !== 'ask_user_question') continue
    if (diagnostic) diagnostic.askCalls++
    if (turn === null) { if (diagnostic) diagnostic.missingTurn++; continue }
    const args = parse(head.argsRaw)
    if (!Array.isArray(args?.questions)) { if (diagnostic) diagnostic.invalidQuestions++; continue }
    const result = resultObject(call)
    const answers = uniqueById(Array.isArray(result?.answers) ? result.answers : [])
    const settled = call.kind === 'tool-result'
    if (diagnostic && settled && call.isError !== true && (call.isError !== false || !Array.isArray(result?.answers))) diagnostic.invalidResults++
    const output = byNode.get(node.key) ?? []
    const previousLength = output.length
    byNode.set(node.key, output)
    for (const [id, question] of uniqueById(args.questions)) {
      const prompt = text(question.question).trim()
      if (prompt === '') continue
      const candidate = answers.get(id), selected = candidate?.selected
      const valid = candidate !== undefined && Array.isArray(selected)
        && selected.every(value => typeof value === 'string')
        && (candidate.custom === undefined || typeof candidate.custom === 'string')
      const custom = valid ? text(candidate.custom).trim() : ''
      const selections = valid ? (selected as string[]).filter(value => value.trim() !== '') : []
      const answerText = valid ? (custom !== '' && question.multi_select !== true
        ? custom : [...selections, ...(custom !== '' ? [custom] : [])].join('\n')).trim() : ''
      const answered = valid && answerText !== '' && settled && call.isError === false
      const interactionState = !settled ? 'pending' : call.isError === true ? 'error'
        : answered ? 'answered' : 'unanswered'
      if (diagnostic) { diagnostic[interactionState]++; diagnostic.questionKeys++; if (answered) diagnostic.answerKeys++ }
      const base = `question:${encodeURIComponent(callId)}:${encodeURIComponent(id)}`
      const options = Array.isArray(question.options) ? question.options.flatMap(value => {
        const label = text(object(value)?.label); return label !== '' ? [label] : []
      }).join(' / ') : ''
      output.push({
        key: base, anchorKey: `call:${callId}`, turn, role: 'assistant', kind: 'question', interactionState,
        title: bounded(prompt, 140), preview: bounded(prompt + (options !== '' ? `\n${options}` : ''), 520),
      })
      if (answered) output.push({
        key: `${base}:answer`, anchorKey: `call:${callId}`, turn, role: 'user', kind: 'answer', interactionState: 'answered',
        title: bounded(answerText, 140), preview: bounded(`${prompt}\n${answerText}`, 520),
      })
    }
    if (diagnostic && output.length === previousLength) diagnostic.invalidQuestions++
  }
  return byNode
}
