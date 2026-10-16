/** Full display projection before windowing, so a run is never counted partially. */
import type { PianoItem } from './navigation-model.ts'

export interface RailSlot {
  item: PianoItem
  /** Representative member in the full item list, used only for identity. */
  sourceIndex: number
  /** Consecutive visible pitch; hidden members never occupy display space. */
  displayIndex: number
  start: number
  end: number
}

/** Locate the display slot containing an original item index. */
export function railSlotIndex(slots: readonly RailSlot[], itemIndex: number): number {
  let low = 0, high = slots.length - 1
  while (low <= high) {
    const middle = (low + high) >>> 1
    const slot = slots[middle]
    if (itemIndex < slot.start) high = middle - 1
    else if (itemIndex >= slot.end) low = middle + 1
    else return middle
  }
  return -1
}

export function projectRailSlots(
  items: readonly PianoItem[],
  activeIndex: number,
  expanded: ReadonlySet<string>,
  protectedTurns: ReadonlySet<number>,
  collapsed: ReadonlySet<string> = new Set(),
): RailSlot[] {
  const idleOutput = (index: number): boolean => {
    const item = items[index]
    return item.kind === 'output' && item.role === 'assistant'
      && (collapsed.has(item.key) || item.folded === true || activeIndex < 0 || Math.abs(index - activeIndex) > 2)
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
