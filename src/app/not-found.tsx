import Link from 'next/link'

// App-wide 404. Without this every notFound() fell through to Next's unstyled
// default ("404 | This page could not be found."), which is what a blocked
// profile looked like from both sides (QA 2026-09-25, S22). The blocked side
// must keep seeing exactly this page — a block is never distinguishable from
// a profile that doesn't exist — so it stays generic on purpose.
export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5 pb-28">
      <h1 className="text-foreground mt-10 font-serif text-2xl font-semibold">
        Nothing to see here
      </h1>
      <p className="text-muted-foreground mt-1 mb-5 text-sm leading-6">
        This page isn&apos;t available. It may have moved, or it may not exist.
      </p>
      <Link href="/" className="btn-primary w-full">
        Go home
      </Link>
    </main>
  )
}
