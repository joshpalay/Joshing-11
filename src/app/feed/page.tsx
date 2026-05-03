import FeedList from '@/components/FeedList';

export default function FeedPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5">
      <header className="mb-5 border-b pb-4">
        <p className="text-xs uppercase tracking-[0.1em] text-muted-foreground">Joshing</p>
        <h1 className="font-serif text-2xl font-semibold text-foreground">Feed</h1>
      </header>

      <FeedList />
    </main>
  );
}
