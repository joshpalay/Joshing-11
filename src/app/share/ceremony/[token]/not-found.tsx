import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-stone-950 px-6 text-center text-stone-50">
      <div>
        <h1 className="font-serif text-4xl font-semibold tracking-normal">This card has expired or doesn't exist.</h1>
        <Link href="/login" className="mt-6 inline-flex h-12 items-center justify-center rounded-md bg-stone-100 px-5 text-sm font-medium text-stone-950">
          Try Joshing
        </Link>
      </div>
    </main>
  );
}
