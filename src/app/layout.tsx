import type { Metadata } from 'next'
import { Montserrat } from 'next/font/google'
import './globals.css'
import { Nav } from "@/components/Nav";


const montserrat = Montserrat({
  subsets: ['latin'],
})

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
      <body className={montserrat.className}>
        <Nav />
        {children}
      </body>
    </html>
  )
}
