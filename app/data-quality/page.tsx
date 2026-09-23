import { readFileSync } from 'node:fs'
import path from 'node:path'
import { getUnknownLengthVessels, getFuzzyMatches, getFindings, getBerths } from '@/lib/data'

export const dynamic = 'force-dynamic'

function readSnapshotMeta() {
  try {
    const p = path.join(process.cwd(), 'data', 'snapshot.json')
    const s = JSON.parse(readFileSync(p, 'utf8'))
    return {
      monthBlocks: s.stats?.monthBlocks ?? 0,
      verified: s.stats?.monthBlocksWeekdayVerified ?? 0,
      stale: (s.staleWeekdayBlocks ?? []) as string[],
    }
  } catch {
    return { monthBlocks: 0, verified: 0, stale: [] as string[] }
  }
}

export default async function DataQualityPage() {
  const [unknown, fuzzy, findings, berths] = await Promise.all([
    getUnknownLengthVessels(30),
    getFuzzyMatches(),
    getFindings(),
    getBerths(),
  ])
  const meta = readSnapshotMeta()

  const top10 = unknown.slice(0, 10).reduce((s, v) => s + v.bookedDays, 0)
  const unmeasuredBerths = berths.filter((b) => b.lengthFt === null)

  return (
    <div className="mx-auto max-w-[1100px] space-y-8 px-5 py-6">
      <div>
        <h1 className="text-[17px] font-medium tracking-tight">Data quality</h1>
        <p className="mt-1 text-sm text-mute">
          What the source workbook does not tell us, and what it would take to close each gap. These
          are the limits on what the system can verify, stated rather than hidden.
        </p>
      </div>

      <section className="rounded-[8px] border border-line bg-wash p-5">
        <h2 className="font-medium text-ink">
          Missing vessel lengths: {findings.stats.unverifiableCount.toLocaleString()} bookings
          cannot be fit-checked
        </h2>
        <p className="mt-1 text-sm text-mute">
          Vessel lengths live only in the <code>Science</code> and <code>Yachts</code> roster tabs,
          embedded in the name (e.g. <code>R/V High Drift 120&prime;</code>). The busiest vessels in
          the schedule appear in neither tab, so their length is unknowable from this workbook.
          Recording a length for just the top ten below would make{' '}
          <strong>{top10.toLocaleString()} booked days</strong> verifiable.
        </p>

        <div className="mt-4 overflow-hidden rounded-[8px] border border-line bg-panel">
          <table className="w-full text-sm">
            <thead className="bg-wash text-left text-xs uppercase tracking-wide text-ink">
              <tr>
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Vessel</th>
                <th className="px-4 py-2 text-right font-medium">Booked days</th>
                <th className="px-4 py-2 text-right font-medium">Bookings</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {unknown.map((v, i) => (
                <tr key={v.id} className={i < 10 ? 'bg-wash/40' : ''}>
                  <td className="px-4 py-1.5 tnum tabular-nums text-mute">{i + 1}</td>
                  <td className="px-4 py-1.5 font-medium">{v.displayName}</td>
                  <td className="px-4 py-1.5 text-right tnum tabular-nums">{v.bookedDays}</td>
                  <td className="px-4 py-1.5 text-right tnum tabular-nums text-mute">
                    {v.bookings}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-medium">
          Inferred lengths needing confirmation{' '}
          <span className="text-sm font-normal text-mute">({fuzzy.length} vessels)</span>
        </h2>
        <p className="text-sm text-mute">
          The schedule and the roster disagree about vessel prefixes: the schedule says{' '}
          <code>R/V Clear Sextant</code>, the roster says <code>S/Y Clear Sextant 145&prime;</code>.
          These lengths were matched on the hull name with the prefix ignored. That is an inference,
          so each one is listed for a human to confirm or reject.
        </p>
        <div className="overflow-hidden rounded-[8px] border border-line bg-panel">
          <table className="w-full text-sm">
            <thead className="bg-paper text-left text-xs uppercase tracking-wide text-mute">
              <tr>
                <th className="px-4 py-2 font-medium">Vessel (as scheduled)</th>
                <th className="px-4 py-2 text-right font-medium">Length taken from roster</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {fuzzy.map((v) => (
                <tr key={v.id}>
                  <td className="px-4 py-1.5">{v.displayName}</td>
                  <td className="px-4 py-1.5 text-right tnum tabular-nums">{v.lengthFt}′</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="text-[15px] font-medium">Structural notes on the source workbook</h2>
        <div className="space-y-2">
          <Note title={`${meta.verified} of ${meta.monthBlocks} month grids independently verified`}>
            Bookings are reconstructed from cell fill colours, and in the 1997 to 2001 sheets the day
            numbers are uncached formulas that must be rebuilt arithmetically. Each rebuilt grid is
            checked against that grid&apos;s own weekday-letter row, so the dates are proven rather
            than assumed.
          </Note>

          {meta.stale.length > 0 && (
            <Note title={`${meta.stale.length} month grids carry stale weekday letters`} tone="warn">
              These blocks were pasted from a previous year and the day-of-week letters were never
              corrected, so they disagree with their own day numbers by a fixed offset. The day
              numbers are treated as authoritative.
              <ul className="mt-1 list-inside list-disc text-xs">
                {meta.stale.map((s) => (
                  <li key={s}>{s}</li>
                ))}
              </ul>
            </Note>
          )}

          {unmeasuredBerths.length > 0 && (
            <Note title={`${unmeasuredBerths.length} berthing areas have no recorded length`} tone="warn">
              {unmeasuredBerths.map((b) => b.name).join(' and ')} appear partway through the archive
              and carry no length in their row label. They are grouped areas rather than single
              measured berths, so any vessel placed there is reported as unverifiable, never as
              fitting.
            </Note>
          )}

          <Note title="Vessel names are inconsistently cased across years">
            <code>S/V Golden Heron</code> and <code>S/V GOLDEN HERON</code> are the same hull.
            Names are normalised to a case-insensitive key so one vessel does not read as two, and
            so a vessel does not appear to double-book itself.
          </Note>

          <Note title="Some roster rows contradict themselves">
            A handful of roster entries carry an <code>LOA:</code> note that disagrees with the
            length in the vessel&apos;s own name. Where a vessel is listed more than once the
            longest length is used, so the fit check errs toward flagging rather than toward silent
            approval.
          </Note>
        </div>
      </section>
    </div>
  )
}

function Note({
  title,
  tone = 'neutral',
  children,
}: {
  title: string
  tone?: 'neutral' | 'warn'
  children: React.ReactNode
}) {
  const cls =
    tone === 'warn'
      ? 'bg-wash ring-line text-ink'
      : 'bg-panel ring-line text-ink'
  return (
    <div className={`rounded-[8px] px-4 py-3 text-sm ring-1 ${cls}`}>
      <div className="font-semibold">{title}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  )
}
