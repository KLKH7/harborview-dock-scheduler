import type { Metadata } from 'next'
import Link from 'next/link'
import { Rail } from '@/components/Rail'
import './globals.css'

export const metadata: Metadata = {
  title: 'Harborview dock schedule',
  description: 'Berth occupancy for the Harborview waterfront',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full">
      <body className="flex h-full min-h-0 flex-col overflow-hidden sm:flex-row">
        <Rail />
        <div className="flex min-h-0 flex-1 flex-col pb-12 sm:pb-0">
          <main className="flex min-h-0 flex-1 flex-col">{children}</main>
          <footer className="shrink-0 border-t border-line px-5 py-1.5 text-[11px] text-mute sm:px-8">
            <Link href="/import" className="hover:text-ink">
              Import notes
            </Link>
          </footer>
        </div>
      </body>
    </html>
  )
}
