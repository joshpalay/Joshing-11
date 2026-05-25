import { Settings as SettingsIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'

import { KnowledgeCard } from '@/components/knowledge/KnowledgeCard'
import { AuthoredQuestionsFeed } from '@/components/profile/AuthoredQuestionsFeed'
import { InlineEditableField } from '@/components/profile/InlineEditableField'
import { InlineHandleField } from '@/components/profile/InlineHandleField'
import { MutualFriendsSection } from '@/components/profile/MutualFriendsSection'
import { PreviewAsButton } from '@/components/profile/PreviewAsButton'
import { PreviewBanner } from '@/components/profile/PreviewBanner'
import { ProfileFriendButton } from '@/components/profile/ProfileFriendButton'
import { SectionVisibilityToggle } from '@/components/profile/SectionVisibilityToggle'
import { SharedInterestsOverlap } from '@/components/profile/SharedInterestsOverlap'
import { getSession } from '@/server/auth/session'
import {
  getEditableProfile,
  HANDLE_CHANGE_COOLDOWN_DAYS,
} from '@/server/db/queries/account'
import { getFriends } from '@/server/db/queries/friends'
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
import { resolvePreviewAs } from '@/server/profile/preview'

type UserProfilePageProps = {
  params: Promise<{ id: string }>
  searchParams: Promise<{ previewAs?: string }>
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
  searchParams,
}: UserProfilePageProps) {
  const session = await getSession()
  if (!session) notFound()

  const { id } = await params
  const { previewAs: rawPreviewAs } = await searchParams
  // resolvePreviewAs enforces owner-only — non-owner requests return null
  // even if the URL has ?previewAs=… so a shared URL is inert.
  const previewAs = await resolvePreviewAs(rawPreviewAs, id, session.userId)
  const portrait = await getFriendPortraitData(id, session.userId, previewAs)
  if (!portrait) notFound()

  // isOwnerView: the requester is the real profile owner, regardless of
  // any active preview. Drives owner-only chrome (inline editors, gear,
  // preview button, section toggles).
  // editable: like isOwnerView but ALSO false during preview, so editors
  // and toggles vanish while previewing. Banner stays as the only chrome.
  const isOwnerView = portrait.isOwnerView
  const editable = isOwnerView && !portrait.previewedAs
  // visibility reflects the EFFECTIVE viewer. Stranger short-circuit
  // continues to fire when the simulated viewer is a stranger.
  const isSelf = portrait.visibility === 'self'
  const isStranger = portrait.visibility === 'stranger'
  const friendFirstName = firstName(portrait.user.displayName)

  // Banner shown for both stranger and friend previews. Exit returns to
  // the canonical URL without ?previewAs=…
  const previewBannerLabel = !portrait.previewedAs
    ? null
    : portrait.previewedAs === 'stranger'
      ? 'a stranger'
      : 'a friend'
  const exitPreviewHref = `/users/${portrait.user.id}`

  const profileLabel = isSelf
    ? 'Your profile'
    : isStranger
      ? 'Joshing member'
      : 'Friend profile'

  if (isStranger) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5">
        {previewBannerLabel ? (
          <PreviewBanner label={previewBannerLabel} exitHref={exitPreviewHref} />
        ) : null}
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
              {!isOwnerView ? (
                <ProfileFriendButton
                  targetUserId={portrait.user.id}
                  friendship={portrait.friendship}
                  targetDisplayName={portrait.user.displayName}
                />
              ) : null}
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

  const [mastery, pageData, authoredQuestions, editableProfile, ownerFriends] = await Promise.all([
    getUserMasteryOverview(portrait.user.id),
    getKnowledgePageData(portrait.user.id),
    getAuthoredQuestionsForUser({
      userId: portrait.user.id,
      limit: 25,
      viewerUserId: session.userId,
      viewer: portrait.visibility,
      sectionVisible: portrait.sectionVisibleTo.authored_questions,
    }),
    // editableProfile and ownerFriends are only needed when the owner is
    // viewing their own profile (with or without preview); skip those
    // queries for non-owner views. ownerFriends populates the Preview-as
    // picker's "specific friend" list.
    isOwnerView ? getEditableProfile(session.userId) : Promise.resolve(null),
    isOwnerView ? getFriends(session.userId) : Promise.resolve([]),
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
      {previewBannerLabel ? (
        <PreviewBanner label={previewBannerLabel} exitHref={exitPreviewHref} />
      ) : null}
      <div className="mb-5">
        <Link
          href="/friends"
          className="text-muted-foreground text-sm font-medium underline-offset-4 hover:underline"
        >
          ← Friends
        </Link>
      </div>

      <section className="bg-card text-card-foreground relative rounded-3xl border p-5 shadow-sm">
        {editable ? (
          <div className="absolute right-4 top-4 flex items-center gap-2">
            <PreviewAsButton
              profileHref={`/users/${portrait.user.id}`}
              friends={ownerFriends.map((u) => ({
                id: u.id,
                displayName: u.displayName?.trim() || u.phoneNumber,
              }))}
            />
            <Link
              href="/account"
              aria-label="Settings"
              className="text-muted-foreground hover:bg-muted hover:text-foreground inline-flex h-9 w-9 items-center justify-center rounded-md transition"
            >
              <SettingsIcon className="size-5" />
            </Link>
          </div>
        ) : null}
        <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
          {profileLabel}
        </p>
        <div className="mt-4 flex items-start gap-4">
          <div className="bg-primary/10 text-primary flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl font-serif text-3xl font-semibold">
            {portrait.user.displayName.slice(0, 1).toUpperCase() || 'J'}
          </div>
          <div className="min-w-0 flex-1">
            {editable && editableProfile ? (
              <div className="text-foreground font-serif text-3xl font-semibold">
                <InlineEditableField
                  field="displayName"
                  label="Display name"
                  placeholder="What people call you"
                  initialValue={editableProfile.displayName}
                  maxLength={60}
                  required
                />
              </div>
            ) : (
              <h1 className="text-foreground font-serif text-3xl font-semibold">
                {portrait.user.displayName}
              </h1>
            )}

            {editable ? (
              <div className="mt-1">
                <InlineHandleField
                  initialValue={portrait.user.handle}
                  initialLastChangedAt={editableProfile?.handleLastChangedAt ?? null}
                  cooldownDays={HANDLE_CHANGE_COOLDOWN_DAYS}
                />
              </div>
            ) : portrait.user.handle ? (
              <p className="text-muted-foreground mt-1 text-sm">
                @{portrait.user.handle}
              </p>
            ) : null}

            {editable || portrait.sectionVisibleTo.tagline ? (
              editable ? (
                <div className="text-muted-foreground mt-2 text-sm italic leading-6">
                  <InlineEditableField
                    field="tagline"
                    label="Tagline"
                    placeholder="A short phrase that fits in one line."
                    initialValue={portrait.user.tagline ?? ''}
                    maxLength={80}
                  />
                </div>
              ) : portrait.user.tagline ? (
                <p className="text-muted-foreground mt-2 text-sm italic leading-6">
                  {portrait.user.tagline}
                </p>
              ) : null
            ) : null}

            {editable || portrait.sectionVisibleTo.bio ? (
              editable ? (
                <div className="text-foreground mt-2 text-sm leading-6">
                  <InlineEditableField
                    field="bio"
                    label="Bio"
                    placeholder="Tell others what you’re about."
                    initialValue={portrait.user.bio ?? ''}
                    maxLength={280}
                    multiline
                  />
                </div>
              ) : portrait.user.bio ? (
                <p className="text-foreground mt-2 text-sm leading-6">
                  {portrait.user.bio}
                </p>
              ) : null
            ) : null}

            {editable || portrait.sectionVisibleTo.location ? (
              editable ? (
                <div className="text-muted-foreground mt-2 inline-flex items-center gap-1 text-xs">
                  <LocationGlyph className="size-3" />
                  <InlineEditableField
                    field="location"
                    label="Location"
                    placeholder="City, region, or country"
                    initialValue={portrait.user.location ?? ''}
                    maxLength={60}
                  />
                </div>
              ) : portrait.user.location ? (
                <p className="text-muted-foreground mt-1 inline-flex items-center gap-1 text-xs">
                  <LocationGlyph className="size-3" />
                  {portrait.user.location}
                </p>
              ) : null
            ) : null}

            <p className="text-muted-foreground mt-2 text-sm leading-6">
              On Joshing since {formatMemberSince(portrait.user.memberSince)}.
            </p>
            {portrait.friendship?.formedAt ? (
              <p className="text-muted-foreground mt-1 text-sm leading-6">
                Friends since {formatMemberSince(portrait.friendship.formedAt)}.
              </p>
            ) : null}
            {!isOwnerView ? (
              <ProfileFriendButton
                targetUserId={portrait.user.id}
                friendship={portrait.friendship}
                targetDisplayName={portrait.user.displayName}
              />
            ) : null}

            {editable && portrait.sectionSettings ? (
              <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2 border-t pt-3">
                <ProfileFieldVisibility
                  label="Tagline"
                  section="tagline"
                  visibility={portrait.sectionSettings.tagline}
                />
                <ProfileFieldVisibility
                  label="Bio"
                  section="bio"
                  visibility={portrait.sectionSettings.bio}
                />
                <ProfileFieldVisibility
                  label="Location"
                  section="location"
                  visibility={portrait.sectionSettings.location}
                />
              </div>
            ) : null}
          </div>
        </div>
      </section>

      {!isSelf && portrait.sectionVisibleTo.friends_list ? (
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

      {portrait.sectionVisibleTo.knowledge_map ? (
        <section className="mt-5" aria-label="Knowledge portrait">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
              Knowledge portrait
            </p>
            {editable && portrait.sectionSettings ? (
              <SectionVisibilityToggle
                section="knowledge_map"
                label="knowledge portrait"
                initialVisibility={portrait.sectionSettings.knowledge_map}
                size="compact"
              />
            ) : null}
          </div>
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
      ) : null}

      {editable && portrait.sectionSettings ? (
        <div className="mt-5 flex flex-wrap items-baseline justify-between gap-3 border-t pt-3">
          <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
            Friends list visibility
          </p>
          <SectionVisibilityToggle
            section="friends_list"
            label="friends list"
            initialVisibility={portrait.sectionSettings.friends_list}
            size="compact"
          />
        </div>
      ) : null}

      {portrait.sectionVisibleTo.authored_questions ? (
        <section className="mt-5" aria-label="Authored questions">
          {editable && portrait.sectionSettings ? (
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
              <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
                Authored questions
              </p>
              <SectionVisibilityToggle
                section="authored_questions"
                label="authored questions"
                initialVisibility={portrait.sectionSettings.authored_questions}
                size="compact"
              />
            </div>
          ) : null}
          <AuthoredQuestionsFeed
            questions={authoredItems}
            friendDisplayName={portrait.user.displayName}
            friendUserId={portrait.user.id}
            friendProfileHref={`/users/${portrait.user.id}`}
          />
        </section>
      ) : null}
    </main>
  )
}

// Small wrapper that pairs a field label with the section toggle for the
// header card's bio/tagline/location triplet. Keeps the per-field
// visibility controls in one compact row instead of three separate cards.
function ProfileFieldVisibility({
  label,
  section,
  visibility,
}: {
  label: string
  section: 'bio' | 'tagline' | 'location'
  visibility: 'public' | 'friends' | 'private'
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-muted-foreground text-xs font-medium uppercase tracking-[0.08em]">
        {label}
      </span>
      <SectionVisibilityToggle
        section={section}
        label={label.toLowerCase()}
        initialVisibility={visibility}
        size="compact"
      />
    </div>
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
