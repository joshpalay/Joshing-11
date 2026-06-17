import { Skeleton } from '@/components/ui/Skeleton';

// Route-level fallback for /from-friends. Mirrors the page shell (max-w-2xl
// column + OverflowSubpageHeader + a stack of friend-activity cards) so the
// layout holds steady while buildFriendActivityQueue resolves.
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 py-6 pb-32 md:py-10">
      <div aria-hidden="true">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="mt-3 h-8 w-52" />
      </div>
      <div className="flex flex-col gap-5" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-[var(--radius-card)] border p-5">
            <Skeleton className="h-3 w-32" />
            <Skeleton className="mt-4 h-5 w-5/6" />
          </div>
        ))}
      </div>
      <span className="sr-only" role="status">
        Loading activity from friends…
      </span>
    </main>
  );
}
