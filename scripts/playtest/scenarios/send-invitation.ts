import path from 'node:path';

import { and, eq, isNull } from 'drizzle-orm';

import { db, friendInvitations } from '@/server/db';

import { AssertionRecorder } from '../lib/asserts';
import { contextForPlayer } from '../lib/browser';
import type { PlayerEvent } from '../lib/player';
import type { Scenario, ScenarioContext, ScenarioLog } from '../lib/scenario-context';
import { authenticateAndCookie, phoneFor, provisionTestUser } from '../lib/seed';

function now(): string {
  return new Date().toISOString();
}

const INVITEE_PHONE = phoneFor(100); // outside the player block to avoid collision
const INVITEE_DISPLAY_NAME = '[TEST] Invitee Bob';

async function run(ctx: ScenarioContext): Promise<ScenarioLog> {
  const startedAt = Date.now();
  const asserts = new AssertionRecorder();
  const events: PlayerEvent[] = [];

  try {
    const alice = await provisionTestUser({
      phone: phoneFor(50),
      displayName: '[TEST] Alice (inviter)',
      scenarioId: ctx.scenarioId,
      manifest: ctx.manifest,
    });
    const cookie = await authenticateAndCookie(ctx.baseUrl, alice.phone);

    const browserCtx = await contextForPlayer(ctx.browser, ctx.baseUrl, cookie.value);
    try {
      const page = await browserCtx.newPage();
      await page.goto(`${ctx.baseUrl}/friends`, { waitUntil: 'domcontentloaded' });
      await page.waitForLoadState('networkidle').catch(() => undefined);
      events.push({ kind: 'navigated', url: page.url(), at: now() });

      const screenshotFile = path.join(ctx.screenshotDir, 'send-invitation--friends.png');
      await page.screenshot({ path: screenshotFile, fullPage: false });
      events.push({ kind: 'screenshot', file: screenshotFile, note: 'friends page', at: now() });

      const response = await page.request.post(`${ctx.baseUrl}/api/friend-invitations`, {
        data: {
          inviteeDisplayName: INVITEE_DISPLAY_NAME,
          phone: INVITEE_PHONE,
          suggestedInterests: ['1980s Animation', 'Classical Music'],
        },
      });
      const body = (await response.json().catch(() => null)) as {
        ok: boolean;
        type?: string;
        inviteUrl?: string;
        id?: string;
        expiresAt?: string;
      } | null;

      asserts.expectEqual('POST /api/friend-invitations returns 200', response.status(), 200);
      asserts.expectTruthy('response body present', body);
      asserts.expectEqual('response type is friend_invitation', body?.type, 'friend_invitation');
      asserts.expectTruthy(
        'inviteUrl points at an /invite/ path',
        typeof body?.inviteUrl === 'string' && body.inviteUrl.includes('/invite/'),
      );

      if (body?.id) {
        ctx.manifest.trackInvitation({
          id: body.id,
          inviterUserId: alice.id,
          inviteePhone: INVITEE_PHONE,
          scenarioId: ctx.scenarioId,
        });
        ctx.manifest.putScenarioData(ctx.scenarioId, 'invitationId', body.id);
        ctx.manifest.putScenarioData(ctx.scenarioId, 'inviteUrl', body.inviteUrl);
        ctx.manifest.putScenarioData(ctx.scenarioId, 'inviteePhone', INVITEE_PHONE);
        ctx.manifest.putScenarioData(ctx.scenarioId, 'inviterUserId', alice.id);
      }

      // DB-level assertion: the row exists and is unaccepted.
      const [row] = await db
        .select({ id: friendInvitations.id, acceptedAt: friendInvitations.acceptedAt })
        .from(friendInvitations)
        .where(
          and(
            eq(friendInvitations.inviterUserId, alice.id),
            eq(friendInvitations.inviteePhone, INVITEE_PHONE),
            isNull(friendInvitations.acceptedAt),
          ),
        )
        .limit(1);
      asserts.expectTruthy('friendInvitations row exists in DB', !!row);
      if (row) asserts.expectEqual('acceptedAt is null pre-acceptance', row.acceptedAt, null);

      const after = path.join(ctx.screenshotDir, 'send-invitation--after.png');
      await page.screenshot({ path: after, fullPage: false });
      events.push({ kind: 'screenshot', file: after, note: 'after invite submit', at: now() });

      await page.close();
    } finally {
      await browserCtx.close();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    asserts.fail('send-invitation scenario threw', message);
    events.push({ kind: 'error', message, at: now() });
  }

  return {
    scenarioId: ctx.scenarioId,
    displayName: 'Send a friend invitation',
    status: asserts.hasFailures() ? 'fail' : 'pass',
    durationMs: Date.now() - startedAt,
    events,
    assertions: asserts.results,
  };
}

export const sendInvitationScenario: Scenario = {
  id: 'send-invitation',
  displayName: 'Send a friend invitation',
  description:
    'Alice (test inviter) hits POST /api/friend-invitations and the friendInvitations row appears.',
  run,
};
