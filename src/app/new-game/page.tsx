import Link from 'next/link';

export default function NewGameDisabledPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col items-center justify-center px-4 py-10 text-center">
      <section className="card p-6">
        <p className="text-xs uppercase tracking-eyebrow text-muted-foreground">Joshing Games</p>
        <h1 className="mt-2 font-serif text-3xl font-semibold">Game creation is coming soon.</h1>
        <p className="mt-3 text-sm leading-6 text-muted-foreground">
          Add a Joshing Game is disabled in v11.1. Existing games are still playable, and question creation is available now.
        </p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link href="/questions?create=1" className="btn-primary">
            Add a question
          </Link>
          <Link href="/" className="btn-ghost">
            Back home
          </Link>
        </div>
      </section>
      {/*
        // v11.1: Joshing Game creation disabled at FAB level. Re-enable
        // when game creation flow is restored.
      */}
    </main>
  );
}
