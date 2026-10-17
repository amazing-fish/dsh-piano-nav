/** Seeded input, shared by the regression and the actual-component replay. */
export function xyTrajectory(seed, rows) {
  let state = seed >>> 0
  const random = () => {
    state += 0x6D2B79F5
    let t = state
    t = Math.imul(t ^ t >>> 15, t | 1)
    t ^= t + Math.imul(t ^ t >>> 7, t | 61)
    return ((t ^ t >>> 14) >>> 0) / 4294967296
  }
  const between = (a, b) => a + random() * (b - a)
  const clampY = y => Math.max(.1, Math.min(rows - 1.1, y))
  const point = (x, y) => ({ x: +x.toFixed(3), y: +clampY(y).toFixed(4) })
  const steps = []
  const add = (phase, points, dt = [16, 24, 32, 48][Math.floor(random() * 4)]) => steps.push({ phase, points, dt })
  for (let i = 0; i < 40; i++) {
    add('diagonal', [point(27 + 24 * Math.sin(i * .37) + between(-2, 2), .2 + (rows - 1.4) * i / 39 + between(-.18, .18))])
  }
  let y = (rows - 1) / 2
  for (let i = 0; i < 40; i++) {
    y = clampY(y + between(-.7, .7))
    add('edge-jitter', [point(between(10, 16), y)])
  }
  for (let i = 0; i < 32; i++) add('fast-reversal', [point(between(1, 55), between(.1, rows - 1.1))])
  for (let i = 0; i < 12; i++) {
    const points = Array.from({ length: 3 + Math.floor(random() * 18) }, () => point(between(1, 55), between(.1, rows - 1.1)))
    add('coalesced-burst', points, 16)
  }
  add('settle-inside', [point(4, 1.2)], 160)
  for (let i = 0; i < 24; i++) add('continuous-xy', [point(between(1, 9), between(.1, rows - 1.1))])
  add('settle-outside', [point(55, between(.1, rows - 1.1))], 160)
  return { seed: seed >>> 0, steps }
}
