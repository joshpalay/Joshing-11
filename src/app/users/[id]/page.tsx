import Link from 'next/link'
import { notFound } from 'next/navigation'

import { KnowledgeCard } from '@/components/knowledge/KnowledgeCard'
import { PortraitCircles } from '@/components/knowledge/PortraitCircles'
import { getSession } from '@/server/auth/session'
import {
  getKnowledgePageData,
  getUserMasteryOverview,
} from '@/server/db/queries/knowledge'
import { getAuthoredQuestionsForUser } from '@/server/db/queries/questions'
import { getFriendPortraitData } from '@/server/profile/friend'
import {
  toKnowledgeCardDomain,
  toPortraitEntry,
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

function formatQuestionDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const now = new Date()
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  }).format(date)
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

  const [mastery, pageData, authoredQuestions] = await Promise.all([
    getUserMasteryOverview(portrait.user.id),
    getKnowledgePageData(portrait.user.id),
    getAuthoredQuestionsForUser({ userId: portrait.user.id, limit: 25 }),
  ])

  const sharedInterests = portrait.sharedInterests
  const hasInterests = portrait.interests.length > 0

  const sortedDomains = [...pageData.allDomains].sort(
    (a, b) =>
      b.points - a.points || a.displayName.localeCompare(b.displayName),
  )
  const portraitEntries = sortedDomains.map(toPortraitEntry)
  const topDomains = topPointPositiveDomains(sortedDomains, 5)
  const totalPointPositiveDomains = sortedDomains.filter(
    (domain) => domain.points > 0,
  ).length
  const hasKnowledge = sortedDomains.length > 0
  const mindStatement = buildMindStatement(portrait.user.displayName, topDomains)
  const tierSignature = `${new Intl.NumberFormat().format(
    Math.round(mastery.totalPoints),
  )} knowledge points across ${sortedDomains.length} territories`
  const friendFirstName = firstName(portrait.user.displayName)

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

      <section
        className="bg-card text-card-foreground mt-5 rounded-2xl border p-4 shadow-sm"
        aria-label="Knowledge map"
      >
        <div className="mb-4">
          <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
            Knowledge map
          </p>
          <h2 className="mt-1 font-serif text-xl font-semibold">
            {mindStatement}
          </h2>
        </div>

        {topDomains.length > 0 ? (
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
        ) : (
          <p className="text-muted-foreground bg-muted rounded-xl px-3 py-2 text-sm">
            Their map will fill in as they answer questions.
          </p>
        )}

        {hasKnowledge ? (
          <div className="mt-5">
            <PortraitCircles entries={portraitEntries} />
          </div>
        ) : null}
      </section>

      <section
        className="bg-card text-card-foreground mt-5 rounded-2xl border p-4 shadow-sm"
        aria-label="Authored questions"
      >
        <div className="mb-4">
          <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
            Questions
          </p>
          <h2 className="mt-1 font-serif text-xl font-semibold">
            Questions {friendFirstName} wrote
          </h2>
        </div>

        {authoredQuestions.length > 0 ? (
          <ul className="space-y-3">
            {authoredQuestions.map((question) => {
              const tag =
                question.canonicalSubcategory ?? question.broadCategory
              const date = formatQuestionDate(question.createdAt)
              return (
                <li
                  key={question.id}
                  className="bg-background rounded-xl border p-3"
                >
                  <p className="text-foreground text-sm leading-6">
                    {question.questionText}
                  </p>
                  <div className="text-muted-foreground mt-2 flex flex-wrap items-center gap-2 text-xs">
                    {tag ? (
                      <span className="bg-muted text-foreground rounded-full px-2.5 py-0.5">
                        {tag}
                      </span>
                    ) : null}
                    {date ? <span>{date}</span> : null}
                  </div>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="text-muted-foreground bg-muted rounded-xl px-3 py-2 text-sm">
            {friendFirstName} hasn&rsquo;t written any questions yet.
          </p>
        )}
      </section>
    </main>
  )
}
