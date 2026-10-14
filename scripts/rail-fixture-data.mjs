/** Real semantic node shapes shared by DOM and painted-geometry regressions. */
export function railFixtureData(historyOnly = false) {
  if (historyOnly) {
    const node = { key: 'u10', kind: 'user', target: 'chat', visibility: 'visible', location: { turn: { turn: 10 } }, data: { content: [{ type: 'text', text: 'Current input' }] } }
    return { nodes: [node], currentAnchor: 'u10',
      outline: Array.from({ length: 10 }, (_, i) => ({ turn: i + 1, seq: (i + 1) * 100, prompt: `History ${i + 1}`, response: '' })),
      navigation: [{ turn: 10, anchorKey: 'u10', prompt: 'Current input', response: '' }] }
  }
  const nodes = []
  const node = (key, kind, turn, data) => ({ key, kind, target: 'chat', visibility: 'visible', location: { turn: { turn } }, data })
  for (let i = 0; i < 7; i++) {
    nodes.push(node(`p${i}`, 'assistant-step', 1, { status: 'settled', turn: 1, step: i, blocks: [{ kind: 'text', text: `Process ${i + 1}: examining the task` }] }))
    if (i < 6) nodes.push(node(`tool${i}`, 'tool-call', 1, { root: { callId: `read${i}`, name: 'read', argsRaw: '{}', subCalls: [] } }))
  }
  nodes.push(node('u3', 'user', 3, { content: [{ type: 'text', text: 'Current input' }] }))
  const blocks = [{ kind: 'text', text: 'Final result' }]
  const final = node('f3', 'assistant-step', 3, { status: 'settled', turn: 3, step: 1, blocks,
    finalNode: { kind: 'assistant', seq: 330, messageId: 'f3', turn: 3, step: 1, blocks } })
  nodes.push(final, node('tail3', 'turn-tail', 3, { turn: 3, closing: final.data }))
  return { nodes, currentAnchor: 'f3',
    outline: [1, 2, 3].map(turn => ({ turn, seq: turn * 100, prompt: `History ${turn}`, response: '' })),
    navigation: [{ turn: 1, anchorKey: 'p0', prompt: 'Older work', response: '' }, { turn: 3, anchorKey: 'u3', prompt: 'Current input', response: 'Final result' }] }
}
