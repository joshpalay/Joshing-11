import path from 'node:path';

import { and, eq, isNotNull, or } from 'drizzle-orm';

import { db, friendInvitations, friendships, users } from '@/server/db';
import { createFriendInvitation } from '@/server/friends/invitations';

import { AssertionRecorder } from '../lib/asserts';
import type { PlayerEvent } from '../lib/player';
import type { Scenario, ScenarioContext, ScenarioLog } from '../lib/scenario-context';
import { phoneFor, provisionTestUser } from '../lib/seed';

function now(): string {
  return new Date().toISOString();
}

const INVITEE_PHONE = phoneFor(101);
const INVITEE_DISPLAY_NAME = '[TEST] Invitee Carol';

async function run(ctx: ScenarioContext): Promise<ScenarioLog> {
  const startedAt = Date.now();
  const asserts = new AssertionRecorder();
  const events: PlayerEvent[] = [];

  try {
    // Need a fresh inviter for this scenario so we don't depend on
    // send-invitation having run first.
    const alice = await provisionTestUser({
      phone: phoneFor(51),
      displayName: '[TEST] Alice (accept-invitation)',
      scenarioId: ctx.scenarioId,
      manifest: ctx.manifest,
    });

    // Seed an invitation directly (rather than via the HTTP route the
    // send-invitation scenario covers). This keeps the scenarios independent
    // and lets us run --scenario=accept-invitation in isolation.
    const invitation = await createFriendInvitation({
      inviterUserId: alice.id,
      inviteePhone: INVITEE_PHONE,
      inviteeDisplayName: INVITEE_DISPLAY_NAME,
      preSeededInterests: ['Trivia'],
    });
    ctx.manifest.trackInvitation({
      id: invitation.id,
      inviterUserId: alice.id,
      inviteePhone: INVITEE_PHONE,
      scenarioId: ctx.scenarioId,
    });

    // New browser context — Carol has no existing session.
    const browserCtx = await ctx.browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });

    try {
      const page = await browserCtx.newPage();

      // 1. Visit the invite landing.
      await page.goto(`${ctx.baseUrl}/invite/${invitation.token}`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      events.push({ kind: 'navigated', url: page.url(), at: now() });
      const landingShot = path.join(ctx.screenshotDir, 'accept-invitation--landing.png');
      await page.screenshot({ path: landingShot, fullPage: false });
      events.push({ kind: 'screenshot', file: landingShot, note: 'invite landing', at: now() });

      const landingText = await page.locator('body').innerText().catch(() => '');
      asserts.check(
        'invite landing names inviter',
        landingText.includes('[TEST] Alice'),
        `landing text did not include inviter name; got: ${landingText.slice(0, 200)}`,
      );
      asserts.check(
        'invite landing has "See the note" link',
        landingText.includes('See the note'),
        'expected "See the note" text on landing',
      );

      // 2. Click through to /login?invitationToken=…
      const seeNoteLink = page.locator('a', { hasText: 'See the note' }).first();
      await seeNoteLink.click();
      await page.waitForLoadState('networkidle').catch(() => undefined);
      events.push({ kind: 'navigated', url: page.url(), at: now() });
      asserts.check(
        'landed on /login with invitationToken',
        page.url().includes('/login') && page.url().includes('invitationToken='),
        `unexpected URL after click: ${page.url()}`,
      );

      // 3. Enter phone and request OTP.
      const phoneInput = page.locator('input[placeholder="555-123-4567"]').first();
      await phoneInput.waitFor({ state: 'visible', timeout: 10_000 });
      await phoneInput.fill(INVITEE_PHONE);
      await phoneInput.press('Enter');

      // 4. Wait for the code input to appear, then submit magic code '000000'.
      const codeInput = page.locator('input[placeholder="000000"]').first();
      await codeInput.waitFor({ state: 'visible', timeout: 10_000 });
      await codeInput.fill('000000');
      const verifyResponsePromise = page.waitForResponse('**/api/auth/verify-otp', { timeout: 15_000 });
      await codeInput.press('Enter');
      const verifyResponse = await verifyResponsePromise.catch(() => null);
      asserts.expectTruthy('/api/auth/verify-otp response observed', !!verifyResponse);
      if (verifyResponse) {
        asserts.expectEqual('verify-otp returned 200', verifyResponse.status(), 200);
      }

      await page.waitForLoadState('networkidle').catch(() => undefined);
      const postOtpShot = path.join(ctx.screenshotDir, 'accept-invitation--post-otp.png');
      await page.screenshot({ path: postOtpShot, fullPage: false });
      events.push({ kind: 'screenshot', file: postOtpShot, note: 'post-otp', at: now() });

      // 5. DB assertions: Carol user row exists; invitation accepted; friendship active.
      const [carol] = await db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(eq(users.phoneNumber, INVITEE_PHONE))
        .limit(1);
      asserts.expectTruthy('Carol user row created', !!carol);
      if (carol) {
        ctx.manifest.trackUser({
          id: carol.id,
          phone: INVITEE_PHONE,
          displayName: carol.displayName ?? INVITEE_DISPLAY_NAME,
          scenarioId: ctx.scenarioId,
        });

        const [acceptedRow] = await db
          .select({ id: friendInvitations.id, acceptedAt: friendInvitations.acceptedAt, inviteeUserId: friendInvitations.inviteeUserId })
          .from(friendInvitations)
          .where(and(eq(friendInvitations.id, invitation.id), isNotNull(friendInvitations.acceptedAt)))
          .limit(1);
        asserts.expectTruthy('invitation row marked accepted', !!acceptedRow);
        if (acceptedRow) asserts.expectEqual('invitation.inviteeUserId is Carol.id', acceptedRow.inviteeUserId, carol.id);

        const [friendship] = await db
          .select({ id: friendships.id, status: friendships.status, formedVia: friendships.formedVia })
          .from(friendships)
          .where(or(
            and(eq(friendships.userAId, alice.id), eq(friendships.userBId, carol.id)),
            and(eq(friendships.userAId, carol.id), eq(friendships.userBId, alice.id)),
          ))
          .limit(1);
        asserts.expectTruthy('friendship row created', !!friendship);
        if (friendship) {
          ctx.manifest.trackFriendship({ id: friendship.id, scenarioId: ctx.scenarioId });
          asserts.expectEqual('friendship status active', friendship.status, 'active');
          asserts.expectEqual('friendship formedVia invitation', friendship.formedVia, 'invitation');
        }
      }

      // 6. Confirm a session cookie was set.
      const cookies = await browserCtx.cookies();
      const sessionCookie = cookies.find((c) => c.name === 'joshing_session');
      asserts.expectTruthy('joshing_session cookie set', !!sessionCookie?.value);

      await page.close();
    } finally {
      await browserCtx.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    asserts.fail('accept-invitation scenario threw', message);
    events.push({ kind: 'error', message, at: now() });
  }

  return {
    scenarioId: ctx.scenarioId,
    displayName: 'Accept a friend invitation end-to-end',
    status: asserts.hasFailures() ? 'fail' : 'pass',
    durationMs: Date.now() - startedAt,
    events,
    assertions: asserts.results,
  };
}

export const acceptInvitationScenario: Scenario = {
  id: 'accept-invitation',
  displayName: 'Accept a friend invitation end-to-end',
  description: 'Open /invite/<token> in a fresh context, complete OTP signup, verify Friendship row exists.',
  run,
};
