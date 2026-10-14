/** Bounded display projection; full-history items and navigation stay intact. */
import type { PianoItem } from './navigation-model.ts'

export interface RailSlot {
  item: PianoItem
  /** Representative member in the original window, used only for identity. */
  sourceIndex: number
  /** Consecutive visible pitch; hidden members never occupy display space. */
  displayIndex: number
  start: number
  end: number
}

export function projectRailSlots(
  items: readonly PianoItem[],
  activeIndex: number,
  expanded: ReadonlySet<string>,
  protectedTurns: ReadonlySet<number>,
): RailSlot[] {
  const idleOutput = (index: number): boolean => {
    const item = items[index]
    return item.kind === 'output' && item.role === 'assistant'
      && (activeIndex < 0 || Math.abs(index - activeIndex) > 2)
      && !expanded.has(item.key) && !protectedTurns.has(item.turn)
  }
  const slots: RailSlot[] = []
  for (let start = 0; start < items.length;) {
    let end = start + 1
    if (idleOutput(start)) while (end < items.length && items[end].turn === items[start].turn && idleOutput(end)) end++
    const sourceIndex = start + Math.floor((end - start - 1) / 2)
    slots.push({ item: items[sourceIndex], sourceIndex, displayIndex: slots.length, start, end })
    start = end
  }
  return slots
}
