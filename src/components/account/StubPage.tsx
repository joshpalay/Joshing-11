import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

export function StubPage({ title, description }: { title: string; description: string }) {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 pt-10 pb-28">
      <Link
        href="/account"
        className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ChevronLeft className="size-4" />
        Back
      </Link>
      <h1 className="mt-6 font-serif text-3xl font-semibold leading-tight">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{description}</p>
      <div className="mt-10 rounded-xl border bg-card p-8 text-center text-card-foreground">
        <p className="font-serif text-lg font-semibold">Coming soon</p>
        <p className="mt-1 text-sm text-muted-foreground">
          This area is still being built. Check back later.
        </p>
      </div>
    </main>
  );
}
