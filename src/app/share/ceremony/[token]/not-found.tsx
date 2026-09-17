import Link from 'next/link';

export default function NotFound() {
  return (
    // One ground, and it is cream — see the note in page.tsx.
    <main className="grid min-h-dvh place-items-center bg-[var(--brand-cream-page)] px-6 text-center text-[var(--brand-ink)]">
      <div>
        <h1 className="font-serif text-4xl font-semibold tracking-normal">
          This card has expired or doesn&rsquo;t exist.
        </h1>
        <Link href="/login" className="btn-primary mt-6">
          Try Joshing
        </Link>
      </div>
    </main>
  );
}
