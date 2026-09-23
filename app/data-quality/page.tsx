import { redirect } from 'next/navigation'

/** Old route. What the data cannot tell us now lives at the foot of /problems. */
export default function DataQualityRedirect() {
  redirect('/problems')
}
