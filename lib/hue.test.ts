import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { HUE_COUNT, hueIndex } from './hue'

describe('hueIndex', () => {
  it('is stable for the same hull', () => {
    expect(hueIndex('GOLDEN COMPASS')).toBe(hueIndex('GOLDEN COMPASS'))
  })
  it('stays within the palette', () => {
    for (const k of ['A', 'LONG KETCH', 'AMBER REEF', 'CLEAR SEXTANT', '']) {
      const i = hueIndex(k)
      expect(i).toBeGreaterThanOrEqual(0)
      expect(i).toBeLessThan(HUE_COUNT)
    }
  })
  it('spreads the real roster across every hue, and the regulars apart', () => {
    const { vessels } = JSON.parse(readFileSync('data/vessels.json', 'utf8')) as {
      vessels: { hullKey: string; bookedDays: number }[]
    }
    const counts = new Array(HUE_COUNT).fill(0)
    for (const v of vessels) counts[hueIndex(v.hullKey)]++
    expect(counts.every((c) => c > 0)).toBe(true)
    expect(Math.max(...counts)).toBeLessThan(vessels.length / 4)
    // The ten busiest hulls are the ones a coordinator recognises by colour.
    const top = [...vessels].sort((a, b) => b.bookedDays - a.bookedDays).slice(0, 10)
    expect(new Set(top.map((v) => hueIndex(v.hullKey))).size).toBeGreaterThanOrEqual(6)
  })
})
