import FeedList from '@/components/FeedList'

export default function FeedPage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-6 pb-24 md:py-10">
      <section className="space-y-6">
        <div>
          <p className="text-muted-foreground text-xs font-medium tracking-[0.12em] uppercase">
            Feed
          </p>
          <h1 className="text-foreground mt-3 font-serif text-4xl leading-tight font-semibold md:text-5xl">
            What&apos;s happening
          </h1>
          <p className="text-muted-foreground mt-4 max-w-xl text-base leading-7">
            Keep up with the moments where your friends recognize each other&apos;s questions.
          </p>
        </div>
        <FeedList />
      </section>
    </main>
  )
}
