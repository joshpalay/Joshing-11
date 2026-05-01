import type { Metadata } from 'next'
import './globals.css'
import { Nav } from "@/components/Nav";

export const metadata: Metadata = {
  title: 'Joshing',
  description: 'A daily knowledge game',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" className="font-sans">
      <body>
        <Nav />
        {children}
      </body>
    </html>
  )
}
