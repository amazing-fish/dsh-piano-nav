/** Bounded display projection; full-history items and navigation stay intact. */
import type { PianoItem } from './navigation-model.ts'

export interface RailSlot {
  item: PianoItem
  /** Original pitch slot, including pitches hidden by a collapsed run. */
  index: number
  start: number
  end: number
}

export function projectRailSlots(
  items: readonly PianoItem[],
  activeIndex: number,
  expanded: ReadonlySet<string>,
  protectedTurns: ReadonlySet<number>,
): RailSlot[] {
  const idleGrey = (index: number): boolean => {
    const item = items[index]
    return (item.kind === 'output' || item.role === 'turn')
      && (activeIndex < 0 || Math.abs(index - activeIndex) > 2)
      && !expanded.has(item.key) && !protectedTurns.has(item.turn)
  }
  const slots: RailSlot[] = []
  for (let start = 0; start < items.length;) {
    let end = start + 1
    if (idleGrey(start)) while (end < items.length && idleGrey(end)) end++
    // Even runs use the lower middle pitch: always one existing pitch slot,
    // never an elongated bar or a re-spacing of the surrounding keys.
    const index = start + Math.floor((end - start - 1) / 2)
    slots.push({ item: items[index], index, start, end })
    start = end
  }
  return slots
}
