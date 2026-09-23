import { redirect } from 'next/navigation'

/** Old route. The page is now /review. */
export default function ProblemsRedirect() {
  redirect('/review')
}
