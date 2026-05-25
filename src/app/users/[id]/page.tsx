import { Settings as SettingsIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { KnowledgeCard } from '@/components/knowledge/KnowledgeCard'
import { AuthoredQuestionsFeed } from '@/components/profile/AuthoredQuestionsFeed'
import { MutualFriendsSection } from '@/components/profile/MutualFriendsSection'
import { ProfileFriendButton } from '@/components/profile/ProfileFriendButton'
import { SharedInterestsOverlap } from '@/components/profile/SharedInterestsOverlap'
import { getSession } from '@/server/auth/session'
import {
  getKnowledgePageData,
  getUserMasteryOverview,
} from '@/server/db/queries/knowledge'
import { getAuthoredQuestionsForUser } from '@/server/db/queries/questions'
import { getFriendPortraitData } from '@/server/profile/friend'
import {
  toKnowledgeCardDomain,
  topPointPositiveDomains,
} from '@/server/profile/knowledge-view'

type UserProfilePageProps = {
  params: Promise<{ id: string }>
}

function formatMemberSince(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(value)
}

function firstName(displayName: string): string {
  const trimmed = displayName.trim()
  if (!trimmed) return 'They'
  const [first] = trimmed.split(/\s+/)
  return first ?? trimmed
}

function buildMindStatement(
  displayName: string,
  topDomains: { displayName: string }[],
): string {
  const subject = displayName.trim() || 'A mind'
  const top = topDomains.slice(0, 3).map((d) => d.displayName)
  if (top.length >= 2) {
    return `${subject} is building around ${top.slice(0, -1).join(', ')} and ${top.at(-1)}.`
  }
  if (top.length === 1) {
    return `${subject} is building around ${top[0]}.`
  }
  return `${subject}'s mind will take shape as they answer and write questions.`
}

export default async function UserProfilePage({
  params,
}: UserProfilePageProps) {
  const session = await getSession()
  if (!session) notFound()

  const { id } = await params
  const portrait = await getFriendPortraitData(id, session.userId)
  if (!portrait) notFound()

  const isSelf = portrait.visibility === 'self'
  const isStranger = portrait.visibility === 'stranger'
  const friendFirstName = firstName(portrait.user.displayName)

  const profileLabel = isSelf
    ? 'Your profile'
    : isStranger
      ? 'Joshing member'
      : 'Friend profile'

  if (isStranger) {
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
            {profileLabel}
          </p>
          <div className="mt-4 flex items-start gap-4">
            <div className="bg-primary/10 text-primary flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl font-serif text-3xl font-semibold">
              {portrait.user.displayName.slice(0, 1).toUpperCase() || 'J'}
            </div>
            <div className="min-w-0">
              <h1 className="text-foreground font-serif text-3xl font-semibold">
                {portrait.user.displayName}
              </h1>
              {portrait.user.handle ? (
                <p className="text-muted-foreground mt-1 text-sm">
                  @{portrait.user.handle}
                </p>
              ) : null}
              {portrait.user.tagline ? (
                <p className="text-muted-foreground mt-2 text-sm italic leading-6">
                  {portrait.user.tagline}
                </p>
              ) : null}
              {portrait.user.location ? (
                <p className="text-muted-foreground mt-1 inline-flex items-center gap-1 text-xs">
                  <LocationGlyph className="size-3" />
                  {portrait.user.location}
                </p>
              ) : null}
              <p className="text-muted-foreground mt-2 text-sm leading-6">
                On Joshing since {formatMemberSince(portrait.user.memberSince)}.
              </p>
              <ProfileFriendButton
                targetUserId={portrait.user.id}
                friendship={portrait.friendship}
                targetDisplayName={portrait.user.displayName}
              />
            </div>
          </div>
        </section>

        <MutualFriendsSection
          friends={portrait.mutualFriends}
          overflowCount={portrait.mutualFriendsOverflow}
          visibility="stranger"
          friendFirstName={friendFirstName}
        />

        <p className="text-muted-foreground mt-6 text-sm">
          Become friends to see {friendFirstName}’s knowledge portrait,
          interests, and authored questions.
        </p>
      </main>
    )
  }

  const [mastery, pageData, authoredQuestions] = await Promise.all([
    getUserMasteryOverview(portrait.user.id),
    getKnowledgePageData(portrait.user.id),
    getAuthoredQuestionsForUser({
      userId: portrait.user.id,
      limit: 25,
      viewerUserId: session.userId,
    }),
  ])

  const sortedDomains = [...pageData.allDomains].sort(
    (a, b) =>
      b.points - a.points || a.displayName.localeCompare(b.displayName),
  )
  const topDomains = topPointPositiveDomains(sortedDomains, 5)
  const totalPointPositiveDomains = sortedDomains.filter(
    (domain) => domain.points > 0,
  ).length
  const mindStatement = buildMindStatement(portrait.user.displayName, topDomains)
  const tierSignature = `${new Intl.NumberFormat().format(
    Math.round(mastery.totalPoints),
  )} knowledge points across ${sortedDomains.length} territories`

  const authoredItems = authoredQuestions.map((question) => ({
    id: question.id,
    questionText: question.questionText,
    category: question.canonicalSubcategory ?? question.broadCategory,
    createdAt: question.createdAt,
    viewerAnswered: question.viewerAnswered,
  }))

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

      <section className="bg-card text-card-foreground relative rounded-3xl border p-5 shadow-sm">
        {isSelf ? (
          <Link
            href="/account"
            aria-label="Settings"
            className="text-muted-foreground hover:bg-muted hover:text-foreground absolute right-4 top-4 inline-flex h-9 w-9 items-center justify-center rounded-md transition"
          >
            <SettingsIcon className="size-5" />
          </Link>
        ) : null}
        <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
          {profileLabel}
        </p>
        <div className="mt-4 flex items-start gap-4">
          <div className="bg-primary/10 text-primary flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl font-serif text-3xl font-semibold">
            {portrait.user.displayName.slice(0, 1).toUpperCase() || 'J'}
          </div>
          <div className="min-w-0">
            <h1 className="text-foreground font-serif text-3xl font-semibold">
              {portrait.user.displayName}
            </h1>
            {portrait.user.handle ? (
              <p className="text-muted-foreground mt-1 text-sm">
                @{portrait.user.handle}
              </p>
            ) : null}
            {portrait.user.tagline ? (
              <p className="text-muted-foreground mt-2 text-sm italic leading-6">
                {portrait.user.tagline}
              </p>
            ) : null}
            {portrait.user.location ? (
              <p className="text-muted-foreground mt-1 inline-flex items-center gap-1 text-xs">
                <LocationGlyph className="size-3" />
                {portrait.user.location}
              </p>
            ) : null}
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              On Joshing since {formatMemberSince(portrait.user.memberSince)}.
            </p>
            {portrait.friendship?.formedAt ? (
              <p className="text-muted-foreground mt-1 text-sm leading-6">
                Friends since {formatMemberSince(portrait.friendship.formedAt)}.
              </p>
            ) : null}
            {!isSelf ? (
              <ProfileFriendButton
                targetUserId={portrait.user.id}
                friendship={portrait.friendship}
                targetDisplayName={portrait.user.displayName}
              />
            ) : null}
          </div>
        </div>
      </section>

      {!isSelf ? (
        <>
          <SharedInterestsOverlap
            viewerSoloInterests={portrait.viewerSoloInterests}
            friendSoloInterests={portrait.friendSoloInterests}
            sharedInterests={portrait.sharedInterests}
            friendFirstName={friendFirstName}
          />
          <MutualFriendsSection
            friends={portrait.mutualFriends}
            overflowCount={portrait.mutualFriendsOverflow}
            visibility="friend"
            friendFirstName={friendFirstName}
          />
        </>
      ) : null}

      <section className="mt-5" aria-label="Knowledge portrait">
        <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
          Knowledge portrait
        </p>
        {!isSelf && topDomains.length > 0 ? (
          <div className="mt-3">
            <KnowledgeCard
              playerDisplayName={portrait.user.displayName}
              portraitStatement={mindStatement}
              domains={topDomains.map(toKnowledgeCardDomain)}
              overflowCount={Math.max(
                0,
                totalPointPositiveDomains - topDomains.length,
              )}
              tierSignature={tierSignature}
              rarestTerritory={null}
              rarestTerritorySolo={false}
              shareText=""
              shareCardToken=""
              shareCardExpiresAt=""
              readOnly
            />
          </div>
        ) : (
          <>
            <h2 className="mt-1 font-serif text-xl font-semibold">
              {mindStatement}
            </h2>
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              {tierSignature}.
            </p>
          </>
        )}
        <Link
          href={`/users/${portrait.user.id}/knowledge`}
          className="mt-3 inline-flex text-sm font-semibold text-stone-950 underline-offset-4 hover:underline"
        >
          {isSelf
            ? 'View your full knowledge portrait →'
            : `View ${friendFirstName}’s full knowledge portrait →`}
        </Link>
      </section>

      {isSelf || portrait.user.authorProfilePublic ? (
        <AuthoredQuestionsFeed
          questions={authoredItems}
          friendDisplayName={portrait.user.displayName}
          friendUserId={portrait.user.id}
          friendProfileHref={`/users/${portrait.user.id}`}
        />
      ) : null}
    </main>
  )
}

function LocationGlyph({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}
