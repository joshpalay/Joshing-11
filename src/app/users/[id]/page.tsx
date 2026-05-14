import Link from 'next/link'
import { notFound } from 'next/navigation'

import { getSession } from '@/server/auth/session'
import { getFriendPortraitData } from '@/server/profile/friend'

type UserProfilePageProps = {
  params: Promise<{ id: string }>
}

function formatMemberSince(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(value)
}

export default async function UserProfilePage({
  params,
}: UserProfilePageProps) {
  const session = await getSession()
  if (!session) notFound()

  const { id } = await params
  const portrait = await getFriendPortraitData(id, session.userId)
  if (!portrait) notFound()

  const sharedInterests = portrait.sharedInterests
  const hasInterests = portrait.interests.length > 0

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5">
      <div className="mb-5">
        <Link
          href="/friends"
          className="text-muted-foreground text-sm font-medium underline-offset-4 hover:underline"
        >
          ← Friends
        </Link>
      </div>

      <section className="bg-card text-card-foreground rounded-3xl border p-5 shadow-sm">
        <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
          {portrait.visibility === 'self' ? 'Your profile' : 'Friend profile'}
        </p>
        <div className="mt-4 flex items-start gap-4">
          <div className="bg-primary/10 text-primary flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl font-serif text-3xl font-semibold">
            {portrait.user.displayName.slice(0, 1).toUpperCase() || 'J'}
          </div>
          <div className="min-w-0">
            <h1 className="text-foreground font-serif text-3xl font-semibold">
              {portrait.user.displayName}
            </h1>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              On Joshing since {formatMemberSince(portrait.user.memberSince)}.
            </p>
            {portrait.friendship?.formedAt ? (
              <p className="text-muted-foreground mt-1 text-sm leading-6">
                Friends since {formatMemberSince(portrait.friendship.formedAt)}.
              </p>
            ) : null}
          </div>
        </div>
      </section>

      <section className="bg-card text-card-foreground mt-5 rounded-2xl border p-4 shadow-sm">
        <div className="mb-4">
          <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
            Portrait
          </p>
          <h2 className="mt-1 font-serif text-xl font-semibold">
            Interests and common ground
          </h2>
        </div>

        {sharedInterests.length > 0 ? (
          <div className="bg-primary/5 border-primary/10 mb-4 rounded-xl border p-3">
            <p className="text-sm font-medium">
              You share {sharedInterests.slice(0, 3).join(', ')}
              {sharedInterests.length > 3
                ? `, +${sharedInterests.length - 3} more`
                : ''}
              .
            </p>
          </div>
        ) : null}

        {hasInterests ? (
          <div className="flex flex-wrap gap-2">
            {portrait.interests.map((interest) => (
              <span
                key={interest.domain}
                className={
                  interest.shared
                    ? 'bg-primary/10 text-foreground border-primary/20 rounded-full border px-3 py-1 text-sm font-medium'
                    : 'bg-muted text-foreground rounded-full px-3 py-1 text-sm font-medium'
                }
              >
                {interest.domain}
                {interest.shared ? ' · shared' : ''}
              </span>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground bg-muted rounded-xl px-3 py-2 text-sm">
            This portrait will fill in as they declare interests and answer
            questions.
          </p>
        )}
      </section>
    </main>
  )
}
