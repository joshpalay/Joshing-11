'use client';

import { useRouter } from 'next/navigation';
import {
  BarChart3,
  Bell,
  Code2,
  Compass,
  FileText,
  Flag,
  FlaskConical,
  Hammer,
  Hourglass,
  Loader2,
  LogOut,
  Network,
  PlayCircle,
  RefreshCw,
  Smartphone,
  Sparkles,
  Sprout,
  Sun,
  Upload,
  UserPlus,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useState } from 'react';

import { clearCachedLoadingMomentPayload } from '@/components/loading-moment/client-cache';
import { SettingsGroup, SettingsRow } from '@/components/profile/SettingsRow';
import { ResetWelcomeTourButton } from '@/components/profile/settings/ResetWelcomeTourButton';

/**
 * Log out, then redirect. `destroySession()` clears the `joshing_session`
 * cookie server-side; the redirect MUST be a hard navigation so the cleared
 * cookie takes effect and no stale authenticated client tree (App Router
 * cache) survives. A soft `router.push` left the user looking signed-in until
 * they manually navigated (B-LOGOUT-CONFIRM-FIX-01). 401 means the session was
 * already gone, which is still a successful logout.
 *
 * `navigate` is injected so the chain is testable without a DOM.
 */
export async function logoutAndRedirect(navigate: (url: string) => void): Promise<void> {
  const response = await fetch('/api/account/logout', {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok && response.status !== 401) {
    throw new Error('Could not log out.');
  }

  // Drop any cached Loading Moment payload so the next user in this tab can't
  // read it (sessionStorage outlives logout; the loader doesn't know the user).
  clearCachedLoadingMomentPayload();

  navigate('/login');
}

// TEMP (ungate): the Developer-tools section is currently shown to every owner
// viewing their own profile, regardless of admin status. To restore the
// ADMIN_USER_IDS gate (D-DESIGN-DEBT-STRUCTURAL-01, Phase 3), flip this back to
// `false` — `showDeveloperTools` then falls back to the `isAdmin` prop. The
// matching /dev route gate lives in src/app/dev/layout.tsx; revert both together.
const DEV_TOOLS_UNGATED = true;

// A single developer tool. Link tools open a route (and participate in the
// route-exists availability check); action tools fire an inline handler and are
// always available.
type DevTool =
  | { kind: 'link'; icon: ReactNode; title: string; subtitle: string; href: string }
  | {
      kind: 'action';
      icon: ReactNode;
      title: string;
      subtitle: string;
      onClick: () => void;
      disabled?: boolean;
    };

type DevToolGroup = { eyebrow: string; tools: DevTool[] };

/**
 * `isAdmin` normally gates the Developer-tools section via the ADMIN_USER_IDS
 * allowlist (the caller computes it from `isAdminUser(session.userId)`).
 * Defaults to false (fail closed). While `DEV_TOOLS_UNGATED` is true the gate
 * is bypassed and the section renders for any profile owner. This component only
 * mounts in the owner self-view, so the tools are never exposed on other
 * people's profiles either way.
 *
 * `availableToolHrefs` is the set of dev-tool routes the server found on disk
 * (see getExistingDevToolHrefs). A tool whose href is absent renders dimmed and
 * inert. `null`/`undefined` means the server couldn't run the check (e.g. a
 * production bundle without the source tree) — fail open and treat every tool
 * as available.
 */
export function AccountActions({
  isAdmin = false,
  availableToolHrefs,
}: {
  isAdmin?: boolean;
  availableToolHrefs?: string[] | null;
}) {
  const showDeveloperTools = DEV_TOOLS_UNGATED || isAdmin;
  const router = useRouter();
  const [confirmingLogout, setConfirmingLogout] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [logoutError, setLogoutError] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState('');
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [resettingGame, setResettingGame] = useState(false);
  const [resetGameError, setResetGameError] = useState<string | null>(null);

  const canDeleteAccount = deleteConfirmation === 'DELETE';

  async function createTestGame() {
    if (resettingGame) return;
    setResetGameError(null);
    setResettingGame(true);

    try {
      const response = await fetch('/api/daily/reset', {
        method: 'POST',
        credentials: 'include',
      });
      const body = (await response.json().catch(() => null)) as { message?: string } | null;

      if (!response.ok) {
        throw new Error(body?.message ?? 'Could not reset daily round.');
      }

      router.push('/daily');
    } catch (caught) {
      setResetGameError(caught instanceof Error ? caught.message : 'Could not reset daily round.');
      setResettingGame(false);
    }
  }

  async function confirmLogout() {
    setLoggingOut(true);
    setLogoutError(null);

    try {
      // Hard navigation (not router.push): see logoutAndRedirect above.
      await logoutAndRedirect((url) => {
        window.location.assign(url);
      });
    } catch (caught) {
      setLogoutError(caught instanceof Error ? caught.message : 'Could not log out.');
      setLoggingOut(false);
    }
  }

  async function confirmDeleteAccount() {
    if (!canDeleteAccount) return;

    setDeletingAccount(true);
    setDeleteError(null);

    try {
      const response = await fetch('/api/account', {
        method: 'DELETE',
        credentials: 'include',
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok && response.status !== 401) {
        throw new Error(body?.error ?? 'Could not delete your account.');
      }

      router.push('/login');
    } catch (caught) {
      setDeleteError(caught instanceof Error ? caught.message : 'Could not delete your account.');
      setDeletingAccount(false);
    }
  }

  // Grouped, eyebrow-labelled dev tools. Order within each group is
  // intentional (most-used first). The first-time-experience group collects the
  // onboarding / first-run preview tools so they read as one family.
  const devToolGroups: DevToolGroup[] = [
    {
      // The onboarding-harness stages (formerly behind the /dev/onboarding hub
      // page, now consolidated here). Order follows the live flow: full
      // walkthrough first, then the individual stages it chains through.
      eyebrow: 'First-time experience',
      tools: [
        {
          kind: 'link',
          icon: <PlayCircle className="size-5" />,
          title: 'Full signup walkthrough',
          subtitle: 'Setup → areas → welcome tour → building → recap, chained (read-only)',
          href: '/dev/onboarding/intro?walk=1',
        },
        {
          kind: 'link',
          icon: <UserPlus className="size-5" />,
          title: 'Setup & areas of knowledge',
          subtitle: 'Name + call sign, then areas — the real flow, writes stubbed',
          href: '/dev/onboarding/intro',
        },
        {
          kind: 'link',
          icon: <Hourglass className="size-5" />,
          title: 'Preview the loading screen',
          subtitle: 'Cycle every Loading Moment card + the sparse fallback, no real load',
          href: '/dev/loading-preview',
        },
        {
          kind: 'link',
          icon: <Compass className="size-5" />,
          title: 'Replay the welcome tour',
          subtitle: 'The first-run coach-marks over a sample home, into Play',
          href: '/dev/welcome-tour',
        },
        {
          kind: 'link',
          icon: <Sparkles className="size-5" />,
          title: 'Show me the first time player',
          subtitle: 'The post-first-five recap + Beat 3 social handoff a new player sees',
          href: '/dev/first-time-player',
        },
        {
          kind: 'link',
          icon: <Smartphone className="size-5" />,
          title: 'Phone-first invite login',
          subtitle: 'Preview the invite login screens without sending an invite',
          href: '/dev/invite-login',
        },
      ],
    },
    {
      eyebrow: 'Game & session',
      tools: [
        {
          kind: 'action',
          icon: <FlaskConical className="size-5" />,
          title: resettingGame ? 'Resetting…' : 'Create test game',
          subtitle: "Reset today's game and play again",
          onClick: () => void createTestGame(),
          disabled: resettingGame,
        },
        {
          kind: 'link',
          icon: <RefreshCw className="size-5" />,
          title: 'Reset session',
          subtitle: 'Clear current session data',
          href: '/dev/reset-session',
        },
        {
          kind: 'link',
          icon: <Sun className="size-5" />,
          title: 'Trigger noon reset',
          subtitle: 'Simulate daily reset',
          href: '/dev/noon-reset',
        },
      ],
    },
    {
      eyebrow: 'Diagnostics & flags',
      tools: [
        {
          kind: 'link',
          icon: <Code2 className="size-5" />,
          title: 'View staging flags',
          subtitle: 'See feature flag status',
          href: '/dev/flags',
        },
        {
          kind: 'link',
          icon: <Network className="size-5" />,
          title: 'Knowledge map (bubbles)',
          subtitle: 'Preview the nested circle-pack knowledge page before the flag flips',
          href: '/dev/knowledge-map',
        },
        {
          kind: 'link',
          icon: <BarChart3 className="size-5" />,
          title: 'Points diagnostic',
          subtitle: "Inspect a user's mastery events and where points came from",
          href: '/dev/points-diagnostic',
        },
        {
          kind: 'link',
          icon: <Sprout className="size-5" />,
          title: 'Expansion offer card',
          subtitle: 'Preview the post-daily-Five “branch out” card',
          href: '/daily/summary/expand-preview',
        },
        {
          kind: 'link',
          icon: <Bell className="size-5" />,
          title: 'Reminder interstitial',
          subtitle: 'Preview the one-time email-reminder takeover on summary exit',
          href: '/daily/summary/reminder-interstitial-preview',
        },
        {
          kind: 'link',
          icon: <BarChart3 className="size-5" />,
          title: 'Expansion offer funnel',
          subtitle: 'How often the “branch out” offer triggers, resolves, and pends',
          href: '/dev/expansion-offer',
        },
        {
          kind: 'link',
          icon: <FileText className="size-5" />,
          title: 'Area Expansion spec',
          subtitle: 'B-AREA-EXPANSION-01 build prompt + its decision doc',
          href: '/dev/area-expansion-spec',
        },
      ],
    },
    // Admin-only content ops. Each /admin/* route is itself gated by
    // ADMIN_USER_IDS (404 for everyone else), so we only surface the links to
    // admins — no point showing a non-admin a row that 404s. The rest of the
    // dev-tools section stays ungated (see DEV_TOOLS_UNGATED).
    ...(isAdmin
      ? [
          {
            eyebrow: 'Admin',
            tools: [
              {
                kind: 'link',
                icon: <Hammer className="size-5" />,
                title: 'Crafter',
                subtitle: 'Where your craft is wanted — draft, keep, and invite authors',
                href: '/admin/crafter',
              },
              {
                kind: 'link',
                icon: <Flag className="size-5" />,
                title: 'Review queue',
                subtitle: 'Content reports and machine demotions awaiting a human',
                href: '/admin/reports',
              },
              {
                kind: 'link',
                icon: <Network className="size-5" />,
                title: 'Knowledge graph',
                subtitle: 'Author the leaf/parent taxonomy — nodes, edges, thresholds',
                href: '/admin/knowledge',
              },
              {
                kind: 'link',
                icon: <Upload className="size-5" />,
                title: 'Bulk upload questions',
                subtitle: 'Create questions in bulk from a CSV',
                href: '/admin/bulk-upload',
              },
            ],
          } satisfies DevToolGroup,
        ]
      : []),
  ];

  // null/undefined => the server couldn't run the route-exists check; fail open.
  // Strip any query string first — the availability scan keys on bare route
  // paths, so `/dev/onboarding/intro?walk=1` checks against `/dev/onboarding/intro`.
  const isToolAvailable = (href: string) =>
    availableToolHrefs == null || availableToolHrefs.includes(href.split('?')[0]);

  function renderTool(tool: DevTool) {
    if (tool.kind === 'action') {
      return (
        <SettingsRow
          key={tool.title}
          icon={tool.icon}
          title={tool.title}
          subtitle={tool.subtitle}
          onClick={tool.onClick}
          disabled={tool.disabled}
        />
      );
    }
    return (
      <SettingsRow
        key={tool.href}
        icon={tool.icon}
        title={tool.title}
        subtitle={tool.subtitle}
        href={tool.href}
        unavailable={!isToolAvailable(tool.href)}
      />
    );
  }

  return (
    <>
      {showDeveloperTools ? (
        <section className="mb-8">
          <h2 className="mb-3 font-serif text-2xl font-semibold">Developer tools</h2>
          <div className="flex flex-col gap-5">
            {devToolGroups.map((group) => (
              <div key={group.eyebrow}>
                <p className="text-muted-foreground mb-2 px-1 font-mono type-eyebrow font-semibold tracking-eyebrow uppercase">
                  {group.eyebrow}
                </p>
                <SettingsGroup>{group.tools.map(renderTool)}</SettingsGroup>
              </div>
            ))}
            <div>
              <p className="text-muted-foreground mb-2 px-1 font-mono type-eyebrow font-semibold tracking-eyebrow uppercase">
                First-run reset
              </p>
              <ResetWelcomeTourButton />
            </div>
          </div>
          {resetGameError ? (
            <p className="text-destructive mt-2 text-sm">{resetGameError}</p>
          ) : null}
        </section>
      ) : null}

      <section className="mb-8">
        <h2 className="mb-3 font-serif text-2xl font-semibold">Account</h2>
        <SettingsGroup>
          <SettingsRow
            icon={<LogOut className="size-5" />}
            title="Log out"
            subtitle="Sign out of your account"
            onClick={() => {
              setConfirmingLogout(true);
              setConfirmingDelete(false);
              setDeleteError(null);
            }}
            disabled={loggingOut}
          />
        </SettingsGroup>
        {confirmingLogout ? (
          <div className="border-destructive/30 bg-card text-card-foreground mt-3 rounded-xl border p-4">
            <p className="text-sm font-medium">Are you sure you want to log out?</p>
            <div className="mt-3 flex gap-2">
              <button
                className="btn-danger gap-2"
                type="button"
                onClick={() => void confirmLogout()}
                disabled={loggingOut}
              >
                {loggingOut ? <Loader2 className="size-4 animate-spin" /> : null}
                Log out
              </button>
              <button
                className="btn-ghost"
                type="button"
                onClick={() => setConfirmingLogout(false)}
                disabled={loggingOut}
              >
                Cancel
              </button>
            </div>
            {logoutError ? <p className="text-destructive mt-2 text-sm">{logoutError}</p> : null}
          </div>
        ) : null}

        <div className="mt-6">
          {confirmingDelete ? (
            <div className="border-destructive bg-destructive/5 rounded-xl border p-4">
              <p className="text-destructive text-sm font-semibold">
                Delete your account permanently?
              </p>
              <p className="text-muted-foreground mt-1 text-xs">
                This removes your account, sessions, stats, authored questions, games, and friend
                connections. This cannot be undone.
              </p>
              <label className="mt-3 block text-xs font-medium" htmlFor="delete-confirmation">
                Type DELETE to confirm.
              </label>
              <input
                id="delete-confirmation"
                value={deleteConfirmation}
                onChange={(event) => {
                  setDeleteConfirmation(event.target.value);
                  setDeleteError(null);
                }}
                className="focus:border-destructive mt-1 h-10 w-full rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-3 text-sm outline-none"
                autoComplete="off"
                disabled={deletingAccount}
              />
              <div className="mt-3 flex gap-2">
                <button
                  className="btn-danger gap-2"
                  type="button"
                  onClick={() => void confirmDeleteAccount()}
                  disabled={!canDeleteAccount || deletingAccount}
                >
                  {deletingAccount ? <Loader2 className="size-4 animate-spin" /> : null}
                  Permanently delete account
                </button>
                <button
                  className="btn-ghost"
                  type="button"
                  onClick={() => {
                    setConfirmingDelete(false);
                    setDeleteConfirmation('');
                    setDeleteError(null);
                  }}
                  disabled={deletingAccount}
                >
                  Cancel
                </button>
              </div>
              {deleteError ? <p className="text-destructive mt-2 text-sm">{deleteError}</p> : null}
            </div>
          ) : (
            <button
              type="button"
              className="text-muted-foreground hover:text-destructive text-xs font-medium underline-offset-2 hover:underline"
              onClick={() => {
                setConfirmingDelete(true);
                setConfirmingLogout(false);
                setLogoutError(null);
              }}
            >
              Delete account
            </button>
          )}
        </div>
      </section>
    </>
  );
}
