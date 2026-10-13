// #16 v2: vertical-merge layout contract. Pure function checks over
// computeRailSlots — the renderer and the pointer gate must see the same
// slots, so the layout invariants are asserted here, not in the DOM.
import { computeRailSlots, stackPositions } from '../src/client/strip.ts'

let failures = 0
const check = (name, ok) => {
  console.log(`${ok ? 'ok' : 'FAIL'} - ${name}`)
  if (!ok) failures++
}

// 20-key window, default pitch geometry (height 229, keyHeight 2).
const positions = stackPositions(20, 229, 12, 2)

// 1) focus on the last key (active=19): keys 0..15 collapse into one run,
//    16..19 stay per-key (focus±3 neighborhood + active).
{
  const slots = computeRailSlots(positions, 19, 19, 2, 229, 3)
  check('run 0..15 all collapsed', slots.slice(0, 16).every(slot => slot.groupCenter >= 0))
  check('run members share one bar (same top/height)', new Set(slots.slice(0, 16).map(slot => `${slot.top}/${slot.height}`)).size === 1)
  check('run height scales with length (16 keys -> 16*3=48px, under the 114px cap)', slots[0].height === 48)
  check('run center is the middle key (0 + 16>>1)', slots[3].groupCenter === 8)
  check('neighborhood 16..18 per-key pitch slots', [16, 17, 18].every(i => slots[i].groupCenter < 0 && slots[i].height === 2))
  check('focus+active key waves to full 48px width', slots[19].width === 48)
  check('wave falls off away from the focus (16 is 3 off, ~6.5px)', Math.abs(slots[16].width - (10 + 38 * Math.exp(-9 / (2 * 1.35 ** 2)))) < 1e-9)
  check('run bar width is the grey 10px', slots[0].width === 10)
  // hit-test anchor: the run's shared center equals the pitch center of the run.
  check('run center anchors at the run pitch middle', Math.abs(slots[0].center - (positions[0] + positions[15]) / 2) < 1e-9)
}

// 2) focus mid-history with active at the end: two runs split around the
//    neighborhood, active stays per-key at its 24px base (outside the wave).
{
  const slots = computeRailSlots(positions, 5, 19, 2, 229, 3)
  check('keys 2..8 around focus go per-key', [2, 3, 4, 5, 6, 7, 8].every(i => slots[i].groupCenter < 0))
  check('keys 0..1 and 9..12 stay collapsed', [0, 1, 9, 10, 11, 12].every(i => slots[i].groupCenter >= 0))
  check('collapsed bars keep the grey 10px width', slots[0].width === 10 && slots[9].width === 10)
  check('active key outside the neighborhood keeps its 24px base (no wave reach)', slots[19].width === 24)
  check('active key stays per-key', slots[19].groupCenter < 0 && slots[19].height === 2)
}

// 3) active wheel browsing keeps every slot per-key.
{
  const slots = computeRailSlots(positions, 0, 19, 2, 229, Number.MAX_SAFE_INTEGER)
  check('browsing renders all keys per-key', slots.every(slot => slot.groupCenter < 0))
}

// 4) focus mid-window: two runs of 7 and 6 keys around the neighborhood.
{
  const slots = computeRailSlots(positions, 10, 10, 2, 229, 3)
  check('lower run 0..6 centers on key 3 (0 + 7>>1)', slots.slice(0, 7).every(s => s.groupCenter === 3))
  check('upper run 14..19 centers on key 17 (14 + 6>>1)', slots.slice(14).every(s => s.groupCenter === 17))
  check('two runs have distinct bars', slots[0].center !== slots[19].center)
}

// 5) no focus/active at all collapses the whole window into one bar.
{
  const slots = computeRailSlots(positions, -1, -1, 2, 229, 3)
  check('unfocused window is a single merged bar centered on key 10 (0 + 20>>1)', slots.every(slot => slot.groupCenter === 10 && slot.top === slots[0].top))
}

// 6) small windows never produce runs shorter than 2 keys worth of bar.
{
  const small = stackPositions(5, 53, 12, 2)
  const slots = computeRailSlots(small, 2, 2, 2, 53, 3)
  check('all five keys inside the neighborhood stay per-key', slots.every(slot => slot.groupCenter < 0))
}

if (failures !== 0) {
  console.error(`${failures} rail layout contract checks failed`)
  process.exit(1)
}
console.log('rail layout contract checks passed')
