import { getVessels } from '@/lib/data'
import { VesselDesk } from '@/components/VesselDesk'

export const dynamic = 'force-dynamic'

export default async function VesselsPage() {
  const vessels = await getVessels()

  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-[720px] space-y-8 px-5 py-6">
        <div>
          <h1 className="text-[17px] font-medium tracking-tight">Vessels</h1>
          <p className="mt-1 text-sm text-mute">
            Name and length in feet. If a length is set, a booking that does not fit the berth is
            refused.
          </p>
        </div>
        <VesselDesk vessels={vessels} />
      </div>
    </div>
  )
}
