import { Brain, Globe, type LucideIcon, Pencil, Users as UsersIcon } from 'lucide-react';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';

import { KnowledgeCard } from '@/components/knowledge/KnowledgeCard';
import { AuthoredQuestionsFeed } from '@/components/profile/AuthoredQuestionsFeed';
import { CommonGround } from '@/components/profile/CommonGround';
import { InlineEditableField } from '@/components/profile/InlineEditableField';
import { InlineHandleField } from '@/components/profile/InlineHandleField';
import { MutualFriendsSection } from '@/components/profile/MutualFriendsSection';
import { PreviewBanner } from '@/components/profile/PreviewBanner';
import { ProfileFriendButton } from '@/components/profile/ProfileFriendButton';
import { ProfileFriendsSection } from '@/components/profile/ProfileFriendsSection';
import { SectionVisibilityToggle } from '@/components/profile/SectionVisibilityToggle';
import { SettingsGroup, SettingsRow } from '@/components/profile/SettingsRow';
import { AccountActions } from '@/components/profile/settings/AccountActions';
import { getExistingDevToolHrefs } from '@/server/dev/tool-availability';
import { NotificationsForm } from '@/components/profile/settings/NotificationsForm';
import { PrivacyForm } from '@/components/profile/settings/PrivacyForm';
import { formatUsPhoneInput } from '@/lib/phone-e164';
import { isAdminUser } from '@/server/auth/admin';
import { getSession } from '@/server/auth/session';
import { getProviderSettings } from '@/server/llm/settings';
import { LlmProviderPanel } from '@/components/profile/settings/LlmProviderPanel';
import { LlmExperimentReadout, loadLlmExperimentData } from '@/components/profile/settings/LlmExperimentReadout';
import {
  getDiscoverability,
  getEditableProfile,
  getReminderState,
  HANDLE_CHANGE_COOLDOWN_DAYS,
} from '@/server/db/queries/account';
import { getCommonGround } from '@/server/db/queries/common-ground';
import { getFriends } from '@/server/db/queries/friends';
import { getKnowledgePageData, getUserMasteryOverview } from '@/server/db/queries/knowledge';
import { getAuthoredQuestionsForUser } from '@/server/db/queries/questions';
import { getFriendPortraitData } from '@/server/profile/friend';
import { toKnowledgeCardDomain, topPointPositiveDomains } from '@/server/profile/knowledge-view';
import { resolvePreviewAs } from '@/server/profile/preview';
import {
  buildInviteUrl,
  getBaseUrl,
  getOrCreateInviteToken,
} from '@/server/friends/user-invite-token';

const APP_VERSION = 'v1.0.0';

// Dashboard preview caps for a friend's profile. The full lists live behind
// the "view all" links (/users/[id]/friends and /users/[id]/questions).
const FRIENDS_PREVIEW_LIMIT = 5;
const QUESTIONS_PREVIEW_LIMIT = 5;
const COMMON_GROUND_LIMIT = 10;

export const dynamic = 'force-dynamic';

type UserProfilePageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ previewAs?: string }>;
};

function formatMemberSince(value: Date) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
  }).format(value);
}

function firstName(displayName: string): string {
  const trimmed = displayName.trim();
  if (!trimmed) return 'They';
  const [first] = trimmed.split(/\s+/);
  return first ?? trimmed;
}

// Builds the auto-generated tagline rendered at the top of every profile.
// Replaces the manual `tagline` field that was dropped in migration 0054.
function buildMindStatement(displayName: string, topDomains: { displayName: string }[]): string {
  const subject = displayName.trim() || 'A mind';
  const top = topDomains.slice(0, 3).map((d) => d.displayName);
  if (top.length >= 2) {
    return `${subject} is building around ${top.slice(0, -1).join(', ')} and ${top.at(-1)}.`;
  }
  if (top.length === 1) {
    return `${subject} is building around ${top[0]}.`;
  }
  return `${subject}'s mind will take shape as they answer and write questions.`;
}

export default async function UserProfilePage({ params, searchParams }: UserProfilePageProps) {
  const session = await getSession();
  if (!session) notFound();

  const { id } = await params;
  const { previewAs: rawPreviewAs } = await searchParams;
  // resolvePreviewAs enforces owner-only — non-owner requests return null
  // even if the URL has ?previewAs=… so a shared URL is inert.
  const previewAs = await resolvePreviewAs(rawPreviewAs, id, session.userId);
  const portrait = await getFriendPortraitData(id, session.userId, previewAs);
  if (!portrait) notFound();

  // isOwnerView: the requester is the real profile owner, regardless of
  // any active preview. Drives owner-only chrome.
  // ownerSelfView: the owner is on their own profile WITHOUT any active
  // preview — this is the settings-style management view.
  const isOwnerView = portrait.isOwnerView;
  const ownerSelfView = isOwnerView && !portrait.previewedAs;
  const isStranger = portrait.visibility === 'stranger';
  const friendFirstName = firstName(portrait.user.displayName);

  // A "stranger" (public / non-friend viewer) may still see whichever sections
  // the owner marked public. The teaser must only fully gate when NOTHING is
  // visible; otherwise we fall through to the content view, which already gates
  // each section by portrait.sectionVisibleTo. Bug fix: public knowledge/
  // questions were hidden from non-friends because the gate keyed off
  // friendship alone, never consulting sectionVisibleTo.
  const visibleSectionCount =
    (portrait.sectionVisibleTo.knowledge_base ? 1 : 0) +
    (portrait.sectionVisibleTo.authored_questions ? 1 : 0) +
    (portrait.sectionVisibleTo.friends_list ? 1 : 0);
  const strangerSeesNothing = isStranger && visibleSectionCount === 0;
  const strangerHasGatedSection = isStranger && visibleSectionCount < 3;

  // The simulated viewer's label for the banner. 'public' is the new
  // user-facing word for what the preview module still calls 'stranger'.
  const previewBannerLabel = !portrait.previewedAs
    ? null
    : portrait.previewedAs === 'stranger'
      ? 'public'
      : 'a friend';
  const exitPreviewHref = `/users/${portrait.user.id}`;

  const [
    mastery,
    pageData,
    commonGround,
    viewedUserFriends,
    authoredQuestions,
    editableProfile,
    discoverability,
    reminderState,
    inviteTokenResult,
  ] = await Promise.all([
    getUserMasteryOverview(portrait.user.id),
    getKnowledgePageData(portrait.user.id),
    // Common ground compares the viewer's full mastery base to this profile's.
    // Never rendered on the owner's own profile or for a public (stranger)
    // viewer, so skip the read for both.
    isOwnerView || isStranger
      ? Promise.resolve(null)
      : getCommonGround(session.userId, portrait.user.id),
    // The viewed user's own friends, surfaced (capped) in the Friends module.
    // Gated at render by their friends_list visibility. Needed whenever the
    // friend content view renders — including when the owner previews their
    // own profile as a friend — so skip only on the owner's self-management
    // view (no active preview), which never shows the module.
    ownerSelfView ? Promise.resolve([]) : getFriends(portrait.user.id),
    // Fetch one past the preview cap so the feed knows whether to show the
    // "view all" link without a separate count query.
    getAuthoredQuestionsForUser({
      userId: portrait.user.id,
      limit: QUESTIONS_PREVIEW_LIMIT + 1,
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
  ]);

  let inviteUrl: string | null = null;
  if (isOwnerView && inviteTokenResult?.handle) {
    const requestHeaders = await headers();
    inviteUrl = buildInviteUrl(
      getBaseUrl(requestHeaders),
      inviteTokenResult.handle,
      inviteTokenResult.token,
    );
  }

  const sortedDomains = [...pageData.allDomains].sort(
    (a, b) => b.points - a.points || a.displayName.localeCompare(b.displayName),
  );
  const topDomains = topPointPositiveDomains(sortedDomains, 5);
  const totalPointPositiveDomains = sortedDomains.filter((domain) => domain.points > 0).length;
  // The viewed user's friends, surfaced in the Friends module. Prefer a real
  // display name; never fall back to a phone number as a public label.
  const viewedFriends = viewedUserFriends.map((friend) => ({
    id: friend.id,
    displayName: friend.displayName?.trim() || 'Joshing friend',
  }));
  const mindStatement = buildMindStatement(portrait.user.displayName, topDomains);
  const tierSignature = `${new Intl.NumberFormat().format(
    Math.round(mastery.totalPoints),
  )} knowledge points across ${sortedDomains.length} territories`;

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
    // B-LLM-PROVIDER-AB-SWITCH B2: the provider test panel renders only for the
    // owner (ADMIN_USER_IDS allowlist). Read current state server-side so the
    // dropdowns reflect the DB; skip the read entirely for non-owners.
    const isOwner = isAdminUser(session.userId);
    const llmProviders = isOwner ? await getProviderSettings() : null;
    // B-LLM-PROVIDER-AB-METRICS: load the experiment readout data here (the page
    // is already awaited) and pass it into the sync presentational component.
    const llmExperimentData = isOwner ? await loadLlmExperimentData() : null;
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

        <section className="mt-8 mb-8">
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
          <h2 className="mb-3 font-serif text-2xl font-semibold">How others see your profile</h2>
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
          <h2 className="mb-3 font-serif text-2xl font-semibold">Privacy &amp; discovery</h2>
          <p className="text-muted-foreground mb-3 text-sm">
            Choose how other people can find you on Joshing.
          </p>
          <PrivacyForm initialState={discoverability} initialInviteUrl={inviteUrl} />
        </section>

        <section className="mb-8" id="notifications">
          <h2 className="mb-3 font-serif text-2xl font-semibold">Notifications</h2>
          <p className="text-muted-foreground mb-3 text-sm">
            We&apos;ll only message you when a new round opens. One per day, max.
          </p>
          <NotificationsForm
            initialState={reminderState}
            phone={formatUsPhoneInput(reminderState.phoneNumber)}
          />
        </section>

        {llmProviders ? <LlmProviderPanel initial={llmProviders} /> : null}
        {llmExperimentData ? <LlmExperimentReadout data={llmExperimentData} /> : null}

        <AccountActions
          isAdmin={isAdminUser(session.userId)}
          availableToolHrefs={getExistingDevToolHrefs()}
        />

        <footer className="text-muted-foreground mt-auto pt-6 text-center text-xs">
          <Link href="/terms" className="font-medium underline-offset-4 hover:underline">
            Terms &amp; Disclaimer
          </Link>
          <span className="mt-2 block">
            Joshing {APP_VERSION} · On Joshing since {formatMemberSince(portrait.user.memberSince)}.
          </span>
        </footer>
      </main>
    );
  }

  // Stranger short-circuit: non-friend viewers (and the owner previewing
  // as public) with NO public sections get the minimal teaser card. A
  // stranger who can see at least one public section falls through to the
  // content view below, which gates each section by sectionVisibleTo.
  if (strangerSeesNothing) {
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
          Become friends to see {friendFirstName}’s knowledge portrait, interests, and authored
          questions.
        </p>
      </main>
    );
  }

  // Friend view (also reached when the owner previews as a friend): show
  // the full content profile with the existing sections, gated by the
  // simulated viewer's section visibility.
  const authoredItems = authoredQuestions.map((question) => ({
    id: question.id,
    questionText: question.questionText,
    category: question.canonicalSubcategory ?? question.broadCategory,
    broadCategory: question.broadCategory,
    difficulty: question.difficulty,
    createdAt: question.createdAt,
    viewerAnswered: question.viewerAnswered,
  }));
  const isSelf = portrait.visibility === 'self';

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

      {/* Mutual friends teaser — shown to a public viewer who has at least one
          public section (the zero-section case is handled by the short-circuit
          teaser above). Friends/self get the relational modules instead. */}
      {isStranger ? (
        <MutualFriendsSection
          friends={portrait.mutualFriends}
          overflowCount={portrait.mutualFriendsOverflow}
          visibility="stranger"
          friendFirstName={friendFirstName}
        />
      ) : null}

      {/* Common ground is relational and never shown to strangers — it derives
          from the viewer's knowledge overlap and the teaser intentionally omits
          it. Friends only (self never saw it). */}
      {!isStranger && !isSelf ? (
        <CommonGround
          data={commonGround}
          friendFirstName={friendFirstName}
          limit={COMMON_GROUND_LIMIT}
        />
      ) : null}

      {portrait.sectionVisibleTo.knowledge_base ? (
        <section
          className="mt-8 border-t border-[var(--brand-rule)] pt-8"
          aria-label="Knowledge base"
        >
          <h2 className="font-serif text-2xl font-semibold">Knowledge base</h2>
          {!isSelf && topDomains.length > 0 ? (
            <div className="mt-3">
              <KnowledgeCard
                playerDisplayName={portrait.user.displayName}
                portraitStatement={mindStatement}
                domains={topDomains.map(toKnowledgeCardDomain)}
                overflowCount={Math.max(0, totalPointPositiveDomains - topDomains.length)}
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
            <p className="text-muted-foreground mt-2 text-sm leading-6">{tierSignature}.</p>
          )}
          <Link
            href={`/users/${portrait.user.id}/knowledge`}
            className="mt-3 inline-flex text-sm font-semibold text-[var(--warm-ink)] underline-offset-4 hover:underline"
          >
            {isSelf
              ? 'View your full knowledge base →'
              : `View ${friendFirstName}’s full knowledge base →`}
          </Link>
        </section>
      ) : null}

      {!isSelf && portrait.sectionVisibleTo.friends_list ? (
        <ProfileFriendsSection
          friends={viewedFriends}
          friendFirstName={friendFirstName}
          viewAllHref={`/users/${portrait.user.id}/friends`}
          limit={FRIENDS_PREVIEW_LIMIT}
        />
      ) : null}

      {portrait.sectionVisibleTo.authored_questions ? (
        <section aria-label="Authored questions">
          <AuthoredQuestionsFeed
            questions={authoredItems}
            friendDisplayName={portrait.user.displayName}
            friendUserId={portrait.user.id}
            friendProfileHref={`/users/${portrait.user.id}`}
            viewAllHref={`/users/${portrait.user.id}/questions`}
            previewLimit={QUESTIONS_PREVIEW_LIMIT}
          />
        </section>
      ) : null}

      {/* A public viewer who can see some sections but not all still gets the
          nudge to befriend for the rest. */}
      {strangerHasGatedSection ? (
        <p className="text-muted-foreground mt-6 text-sm">
          Become friends to see more of {friendFirstName}’s profile.
        </p>
      ) : null}
    </main>
  );
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
  displayName: string;
  handle: string | null;
  handleLastChangedAt: string | null;
  mindStatement: string;
  memberSince: Date;
  editable: boolean;
  friendshipFormedAt?: Date | null;
  friendButton?: React.ReactNode;
}) {
  return (
    <section className="bg-card text-card-foreground rounded-[var(--radius-card)] border p-5 shadow-[var(--shadow-card)]">
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
            <h1 className="text-foreground font-serif text-3xl font-semibold">{displayName}</h1>
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

          <p className="text-muted-foreground mt-2 text-sm leading-6 italic">{mindStatement}</p>

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
  );
}

// Per-scope helper micro-copy shown beneath each section's visibility toggle,
// so the owner can see exactly what each choice exposes. "Public" stays
// link-scoped ("with your profile link") rather than "indexed/searchable":
// profiles are never publicly indexed (PRD §8.6.1), only reachable by link.
const SECTION_VISIBILITY_HELP: Record<
  'knowledge_base' | 'authored_questions' | 'friends_list',
  Record<'public' | 'friends' | 'private', string>
> = {
  knowledge_base: {
    private: 'Only you can see your knowledge base.',
    friends: "Friends you've added on Joshing can see it.",
    public: 'Anyone with your profile link can see it.',
  },
  authored_questions: {
    private: "Only you can see the questions you've written.",
    friends: "Friends you've added on Joshing can see them.",
    public: 'Anyone with your profile link can see them.',
  },
  friends_list: {
    private: 'Only you can see your friends list.',
    friends: "Friends you've added on Joshing can see it.",
    public: 'Anyone with your profile link can see it.',
  },
};

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
  icon: LucideIcon;
  title: string;
  subtitle: string;
  section: 'knowledge_base' | 'authored_questions' | 'friends_list';
  visibility: 'public' | 'friends' | 'private';
}) {
  return (
    <div className="flex w-full flex-col gap-3 px-4 py-4">
      <div className="flex w-full items-center gap-4">
        <span
          className="bg-muted text-foreground/70 grid size-10 flex-none place-items-center rounded-full"
          aria-hidden="true"
        >
          <Icon className="size-5" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-serif text-base leading-tight font-semibold">{title}</span>
          <span className="text-muted-foreground mt-0.5 text-sm">{subtitle}</span>
        </span>
      </div>
      <div className="pl-14">
        <SectionVisibilityToggle
          section={section}
          label={title.toLowerCase()}
          initialVisibility={visibility}
          size="compact"
          fullWidth
          help={SECTION_VISIBILITY_HELP[section]}
        />
      </div>
    </div>
  );
}
