// Route-level fallback for /from-friends. Mirrors the page shell (max-w-2xl
// column + OverflowSubpageHeader + a stack of friend-activity cards) so the
// layout holds steady while buildFriendActivityQueue resolves.
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-[18px] px-4 py-6 pb-32 md:py-10">
      <div className="animate-pulse" aria-hidden="true">
        <div className="h-3 w-24 rounded bg-black/[0.06]" />
        <div className="mt-3 h-8 w-52 rounded bg-black/[0.08]" />
      </div>
      <div className="flex flex-col gap-[18px]" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            className="animate-pulse rounded-[12px] bg-black/[0.04] p-5 ring-1 ring-black/5"
          >
            <div className="h-3 w-32 rounded bg-black/[0.06]" />
            <div className="mt-4 h-5 w-5/6 rounded bg-black/[0.08]" />
          </div>
        ))}
      </div>
      <span className="sr-only" role="status">
        Loading activity from friends…
      </span>
    </main>
  );
}
