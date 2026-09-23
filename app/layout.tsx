import type { Metadata } from 'next'
import { AppNav } from '@/components/AppNav'
import './globals.css'

export const metadata: Metadata = {
  title: 'Harborview dock schedule',
  description: 'Berth occupancy, 1997 to 2019',
}

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full">
      <body className="flex h-full min-h-0 flex-col overflow-hidden">
        <AppNav />
        <main className="flex min-h-0 flex-1 flex-col">{children}</main>
      </body>
    </html>
  )
}
