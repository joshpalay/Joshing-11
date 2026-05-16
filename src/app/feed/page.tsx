import FeedList from '@/components/FeedList'

export default function FeedPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-6 pb-24 md:py-10">
      <section className="space-y-6">
        <div>
          <h1 className="text-foreground text-4xl leading-tight font-semibold tracking-[-0.02em] md:text-5xl">
            Feed
          </h1>
          <p className="text-muted-foreground mt-3 max-w-xl text-base leading-7">
            Questions your friends thought you&apos;d like.
          </p>
        </div>
        <FeedList />
      </section>
    </main>
  )
}
