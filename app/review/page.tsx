import { getFindings, getRecentChanges } from '@/lib/data'
import { buildFindingRows, rosterLever } from '@/lib/findings'
import { FindingList } from './FindingList'
import { FindingDetail } from './FindingDetail'

export const dynamic = 'force-dynamic'

/**
 * Review. A list of what the checks found, and one selected finding beside it.
 *
 * Open findings (a stay ending on or after today) come first, soonest first.
 * Everything older is the archive: kept, listed, never red. A stay that ended
 * in 2003 is a record, not an alarm.
 */
export default async function ReviewPage(props: PageProps<'/review'>) {
  const params = await props.searchParams
  const selected = typeof params.f === 'string' ? params.f : null
  const showDismissed = params.dismissed === '1'

  const [findings, changes] = await Promise.all([getFindings(), getRecentChanges(20)])
  const all = buildFindingRows(findings)
  const dismissed = all.filter((r) => findings.dispositions.has(r.fingerprint))
  const live = all.filter((r) => !findings.dispositions.has(r.fingerprint))
  const rows = showDismissed ? all : live

  const open = live.filter((r) => r.open)
  const archive = live.filter((r) => !r.open)
  const lever = rosterLever(live)
  const current = selected ? all.find((r) => r.fingerprint === selected) ?? null : null

  const counts = {
    overlap: archive.filter((r) => r.kind === 'overlap').length,
    cross: archive.filter((r) => r.kind === 'cross').length,
    oversize: archive.filter((r) => r.kind === 'oversize').length,
    oversizeStays: archive.filter((r) => r.kind === 'oversize').reduce((s, r) => s + (r.count ?? 1), 0),
  }
  const range = findings.stats.firstDate && findings.stats.lastDate
    ? `${findings.stats.firstDate.slice(0, 4)} to ${findings.stats.lastDate.slice(0, 4)}`
    : ''

  return (
    <div className="flex min-h-0 flex-1">
      <FindingList
        rows={rows}
        openCount={open.length}
        archiveCounts={counts}
        archiveRange={range}
        dismissedCount={dismissed.length}
        showDismissed={showDismissed}
        dispositions={Object.fromEntries(findings.dispositions)}
        selected={selected}
        today={findings.today}
        lever={lever}
      />
      <FindingDetail
        row={current}
        disposition={current ? findings.dispositions.get(current.fingerprint) ?? null : null}
        openCount={open.length}
        archiveCounts={counts}
        changes={changes}
      />
    </div>
  )
}
