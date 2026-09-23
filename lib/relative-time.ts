const DAY = 86_400_000

/**
 * "6d", "7w", "2y": distance between two ISO dates, the way a list row shows
 * it. Negative distances (the future) read "in 3d".
 */
export function relativeDays(fromIso: string, toIso: string): string {
  const days = Math.round((Date.parse(toIso) - Date.parse(fromIso)) / DAY)
  const abs = Math.abs(days)
  const unit = abs < 14 ? `${abs}d` : abs < 60 ? `${Math.round(abs / 7)}w` : abs < 730 ? `${Math.round(abs / 30)}mo` : `${Math.round(abs / 365)}y`
  return days < 0 ? `in ${unit}` : unit
}
