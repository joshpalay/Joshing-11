import {
  Brain,
  Globe,
  type LucideIcon,
  Pencil,
  Users as UsersIcon,
} from 'lucide-react'
import Link from 'next/link'
import { headers } from 'next/headers'
import { notFound } from 'next/navigation'

import { KnowledgeCard } from '@/components/knowledge/KnowledgeCard'
import { AuthoredQuestionsFeed } from '@/components/profile/AuthoredQuestionsFeed'
import { InlineEditableField } from '@/components/profile/InlineEditableField'
import { InlineHandleField } from '@/components/profile/InlineHandleField'
import { MutualFriendsSection } from '@/components/profile/MutualFriendsSection'
import { PreviewBanner } from '@/components/profile/PreviewBanner'
import { ProfileFriendButton } from '@/components/profile/ProfileFriendButton'
import { RecentlyExploringSection } from '@/components/profile/RecentlyExploringSection'
import { SectionVisibilityToggle } from '@/components/profile/SectionVisibilityToggle'
import { SettingsGroup, SettingsRow } from '@/components/profile/SettingsRow'
import { SharedInterestsOverlap } from '@/components/profile/SharedInterestsOverlap'
import { AccountActions } from '@/components/profile/settings/AccountActions'
import { NotificationsForm } from '@/components/profile/settings/NotificationsForm'
import { PrivacyForm } from '@/components/profile/settings/PrivacyForm'
import { maskPhone } from '@/components/profile/settings/phone-mask'
import { getSession } from '@/server/auth/session'
import {
  getDiscoverability,
  getEditableProfile,
  getReminderState,
  HANDLE_CHANGE_COOLDOWN_DAYS,
} from '@/server/db/queries/account'
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
import { selectRecentlyExploring } from '@/server/profile/recently-exploring'
import {
  buildInviteUrl,
  getBaseUrl,
  getOrCreateInviteToken,
} from '@/server/friends/user-invite-token'

const APP_VERSION = 'v1.0.0'

export const dynamic = 'force-dynamic'

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

// Builds the auto-generated tagline rendered at the top of every profile.
// Replaces the manual `tagline` field that was dropped in migration 0054.
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
  // any active preview. Drives owner-only chrome.
  // ownerSelfView: the owner is on their own profile WITHOUT any active
  // preview — this is the settings-style management view.
  const isOwnerView = portrait.isOwnerView
  const ownerSelfView = isOwnerView && !portrait.previewedAs
  const isStranger = portrait.visibility === 'stranger'
  const friendFirstName = firstName(portrait.user.displayName)

  // The simulated viewer's label for the banner. 'public' is the new
  // user-facing word for what the preview module still calls 'stranger'.
  const previewBannerLabel = !portrait.previewedAs
    ? null
    : portrait.previewedAs === 'stranger'
      ? 'public'
      : 'a friend'
  const exitPreviewHref = `/users/${portrait.user.id}`

  const [
    mastery,
    pageData,
    authoredQuestions,
    editableProfile,
    discoverability,
    reminderState,
    inviteTokenResult,
  ] = await Promise.all([
    getUserMasteryOverview(portrait.user.id),
    getKnowledgePageData(portrait.user.id),
    getAuthoredQuestionsForUser({
      userId: portrait.user.id,
      limit: 25,
      viewerUserId: session.userId,
      viewer: portrait.visibility,
      sectionVisible: portrait.sectionVisibleTo.authored_questions,
    }),
    // editableProfile is only needed for the owner-self management view
    // and the inline editors during a preview.
    isOwnerView ? getEditableProfile(session.userId) : Promise.resolve(null),
    // Settings data only fetched for the owner-self management view (the
    // only place these forms render). Skipped for friend/stranger/preview
    // variants to avoid pointless queries.
    isOwnerView ? getDiscoverability(session.userId) : Promise.resolve(null),
    isOwnerView ? getReminderState(session.userId) : Promise.resolve(null),
    isOwnerView ? getOrCreateInviteToken(session.userId) : Promise.resolve(null),
  ])

  let inviteUrl: string | null = null
  if (isOwnerView && inviteTokenResult?.handle) {
    const requestHeaders = await headers()
    inviteUrl = buildInviteUrl(
      getBaseUrl(requestHeaders),
      inviteTokenResult.handle,
      inviteTokenResult.token,
    )
  }

  const sortedDomains = [...pageData.allDomains].sort(
    (a, b) =>
      b.points - a.points || a.displayName.localeCompare(b.displayName),
  )
  const topDomains = topPointPositiveDomains(sortedDomains, 5)
  const totalPointPositiveDomains = sortedDomains.filter(
    (domain) => domain.points > 0,
  ).length
  // Activity-based presence: which domains the user has been answering in
  // lately (recent masteryEvents), distinct from the points-sorted knowledge
  // map above and from declared interests. Per-domain hidden domains are
  // already filtered out by `isHidden`.
  const recentlyExploring = selectRecentlyExploring(pageData.allDomains)
  const mindStatement = buildMindStatement(portrait.user.displayName, topDomains)
  const tierSignature = `${new Intl.NumberFormat().format(
    Math.round(mastery.totalPoints),
  )} knowledge points across ${sortedDomains.length} territories`

  // Owner self-view: the consolidated profile + settings surface. Header
  // card, visibility toggles, preview links, discovery + invite, reminder
  // prefs, dev tools, and account actions all live inline here. Previewing
  // or being a friend/public viewer is what surfaces the knowledge
  // portrait, authored questions, etc.
  if (
    ownerSelfView &&
    editableProfile &&
    portrait.sectionSettings &&
    discoverability &&
    reminderState
  ) {
    return (
      <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-6 pb-28">
        <ProfileHeaderCard
          displayName={editableProfile.displayName}
          handle={portrait.user.handle}
          handleLastChangedAt={editableProfile.handleLastChangedAt}
          mindStatement={mindStatement}
          memberSince={portrait.user.memberSince}
          editable
        />

        <section className="mb-8">
          <h2 className="mb-3 font-serif text-2xl font-semibold">Privacy</h2>
          <SettingsGroup>
            <PrivacyRow
              icon={Brain}
              title="Knowledge base"
              subtitle="Your domains, points, and the mind statement above."
              section="knowledge_base"
              visibility={portrait.sectionSettings.knowledge_base}
            />
            <PrivacyRow
              icon={Pencil}
              title="Questions"
              subtitle="The questions you've authored."
              section="authored_questions"
              visibility={portrait.sectionSettings.authored_questions}
            />
            <PrivacyRow
              icon={UsersIcon}
              title="Friends list"
              subtitle="Who can see your friends."
              section="friends_list"
              visibility={portrait.sectionSettings.friends_list}
            />
          </SettingsGroup>
        </section>

        <section className="mb-8">
          <h2 className="mb-3 font-serif text-2xl font-semibold">Preview</h2>
          <SettingsGroup>
            <SettingsRow
              icon={<UsersIcon className="size-5" />}
              title="View as friend"
              subtitle="See what an active mutual friend sees."
              href={`/users/${portrait.user.id}?previewAs=friend`}
            />
            <SettingsRow
              icon={<Globe className="size-5" />}
              title="View as public"
              subtitle="See only what's public to everyone else."
              href={`/users/${portrait.user.id}?previewAs=public`}
            />
          </SettingsGroup>
        </section>

        <section className="mb-8" id="privacy-discovery">
          <h2 className="mb-3 font-serif text-2xl font-semibold">
            Privacy &amp; discovery
          </h2>
          <p className="mb-3 text-sm text-muted-foreground">
            Choose how other people can find you on Joshing.
          </p>
          <PrivacyForm
            initialState={discoverability}
            initialInviteUrl={inviteUrl}
          />
        </section>

        <section className="mb-8" id="notifications">
          <h2 className="mb-3 font-serif text-2xl font-semibold">Notifications</h2>
          <p className="mb-3 text-sm text-muted-foreground">
            We&apos;ll only message you when a new round opens. One per day, max.
          </p>
          <NotificationsForm
            initialState={reminderState}
            maskedPhone={maskPhone(reminderState.phoneNumber)}
          />
        </section>

        <AccountActions />

        <footer className="mt-auto pt-6 text-center text-xs text-muted-foreground">
          Joshing {APP_VERSION} · On Joshing since{' '}
          {formatMemberSince(portrait.user.memberSince)}.
        </footer>
      </main>
    )
  }

  // Stranger short-circuit: non-friend viewers (and the owner previewing
  // as public) get the minimal teaser card without rich content.
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

        <ProfileHeaderCard
          displayName={portrait.user.displayName}
          handle={portrait.user.handle}
          handleLastChangedAt={null}
          mindStatement={mindStatement}
          memberSince={portrait.user.memberSince}
          editable={false}
          friendButton={
            !isOwnerView ? (
              <ProfileFriendButton
                targetUserId={portrait.user.id}
                relationship={portrait.relationship}
                targetDisplayName={portrait.user.displayName}
              />
            ) : null
          }
        />

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

  // Friend view (also reached when the owner previews as a friend): show
  // the full content profile with the existing sections, gated by the
  // simulated viewer's section visibility.
  const authoredItems = authoredQuestions.map((question) => ({
    id: question.id,
    questionText: question.questionText,
    category: question.canonicalSubcategory ?? question.broadCategory,
    createdAt: question.createdAt,
    viewerAnswered: question.viewerAnswered,
  }))
  const isSelf = portrait.visibility === 'self'

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col px-4 py-5 pb-28">
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

      <ProfileHeaderCard
        displayName={portrait.user.displayName}
        handle={portrait.user.handle}
        handleLastChangedAt={null}
        mindStatement={mindStatement}
        memberSince={portrait.user.memberSince}
        editable={false}
        friendshipFormedAt={portrait.relationship?.formedAt ?? null}
        friendButton={
          !isOwnerView ? (
            <ProfileFriendButton
              targetUserId={portrait.user.id}
              relationship={portrait.relationship}
              targetDisplayName={portrait.user.displayName}
            />
          ) : null
        }
      />

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

      {portrait.sectionVisibleTo.knowledge_base ? (
        <section className="mt-5" aria-label="Knowledge base">
          <p className="text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
            Knowledge base
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
            <p className="text-muted-foreground mt-2 text-sm leading-6">
              {tierSignature}.
            </p>
          )}
          <Link
            href={`/users/${portrait.user.id}/knowledge`}
            className="mt-3 inline-flex text-sm font-semibold text-stone-950 underline-offset-4 hover:underline"
          >
            {isSelf
              ? 'View your full knowledge base →'
              : `View ${friendFirstName}’s full knowledge base →`}
          </Link>
        </section>
      ) : null}

      {portrait.sectionVisibleTo.knowledge_base &&
      recentlyExploring.length > 0 ? (
        <RecentlyExploringSection
          domains={recentlyExploring}
          friendFirstName={friendFirstName}
        />
      ) : null}

      {portrait.sectionVisibleTo.authored_questions ? (
        <section className="mt-5" aria-label="Authored questions">
          <p className="mb-3 text-muted-foreground text-xs font-medium tracking-[0.1em] uppercase">
            Authored questions
          </p>
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

// Header card shown at the top of every profile variant. The mind
// statement (auto-generated from top mastery domains) replaces the
// manual tagline that was dropped in migration 0054.
function ProfileHeaderCard({
  displayName,
  handle,
  handleLastChangedAt,
  mindStatement,
  memberSince,
  editable,
  friendshipFormedAt = null,
  friendButton = null,
}: {
  displayName: string
  handle: string | null
  handleLastChangedAt: string | null
  mindStatement: string
  memberSince: Date
  editable: boolean
  friendshipFormedAt?: Date | null
  friendButton?: React.ReactNode
}) {
  return (
    <section className="bg-card text-card-foreground rounded-3xl border p-5 shadow-sm">
      <div className="flex items-start gap-4">
        <div className="bg-primary/10 text-primary flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl font-serif text-3xl font-semibold">
          {displayName.slice(0, 1).toUpperCase() || 'J'}
        </div>
        <div className="min-w-0 flex-1">
          {editable ? (
            <div className="text-foreground font-serif text-3xl font-semibold">
              <InlineEditableField
                field="displayName"
                label="Display name"
                placeholder="What people call you"
                initialValue={displayName}
                maxLength={60}
                required
              />
            </div>
          ) : (
            <h1 className="text-foreground font-serif text-3xl font-semibold">
              {displayName}
            </h1>
          )}

          {editable ? (
            <div className="mt-1">
              <InlineHandleField
                initialValue={handle}
                initialLastChangedAt={handleLastChangedAt}
                cooldownDays={HANDLE_CHANGE_COOLDOWN_DAYS}
              />
            </div>
          ) : handle ? (
            <p className="text-muted-foreground mt-1 text-sm">@{handle}</p>
          ) : null}

          <p className="text-muted-foreground mt-2 text-sm italic leading-6">
            {mindStatement}
          </p>

          <p className="text-muted-foreground mt-2 text-sm leading-6">
            On Joshing since {formatMemberSince(memberSince)}.
          </p>
          {friendshipFormedAt ? (
            <p className="text-muted-foreground mt-1 text-sm leading-6">
              Friends since {formatMemberSince(friendshipFormedAt)}.
            </p>
          ) : null}
          {friendButton}
        </div>
      </div>
    </section>
  )
}

// Settings-style row that renders a 3-level visibility toggle on the
// right instead of a chevron. Reused for each toggle in the Privacy
// section of the owner self-view.
function PrivacyRow({
  icon: Icon,
  title,
  subtitle,
  section,
  visibility,
}: {
  icon: LucideIcon
  title: string
  subtitle: string
  section: 'knowledge_base' | 'authored_questions' | 'friends_list'
  visibility: 'public' | 'friends' | 'private'
}) {
  return (
    <div className="flex w-full flex-col gap-3 px-4 py-4">
      <div className="flex w-full items-center gap-4">
        <span
          className="grid size-10 flex-none place-items-center rounded-full bg-muted text-foreground/70"
          aria-hidden="true"
        >
          <Icon className="size-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-serif text-base font-semibold leading-tight">
            {title}
          </span>
          <span className="mt-0.5 text-sm text-muted-foreground">{subtitle}</span>
        </span>
      </div>
      <div className="pl-14">
        <SectionVisibilityToggle
          section={section}
          label={title.toLowerCase()}
          initialVisibility={visibility}
          size="compact"
          fullWidth
        />
      </div>
    </div>
  )
}
