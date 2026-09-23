import Link from 'next/link'
import { getFindings, getLatestImport } from '@/lib/data'
import type { Conflict } from '@/lib/validation/engine'
import { PairLengthFix } from './PairLengthFix'

export const dynamic = 'force-dynamic'

function monthLink(iso: string) {
  const [y, m] = iso.split('-')
  return `/?year=${Number(y)}&month=${Number(m)}`
}

type PairGroup = {
  key: string
  vesselId: string
  label: string
  berth: string
  vesselFt: number
  berthFt: number | null
  overFt: number
  count: number
  first: string
  last: string
}

/**
 * Review. Every stay on the schedule, checked by the same rules that refuse a
 * new one, in one column.
 *
 * Red marks a finding whose stay is live or upcoming. A stay that ended in
 * 2003 is a record, not an alarm, so the archive is listed in ink.
 */
export default async function ReviewPage() {
  const [{ conflicts, crossBerth, fits, stats, today }, run] = await Promise.all([
    getFindings(),
    getLatestImport(),
  ])
  const isLive = (c: Conflict) => c.a.end >= today || c.b.end >= today

  const crossViolations = crossBerth
    .filter((c) => c.severity === 'violation')
    .sort((a, b) => b.sharedDays - a.sharedDays)
  const crossShifts = crossBerth.filter((c) => c.severity === 'warning')

  // 113 oversize stays are 25 decisions. Group by vessel and berth.
  const groups = new Map<string, PairGroup>()
  for (const f of fits) {
    if (f.fit.status !== 'violation' || !f.reservation.vesselId) continue
    const key = `${f.reservation.vesselId}|${f.reservation.berthId}`
    const g = groups.get(key)
    if (g) {
      g.count++
      if (f.reservation.start < g.first) g.first = f.reservation.start
      if (f.reservation.end > g.last) g.last = f.reservation.end
    } else {
      groups.set(key, {
        key,
        vesselId: f.reservation.vesselId,
        label: f.reservation.label,
        berth: f.reservation.berthId,
        vesselFt: f.fit.vesselLengthFt ?? 0,
        berthFt: f.fit.berthLengthFt,
        overFt: f.fit.overhangFt ?? 0,
        count: 1,
        first: f.reservation.start,
        last: f.reservation.end,
      })
    }
  }
  const pairs = [...groups.values()].sort((a, b) => b.count - a.count || b.overFt - a.overFt)
  const liveOversize = pairs.some((g) => g.last >= today)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1100px] space-y-10 px-5 py-8 sm:px-8">
        <div>
          <h1 className="text-[20px] font-medium tracking-tight">Review</h1>
          <p className="mt-1 text-mute">
            Every stay in {stats.yearsCovered} years, checked by the same rules that refuse a new
            one. Red marks a stay that is live or upcoming; everything older is a record.
            {run && (
              <>
                {' '}
                <Link href="/import" className="text-ink underline underline-offset-2">
                  Import notes
                </Link>{' '}
                explain what the archive cannot tell us.
              </>
            )}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5">
          <Stat label="Stays" value={stats.reservations} />
          <Stat label="Two in one berth" value={stats.conflicts} alarm={conflicts.some(isLive)} />
          <Stat
            label="One in two berths"
            value={stats.crossBerthViolations}
            alarm={crossViolations.some(isLive)}
          />
          <Stat label="Too long for berth" value={stats.oversizedCount} alarm={liveOversize} />
          <Stat label="Not checkable" value={stats.unverifiableCount} />
        </div>

        <section className="space-y-3">
          <h2 className="text-[16px] font-medium">
            Two stays in one berth{' '}
            <span className="tnum font-normal text-mute">{conflicts.length}</span>
          </h2>
          {conflicts.length === 0 ? (
            <Empty>No two stays share a berth on the same day.</Empty>
          ) : (
            <ConflictTable rows={conflicts} colA="Stay A" colB="Stay B" today={today} />
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-[16px] font-medium">
            One vessel in two berths at once{' '}
            <span className="tnum font-normal text-mute">
              {crossViolations.length}
              {crossShifts.length > 0 && `, plus ${crossShifts.length} same-day shifts`}
            </span>
          </h2>
          <p className="text-mute">
            Each berth looks fine on its own, which is why a grid cannot show this. A same-day
            shift from one berth to the next is normal and is not listed.
          </p>
          {crossViolations.length === 0 ? (
            <Empty>No vessel is recorded in two berths for more than a day.</Empty>
          ) : (
            <ConflictTable rows={crossViolations} colA="In" colB="And in" today={today} />
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-[16px] font-medium">
            Too long for the berth{' '}
            <span className="tnum font-normal text-mute">
              {stats.oversizedCount} stays, {pairs.length} vessel and berth pairings
            </span>
          </h2>
          <p className="text-mute">
            The same vessel in the same berth, over and over, is one question, not many: is the
            roster length wrong, or does the berth tolerate the overhang? Correct the length here
            and every stay in the group clears at once.
          </p>
          {pairs.length === 0 ? (
            <Empty>Every vessel with a known length fits the berth it was given.</Empty>
          ) : (
            <div className="overflow-x-auto rounded-[8px] border border-line bg-panel">
              <table className="w-full">
                <thead className="bg-paper text-left text-[11px] uppercase tracking-[0.06em] text-mute">
                  <tr>
                    <th className="px-4 py-2.5 font-medium">Vessel</th>
                    <th className="px-4 py-2.5 font-medium">Berth</th>
                    <th className="px-4 py-2.5 text-right font-medium">Over by</th>
                    <th className="px-4 py-2.5 text-right font-medium">Stays</th>
                    <th className="px-4 py-2.5 font-medium">Years</th>
                    <th className="px-4 py-2.5 font-medium">Length on roster</th>
                    <th className="px-4 py-2.5 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pairs.map((g) => (
                    <tr key={g.key} className="align-top hover:bg-paper">
                      <td className="px-4 py-2.5 font-medium">{g.label}</td>
                      <td className="tnum whitespace-nowrap px-4 py-2.5">
                        {g.berth}
                        <span className="text-mute">
                          {g.berthFt != null ? `, ${g.berthFt} ft` : ''}
                        </span>
                      </td>
                      <td
                        className={`tnum px-4 py-2.5 text-right ${
                          g.last >= today ? 'text-conflict' : 'text-ink'
                        }`}
                      >
                        +{g.overFt} ft
                      </td>
                      <td className="tnum px-4 py-2.5 text-right">{g.count}</td>
                      <td className="tnum whitespace-nowrap px-4 py-2.5 text-mute">
                        {g.first.slice(0, 4)}
                        {g.last.slice(0, 4) !== g.first.slice(0, 4) && ` to ${g.last.slice(0, 4)}`}
                      </td>
                      <td className="px-4 py-2">
                        <PairLengthFix vesselId={g.vesselId} currentFt={g.vesselFt} berthFt={g.berthFt} />
                      </td>
                      <td className="px-4 py-2.5 text-right">
                        <Link href={monthLink(g.first)} className="text-ink hover:underline">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}

function ConflictTable({
  rows,
  colA,
  colB,
  today,
}: {
  rows: Conflict[]
  colA: string
  colB: string
  today: string
}) {
  return (
    <div className="overflow-x-auto rounded-[8px] border border-line bg-panel">
      <table className="w-full">
        <thead className="bg-paper text-left text-[11px] uppercase tracking-[0.06em] text-mute">
          <tr>
            <th className="px-4 py-2.5 font-medium">{colA}</th>
            <th className="px-4 py-2.5 font-medium">{colB}</th>
            <th className="px-4 py-2.5 text-right font-medium">Shared</th>
            <th className="px-4 py-2.5 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((c, i) => {
            const live = c.a.end >= today || c.b.end >= today
            return (
              <tr key={i} className="hover:bg-paper">
                <td className="px-4 py-2.5">
                  <div className="font-medium">{c.a.label}</div>
                  <div className="tnum text-[13px] text-mute">
                    {c.a.berthId}, {c.a.start} to {c.a.end}
                  </div>
                </td>
                <td className="px-4 py-2.5">
                  <div className="font-medium">{c.b.label}</div>
                  <div className="tnum text-[13px] text-mute">
                    {c.b.berthId}, {c.b.start} to {c.b.end}
                  </div>
                </td>
                <td className={`tnum px-4 py-2.5 text-right ${live ? 'text-conflict' : 'text-ink'}`}>
                  {c.sharedDays} day{c.sharedDays === 1 ? '' : 's'}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <Link href={monthLink(c.a.start)} className="text-ink hover:underline">
                    View
                  </Link>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function Stat({ label, value, alarm }: { label: string; value: number; alarm?: boolean }) {
  return (
    <div className="border-l border-line pl-3">
      <div className={`tnum text-[24px] ${alarm && value > 0 ? 'text-conflict' : 'text-ink'}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-[13px] text-mute">{label}</div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[8px] border border-line bg-panel px-4 py-5 text-mute">{children}</div>
  )
}
