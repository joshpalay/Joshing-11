import Link from 'next/link'
import { notFound } from 'next/navigation'

import { KnowledgeCard } from '@/components/knowledge/KnowledgeCard'
import { PortraitCircles } from '@/components/knowledge/PortraitCircles'
import { getSession } from '@/server/auth/session'
import {
  getKnowledgePageData,
  getUserMasteryOverview,
} from '@/server/db/queries/knowledge'
import { getFriendPortraitData } from '@/server/profile/friend'
import {
  toKnowledgeCardDomain,
  toPortraitEntry,
  topPointPositiveDomains,
} from '@/server/profile/knowledge-view'

type FriendKnowledgePageProps = {
  params: Promise<{ id: string }>
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

export default async function FriendKnowledgePage({
  params,
}: FriendKnowledgePageProps) {
  const session = await getSession()
  if (!session) notFound()

  const { id } = await params
  const portrait = await getFriendPortraitData(id, session.userId)
  if (!portrait) notFound()
  if (portrait.visibility === 'stranger') notFound()

  const isOwner = portrait.visibility === 'self'
  const [mastery, pageData] = await Promise.all([
    getUserMasteryOverview(portrait.user.id),
    getKnowledgePageData(portrait.user.id),
  ])

  const visibleDomains = isOwner
    ? pageData.allDomains
    : pageData.allDomains.filter((domain) => !domain.isHidden)
  const sortedDomains = [...visibleDomains].sort(
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
  const visibleTotalPoints = isOwner
    ? mastery.totalPoints
    : sortedDomains.reduce((sum, domain) => sum + domain.points, 0)
  const tierSignature = `${new Intl.NumberFormat().format(
    Math.round(visibleTotalPoints),
  )} knowledge points across ${sortedDomains.length} territories`
  const friendFirstName = firstName(portrait.user.displayName)

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5">
      <div className="mb-5">
        <Link
          href={`/users/${portrait.user.id}`}
          className="text-muted-foreground text-sm font-medium underline-offset-4 hover:underline"
        >
          ← {friendFirstName}&rsquo;s profile
        </Link>
      </div>

      <header className="mb-5">
        <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
          Knowledge map
        </p>
        <h1 className="mt-1 font-serif text-3xl font-semibold">
          {friendFirstName}&rsquo;s knowledge map
        </h1>
        <p className="text-muted-foreground mt-2 text-sm leading-6">
          {mindStatement}
        </p>
      </header>

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
        <div className="mt-6">
          <PortraitCircles entries={portraitEntries} />
        </div>
      ) : null}
    </main>
  )
}
