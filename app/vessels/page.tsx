import { getVessels } from '@/lib/data'
import { VesselDesk } from '@/components/VesselDesk'

export const dynamic = 'force-dynamic'

export default async function VesselsPage() {
  const vessels = await getVessels()
  const missing = vessels.filter((v) => v.lengthFt == null).length

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[720px] space-y-8 px-5 py-6">
        <div>
          <h1 className="text-[17px] font-medium tracking-tight">Vessels</h1>
          <p className="mt-1 text-sm text-mute">
            Length lives here, as a number of feet. Booking uses it to refuse a hull that does not
            fit the berth.
            {missing > 0 && (
              <>
                {' '}
                {missing} {missing === 1 ? 'vessel has' : 'vessels have'} no length yet. Fit is not
                checked for those until you add one.
              </>
            )}
          </p>
        </div>
        <VesselDesk vessels={vessels} />
      </div>
    </div>
  )
}
