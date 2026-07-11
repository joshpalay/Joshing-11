import { NextRequest, NextResponse } from 'next/server';

import { isCronAuthorized } from '@/server/auth/cron';
import {
  buildMasteryCalibration,
  readCalibSnapshotAround,
  renderMasteryCalibrationMarkdown,
  writeMasteryCalibrationSnapshot,
} from '@/server/knowledge/mastery-calibration';
import { sendMasteryCalibrationEmail } from '@/server/email/send-mastery-calibration';

export const dynamic = 'force-dynamic';

// D-MASTERY-FINEST-NODE-01 observability — the DAILY mastery-v2 calibration
// digest. Runs in SHADOW (computes what v2 would show without enabling the flag),
// stores one snapshot row per UTC day, and — quiet-by-default — emails the digest
// only when something is actionable: a live player would lose a badge on flip, a
// node is unmasterable at its threshold, or mastery reachability dropped WoW. Set
// MASTERY_CALIBRATION_ALWAYS_EMAIL=true to force a daily send during the initial
// observation window. Owner can trigger manually (same cron auth) to refresh.
const WOW_DAYS = 7;

function boolEnv(name: string): boolean {
  const raw = process.env[name]?.trim().toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
}

export async function GET(request: NextRequest) {
  if (!isCronAuthorized(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  try {
    const metrics = await buildMasteryCalibration();
    // WoW baseline for deltas (nearest snapshot on/after ~7 days ago). Best-effort.
    const previousSnap = await readCalibSnapshotAround(WOW_DAYS).catch(() => null);
    const previous = previousSnap?.metrics ?? null;

    const markdown = renderMasteryCalibrationMarkdown(metrics, previous);
    await writeMasteryCalibrationSnapshot(metrics, markdown);

    const wowMasteryDrop =
      previous != null && metrics.reachability.bucket75plus < previous.reachability.bucket75plus;
    const alwaysEmail = boolEnv('MASTERY_CALIBRATION_ALWAYS_EMAIL');
    const shouldEmail = alwaysEmail || metrics.actionable || wowMasteryDrop;

    let emailed = false;
    let emailReason: string | undefined;
    if (shouldEmail) {
      const email = await sendMasteryCalibrationEmail(metrics, markdown);
      emailed = email.ok;
      if (!email.ok) {
        emailReason = email.reason;
        if (email.reason === 'send_failed') {
          console.warn('[mastery-calibration-report] snapshot stored but email send failed', {
            message: email.message,
          });
        }
      }
    } else {
      emailReason = 'quiet';
    }

    return NextResponse.json({
      stored: true,
      shadow: metrics.shadow,
      verdict: metrics.verdict,
      players: metrics.players,
      nodes: metrics.totalNodes,
      badgesLostOnFlip: metrics.badges.lostByRealPlayers,
      unmasterableThreshold: metrics.classificationCounts.UNREACHABLE_THRESHOLD,
      masteredPairs: metrics.reachability.bucket75plus,
      actionable: metrics.actionable,
      wowMasteryDrop,
      emailed,
      emailReason,
    });
  } catch (error) {
    console.error('[mastery-calibration-report] failed to build/store snapshot', error);
    return NextResponse.json({ stored: false, error: 'report_failed' }, { status: 500 });
  }
}
