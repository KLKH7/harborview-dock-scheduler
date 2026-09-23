import Link from 'next/link'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  getFindings,
  getBerths,
  getFuzzyMatches,
  getUnknownLengthVessels,
} from '@/lib/data'
import type { Conflict } from '@/lib/validation/engine'
import { PairLengthFix } from './PairLengthFix'

export const dynamic = 'force-dynamic'

function monthLink(iso: string) {
  const [y, m] = iso.split('-')
  return `/?year=${Number(y)}&month=${Number(m)}`
}

function readSnapshotMeta() {
  try {
    const s = JSON.parse(readFileSync(path.join(process.cwd(), 'data', 'snapshot.json'), 'utf8'))
    return {
      monthBlocks: Number(s.stats?.monthBlocks ?? 0),
      verified: Number(s.stats?.monthBlocksWeekdayVerified ?? 0),
      rejoined: Number(s.stats?.monthEdgeSplitsRejoined ?? 0),
      deduped: Number(s.stats?.exactDuplicatesDropped ?? 0),
      stale: (s.staleWeekdayBlocks ?? []) as string[],
    }
  } catch {
    return { monthBlocks: 0, verified: 0, rejoined: 0, deduped: 0, stale: [] as string[] }
  }
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

export default async function ProblemsPage() {
  const [{ conflicts, crossBerth, fits, stats }, berths, fuzzy, unknown] = await Promise.all([
    getFindings(),
    getBerths(),
    getFuzzyMatches(),
    getUnknownLengthVessels(12),
  ])
  const meta = readSnapshotMeta()

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
  const unmeasured = berths.filter((b) => b.lengthFt === null)

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[1100px] space-y-10 px-5 py-6">
        <div>
          <h1 className="text-[17px] font-medium tracking-tight">Problems</h1>
          <p className="mt-1 text-sm text-mute">
            Every stay in {stats.yearsCovered} years, checked by the same rules that refuse a new
            one. Fix the stay, or fix the data that produced it.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-5">
          <Stat label="Stays" value={stats.reservations} />
          <Stat label="Two in one berth" value={stats.conflicts} alarm />
          <Stat label="One in two berths" value={stats.crossBerthViolations} alarm />
          <Stat label="Too long for berth" value={stats.oversizedCount} alarm />
          <Stat label="Not checkable" value={stats.unverifiableCount} />
        </div>

        <section className="space-y-3">
          <h2 className="text-[15px] font-medium">
            Two stays in one berth{' '}
            <span className="tnum text-sm font-normal text-mute">{conflicts.length}</span>
          </h2>
          {conflicts.length === 0 ? (
            <Empty>No two stays share a berth on the same day.</Empty>
          ) : (
            <ConflictTable rows={conflicts} colA="Stay A" colB="Stay B" />
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-[15px] font-medium">
            One vessel in two berths at once{' '}
            <span className="tnum text-sm font-normal text-mute">
              {crossViolations.length}
              {crossShifts.length > 0 && `, plus ${crossShifts.length} same-day shifts`}
            </span>
          </h2>
          <p className="text-sm text-mute">
            Each berth looks fine on its own, which is why a grid cannot show this. A same-day
            shift from one berth to the next is normal and is not listed.
          </p>
          {crossViolations.length === 0 ? (
            <Empty>No vessel is recorded in two berths for more than a day.</Empty>
          ) : (
            <ConflictTable rows={crossViolations} colA="In" colB="And in" />
          )}
        </section>

        <section className="space-y-3">
          <h2 className="text-[15px] font-medium">
            Too long for the berth{' '}
            <span className="tnum text-sm font-normal text-mute">
              {stats.oversizedCount} stays, {pairs.length} vessel and berth pairings
            </span>
          </h2>
          <p className="text-sm text-mute">
            The same vessel in the same berth, over and over, is one question, not many: is the
            roster length wrong, or does the berth tolerate the overhang? Correct the length here
            and every stay in the group clears at once.
          </p>
          {pairs.length === 0 ? (
            <Empty>Every vessel with a known length fits the berth it was given.</Empty>
          ) : (
            <div className="overflow-hidden rounded-[8px] border border-line bg-panel">
              <table className="w-full text-sm">
                <thead className="bg-paper text-left text-xs uppercase tracking-wide text-mute">
                  <tr>
                    <th className="px-4 py-2 font-medium">Vessel</th>
                    <th className="px-4 py-2 font-medium">Berth</th>
                    <th className="px-4 py-2 text-right font-medium">Over by</th>
                    <th className="px-4 py-2 text-right font-medium">Stays</th>
                    <th className="px-4 py-2 font-medium">Years</th>
                    <th className="px-4 py-2 font-medium">Length on roster</th>
                    <th className="px-4 py-2 font-medium" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {pairs.map((g) => (
                    <tr key={g.key} className="align-top hover:bg-paper">
                      <td className="px-4 py-2 font-medium">{g.label}</td>
                      <td className="tnum px-4 py-2 whitespace-nowrap">
                        {g.berth}
                        <span className="text-mute">
                          {g.berthFt != null ? `, ${g.berthFt} ft` : ''}
                        </span>
                      </td>
                      <td className="tnum px-4 py-2 text-right text-conflict">+{g.overFt} ft</td>
                      <td className="tnum px-4 py-2 text-right">{g.count}</td>
                      <td className="tnum px-4 py-2 whitespace-nowrap text-mute">
                        {g.first.slice(0, 4)}
                        {g.last.slice(0, 4) !== g.first.slice(0, 4) && ` to ${g.last.slice(0, 4)}`}
                      </td>
                      <td className="px-4 py-1.5">
                        <PairLengthFix vesselId={g.vesselId} currentFt={g.vesselFt} berthFt={g.berthFt} />
                      </td>
                      <td className="px-4 py-2 text-right">
                        <Link href={monthLink(g.first)} className="text-sm text-ink hover:underline">
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

        <section className="space-y-3 border-t border-line pt-8">
          <h2 className="text-[15px] font-medium">What the data cannot tell us</h2>
          <p className="text-sm text-mute">
            The limits on what can be checked, stated rather than hidden, and what would close
            each gap.
          </p>

          <div className="space-y-2">
            <Note title={`${stats.unverifiableCount.toLocaleString()} stays have no vessel length`}>
              {stats.unverifiableBookedDays.toLocaleString()} booked days whose vessel is on no
              roster tab. They are reported as not checkable, never as fitting. Recording a
              length for the busiest few unlocks the most:{' '}
              {unknown
                .slice(0, 5)
                .map((v) => `${v.displayName} (${v.bookedDays} days)`)
                .join(', ')}
              . Add lengths on the{' '}
              <Link href="/vessels" className="text-ink underline">
                vessels
              </Link>{' '}
              list.
            </Note>

            {fuzzy.length > 0 && (
              <Note title={`${fuzzy.length} lengths were inferred and should be confirmed`}>
                The schedule and the roster disagree about prefixes (the schedule says R/V Clear
                Sextant, the roster says S/Y Clear Sextant). These were matched on the hull name
                alone. Each is a guess until someone confirms it on the vessels list.
              </Note>
            )}

            <Note title={`${meta.verified} of ${meta.monthBlocks} month grids independently verified`}>
              Stays are rebuilt from cell colour bands, and in the early sheets the day numbers
              are uncached formulas. Each rebuilt grid was checked against its own weekday row.
              {meta.stale.length > 0 && (
                <>
                  {' '}
                  {meta.stale.length} grids carry weekday letters pasted from another year and
                  off by a fixed amount; the day numbers were trusted over the letters.
                </>
              )}
            </Note>

            <Note title="December 2001 to 2003 were recorded twice">
              Each of those years appears at the foot of its own sheet and again at the head of
              the next. The two copies mostly differ, so only {meta.deduped} exact duplicates were
              dropped and the rest were kept. Where they disagree, the sheet is the only witness.
            </Note>

            <Note title={`${meta.rejoined} stays crossed a month edge`}>
              The workbook draws each month as its own block, so a stay from the 28th to the 3rd
              was two bands. They were rejoined; night counts on those stays were wrong before.
            </Note>

            {unmeasured.length > 0 && (
              <Note title={`${unmeasured.length} berthing areas have no recorded length`}>
                {unmeasured.map((b) => b.name).join(' and ')} carry no length in their row label.
                Any vessel placed there is reported as not checkable, never as fitting.
              </Note>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function ConflictTable({ rows, colA, colB }: { rows: Conflict[]; colA: string; colB: string }) {
  return (
    <div className="overflow-hidden rounded-[8px] border border-line bg-panel">
      <table className="w-full text-sm">
        <thead className="bg-paper text-left text-xs uppercase tracking-wide text-mute">
          <tr>
            <th className="px-4 py-2 font-medium">{colA}</th>
            <th className="px-4 py-2 font-medium">{colB}</th>
            <th className="px-4 py-2 text-right font-medium">Shared</th>
            <th className="px-4 py-2 font-medium" />
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((c, i) => (
            <tr key={i} className="hover:bg-paper">
              <td className="px-4 py-2">
                <div className="font-medium">{c.a.label}</div>
                <div className="tnum text-xs text-mute">
                  {c.a.berthId}, {c.a.start} to {c.a.end}
                </div>
              </td>
              <td className="px-4 py-2">
                <div className="font-medium">{c.b.label}</div>
                <div className="tnum text-xs text-mute">
                  {c.b.berthId}, {c.b.start} to {c.b.end}
                </div>
              </td>
              <td className="tnum px-4 py-2 text-right">
                {c.sharedDays} day{c.sharedDays === 1 ? '' : 's'}
              </td>
              <td className="px-4 py-2 text-right">
                <Link href={monthLink(c.a.start)} className="text-sm text-ink hover:underline">
                  View
                </Link>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Stat({ label, value, alarm }: { label: string; value: number; alarm?: boolean }) {
  return (
    <div className="border-l border-line pl-3">
      <div className={`tnum text-[22px] ${alarm && value > 0 ? 'text-conflict' : 'text-ink'}`}>
        {value.toLocaleString()}
      </div>
      <div className="text-[12px] text-mute">{label}</div>
    </div>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[8px] border border-line bg-panel px-4 py-5 text-sm text-mute">
      {children}
    </div>
  )
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[8px] border border-line bg-panel px-4 py-3 text-sm text-ink">
      <div className="font-medium">{title}</div>
      <div className="mt-0.5 text-mute">{children}</div>
    </div>
  )
}
