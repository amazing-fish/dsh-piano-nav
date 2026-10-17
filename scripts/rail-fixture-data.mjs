/** Real semantic node shapes shared by DOM and painted-geometry regressions. */
export function railFixtureData(historyOnly = false, { processCount = 7, hidden = false, leadingHistory = 0, processGroups = 1, withQuestions = false, emptyHistoryPrompt = false } = {}) {
  if (historyOnly) {
    const node = { key: 'u10', kind: 'user', target: 'chat', visibility: 'visible', location: { turn: { turn: 10 } }, data: { content: [{ type: 'text', text: 'Current input' }] } }
    return { nodes: [node], currentAnchor: 'u10',
      outline: Array.from({ length: 10 }, (_, i) => ({ turn: i + 1, seq: (i + 1) * 100, prompt: `History ${i + 1}`, response: '' })),
      navigation: [{ turn: 10, anchorKey: 'u10', prompt: 'Current input', response: '' }] }
  }
  const nodes = []
  const node = (key, kind, turn, data) => ({ key, kind, target: 'chat', visibility: 'visible', location: { turn: { turn } }, data })
  const processTurn = leadingHistory + 1, currentTurn = leadingHistory + processGroups + 2
  const processNavigation = []
  for (let group = 0; group < processGroups; group++) {
    const turn = processTurn + group, prefix = group === 0 ? '' : `${group}-`
    processNavigation.push({ turn, anchorKey: `p${prefix}0`, prompt: 'Older work', response: '' })
    for (let i = 0; i < processCount; i++) {
      nodes.push({ ...node(`p${prefix}${i}`, 'assistant-step', turn, { status: 'settled', turn, step: i, blocks: [{ kind: 'text', text: `Process ${i + 1}: examining the task` }] }), visibility: hidden ? 'hidden' : 'visible' })
      if (i < processCount - 1) nodes.push(node(`tool${prefix}${i}`, 'tool-call', turn, { root: { callId: `read${prefix}${i}`, name: 'read', argsRaw: '{}', subCalls: [] } }))
    }
  }
  nodes.push(node('u3', 'user', currentTurn, { content: [{ type: 'text', text: 'Current input' }] }))
  if (withQuestions) nodes.push(node('color-tool', 'tool-call', currentTurn, { root: {
    kind: 'tool-result', callId: 'color-qa', call: { name: 'ask_user_question', argsRaw: JSON.stringify({ questions: [{ id: 'palette', question: 'Which palette?', options: [{ label: 'Custom' }] }] }) },
    isError: false, content: [{ type: 'text', text: JSON.stringify({ answers: [{ id: 'palette', selected: ['Custom'] }] }) }], subCalls: [],
  } }))
  const blocks = [{ kind: 'text', text: 'Final result' }]
  const final = node('f3', 'assistant-step', currentTurn, { status: 'settled', turn: currentTurn, step: 1, blocks,
    finalNode: { kind: 'assistant', seq: currentTurn * 100 + 30, messageId: 'f3', turn: currentTurn, step: 1, blocks } })
  nodes.push(final, node('tail3', 'turn-tail', currentTurn, { turn: currentTurn, closing: final.data }))
  return { nodes, currentAnchor: 'f3',
    outline: Array.from({ length: currentTurn }, (_, i) => ({ turn: i + 1, seq: (i + 1) * 100, prompt: emptyHistoryPrompt && i + 1 === currentTurn - 1 ? '' : `History ${i + 1}`, response: '' })),
    navigation: [...processNavigation, { turn: currentTurn, anchorKey: 'u3', prompt: 'Current input', response: 'Final result' }] }
}
