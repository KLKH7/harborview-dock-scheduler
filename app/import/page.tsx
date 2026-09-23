import Link from 'next/link'
import { getFindings, getBerths, getFuzzyMatches, getUnknownLengthVessels, getLatestImport } from '@/lib/data'

export const dynamic = 'force-dynamic'

/**
 * Import notes. What the source workbook could and could not tell us, dated.
 *
 * This is the importer's account of the archive, written for whoever inherits
 * this desk or audits it. It used to sit on the review page, where it read
 * as an apology in a daily tool. It is a good document in its own place.
 */
export default async function ImportPage() {
  const [findings, berths, fuzzy, unknown, run] = await Promise.all([
    getFindings(),
    getBerths(),
    getFuzzyMatches(),
    getUnknownLengthVessels(5),
    getLatestImport(),
  ])
  const st = run?.stats ?? {}
  const num = (k: string) => Number(st[k] ?? 0)
  const stale = (st.staleWeekdayBlocks as string[] | undefined) ?? []
  const unmeasured = berths.filter((b) => b.lengthFt === null)
  const { stats } = findings

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[800px] px-5 py-10 sm:px-8">
        <h1 className="text-[20px] font-medium tracking-tight text-ink">Import notes</h1>
        <p className="tnum mt-1 text-[13px] text-mute">
          {run ? `Imported ${run.importedAt.slice(0, 10)}. ` : ''}
          Archive covers {stats.firstDate} to {stats.lastDate}, {stats.reservations.toLocaleString()} stays.
          These are the limits on what can be checked, stated rather than hidden, and what would close each gap.
        </p>

        <div className="mt-6 space-y-2">
          <Note title={`${stats.unverifiableCount.toLocaleString()} stays have no vessel length`}>
            {stats.unverifiableBookedDays.toLocaleString()} booked days whose vessel is on no roster tab.
            They are reported as not checkable, never as fitting. Recording a length for the busiest
            few unlocks the most: {unknown.map((v) => `${v.displayName} (${v.bookedDays} days)`).join(', ')}.
            Add lengths on the{' '}
            <Link href="/vessels" className="text-ink underline underline-offset-2">vessels</Link> list.
          </Note>

          {fuzzy.length > 0 && (
            <Note title={`${fuzzy.length} lengths were inferred and should be confirmed`}>
              The schedule and the roster disagree about prefixes (the schedule says R/V Clear Sextant,
              the roster says S/Y Clear Sextant). These were matched on the hull name alone. Each is a
              guess until someone confirms it on the vessels list.
            </Note>
          )}

          <Note title={`${num('monthBlocksWeekdayVerified')} of ${num('monthBlocks')} month grids independently verified`}>
            Stays are rebuilt from cell colour bands, and in the early sheets the day numbers are
            uncached formulas. Each rebuilt grid was checked against its own weekday row.
            {stale.length > 0 && (
              <> {stale.length} grids carry weekday letters pasted from another year and off by a
              fixed amount; the day numbers were trusted over the letters.</>
            )}
          </Note>

          <Note title="December 2001 to 2003 were recorded twice">
            Each of those years appears at the foot of its own sheet and again at the head of the
            next. The two copies mostly differ, so only {num('exactDuplicatesDropped')} exact
            duplicates were dropped and the rest were kept. Where they disagree, the sheet is the only witness.
          </Note>

          <Note title={`${num('monthEdgeSplitsRejoined')} stays crossed a month edge`}>
            The workbook draws each month as its own block, so a stay from the 28th to the 3rd was
            two bands. They were rejoined; night counts on those stays were wrong before.
          </Note>

          <Note title={`${num('legacyOverlapRows')} archive stays overlap another in the same berth`}>
            They are history and were kept. They are flagged so the database rule that refuses a
            double booking applies to every other stay, and to every stay made from now on.
          </Note>

          {unmeasured.length > 0 && (
            <Note title={`${unmeasured.length} berthing areas have no recorded length`}>
              {unmeasured.map((b) => b.name).join(' and ')} carry no length in their row label. Any
              vessel placed there is reported as not checkable, never as fitting.
            </Note>
          )}
        </div>
      </div>
    </div>
  )
}

function Note({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[8px] border border-line bg-panel px-4 py-3 text-[13px]">
      <div className="font-medium text-ink">{title}</div>
      <div className="mt-0.5 text-mute">{children}</div>
    </div>
  )
}
