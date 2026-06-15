// Route-level fallback for /for-you. Mirrors the page shell (max-w-2xl column +
// OverflowSubpageHeader + a stack of feed cards) so the layout holds steady
// while buildPendingDirectQueue resolves, instead of a blank screen.
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 py-6 pb-32 md:py-10">
      <div className="animate-pulse" aria-hidden="true">
        <div className="h-3 w-20 rounded bg-black/[0.06]" />
        <div className="mt-3 h-8 w-56 rounded bg-black/[0.08]" />
      </div>
      <section className="flex flex-col gap-5" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-[12px] bg-black/[0.04] p-5 ring-1 ring-black/5"
          >
            <div className="h-3 w-24 rounded bg-black/[0.06]" />
            <div className="mt-4 h-5 w-full rounded bg-black/[0.08]" />
            <div className="mt-2 h-5 w-3/4 rounded bg-black/[0.08]" />
          </div>
        ))}
      </section>
      <span className="sr-only" role="status">
        Loading your questions…
      </span>
    </main>
  );
}
