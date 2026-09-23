import { redirect } from 'next/navigation'

/** Old route. The page is now /problems. */
export default function ConflictsRedirect() {
  redirect('/review')
}
