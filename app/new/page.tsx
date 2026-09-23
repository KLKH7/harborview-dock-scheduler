import { getBerths, getVessels } from '@/lib/data'
import { BookingForm } from './BookingForm'

export const dynamic = 'force-dynamic'

export default async function NewBookingPage() {
  const [berths, vessels] = await Promise.all([getBerths(), getVessels()])

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">New booking</h1>
        <p className="mt-1 text-sm text-slate-600">
          Checked against the same rules used on the historical schedule — the conflict and fit
          logic is one shared module, so what you see here is what the archive was graded against.
        </p>
      </div>
      <BookingForm berths={berths} vessels={vessels} />
    </div>
  )
}
