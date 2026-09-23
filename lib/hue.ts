/**
 * A stable hue for a hull.
 *
 * The source spreadsheet gave each regular vessel its own fill colour, which
 * answered "where else is this boat this month" without reading a label. It
 * cannot scale to 462 hulls: at most eight or so hues stay tellable apart on
 * one grid, so two vessels will share one. That is a near miss, not a wrong
 * claim, as long as the hue is only ever a hint and the trace (hover or click
 * a bar) remains the exact answer.
 *
 * FNV-1a over the hull key, so the same hull gets the same hue on every
 * render, every month, every machine, with no table to keep.
 */
export const HUE_COUNT = 8

export function hueIndex(hullKey: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < hullKey.length; i++) {
    h ^= hullKey.charCodeAt(i)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h % HUE_COUNT
}
