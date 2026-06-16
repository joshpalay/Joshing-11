import { Skeleton } from '@/components/ui/Skeleton';

// Route-level fallback for /for-you. Mirrors the page shell (max-w-2xl column +
// OverflowSubpageHeader + a stack of feed cards) so the layout holds steady
// while buildPendingDirectQueue resolves, instead of a blank screen.
export default function Loading() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col gap-5 px-4 py-6 pb-32 md:py-10">
      <div aria-hidden="true">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="mt-3 h-8 w-56" />
      </div>
      <section className="flex flex-col gap-5" aria-hidden="true">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-[var(--radius-card)] border p-5">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-4 h-5 w-full" />
            <Skeleton className="mt-2 h-5 w-3/4" />
          </div>
        ))}
      </section>
      <span className="sr-only" role="status">
        Loading your questions…
      </span>
    </main>
  );
}
