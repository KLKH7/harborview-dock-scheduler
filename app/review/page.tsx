import { getFindings, getRecentChanges } from '@/lib/data'
import { buildFindingRows, rosterLever } from '@/lib/findings'
import { FindingList } from './FindingList'
import { FindingDetail } from './FindingDetail'

export const dynamic = 'force-dynamic'

/**
 * Review. One list of everything the checks found that nobody has decided
 * on yet, and one selected finding beside it.
 *
 * Soonest first. A finding whose stay is live or upcoming is red; one whose
 * stays all ended years ago is not, because a stay that ended in 2003 is a
 * record, not an alarm. Both sit in the same list until someone decides.
 */
export default async function ReviewPage(props: PageProps<'/review'>) {
  const params = await props.searchParams
  const selected = typeof params.f === 'string' ? params.f : null
  const showDismissed = params.dismissed === '1'

  const [findings, changes] = await Promise.all([getFindings(), getRecentChanges(20)])
  const all = buildFindingRows(findings)
  const dismissed = all.filter((r) => findings.dispositions.has(r.fingerprint))
  const todo = all.filter((r) => !findings.dispositions.has(r.fingerprint))
  const rows = showDismissed ? all : todo

  const lever = rosterLever(todo)
  const current = selected ? all.find((r) => r.fingerprint === selected) ?? null : null

  const counts = {
    overlap: todo.filter((r) => r.kind === 'overlap').length,
    cross: todo.filter((r) => r.kind === 'cross').length,
    oversize: todo.filter((r) => r.kind === 'oversize').length,
  }

  return (
    <div className="flex min-h-0 flex-1">
      <FindingList
        rows={rows}
        todoCount={todo.length}
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
        todoCount={todo.length}
        counts={counts}
        changes={changes}
      />
    </div>
  )
}
