import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';

export default function DevResetSessionPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 pt-10 pb-28">
      <Link
        href="/users/me"
        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-sm"
      >
        <ChevronLeft className="size-4" />
        Back
      </Link>
      <h1 className="mt-6 font-serif text-3xl leading-tight font-semibold">Reset session</h1>
      <p className="text-muted-foreground mt-2 text-sm">Clear current session data.</p>
      <div className="bg-card text-card-foreground mt-10 rounded-xl border p-8 text-center">
        <p className="font-serif text-lg font-semibold">Coming soon</p>
        <p className="text-muted-foreground mt-1 text-sm">
          This area is still being built. Check back later.
        </p>
      </div>
    </main>
  );
}
