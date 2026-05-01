/**
 * SMS sending utility using Twilio Programmable SMS.
 * Logs every send attempt to SmsLog (never stores message content).
 * All functions are server-side only.
 */

import { prisma } from '@/lib/prisma';
import type { SmsMessageType } from '@prisma/client';
import type { GameWinnerMember } from '@/lib/games/winner';

/**
 * Send an SMS via Twilio and log the attempt.
 * Fails silently on missing env vars (dev environment).
 */
export async function sendSms(
  to: string,
  body: string,
  messageType: SmsMessageType,
  userId?: string
): Promise<void> {
  async function logAttempt() {
    try {
      await prisma.smsLog.create({
        data: {
          user_id: userId ?? null,
          phone_number: to,
          message_type: messageType,
        },
      });
    } catch (err) {
      console.error('[SMS] Failed to log SMS:', err);
    }
  }

  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const messagingServiceSid = process.env.TWILIO_MESSAGING_SERVICE_SID;

  if (!accountSid || !authToken || !messagingServiceSid) {
    console.warn('[SMS] Twilio env vars missing — SMS not sent:', messageType, to);
    await logAttempt();
    return;
  }

  try {
    const auth = Buffer.from(`${accountSid}:${authToken}`).toString('base64');
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          To: to,
          MessagingServiceSid: messagingServiceSid,
          Body: body,
        }).toString(),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      console.error('[SMS] Twilio error:', response.status, text);
    }
  } catch (err) {
    console.error('[SMS] Network error sending SMS:', err);
  }

  // Log the send attempt (never log message content per PRD)
  await logAttempt();
}

/**
 * Build the season-end SMS body for a specific recipient.
 * Returns one of 4 variants per spec: winner / non-winner / two-player / tie.
 */
export function buildGameCompleteSmsBody(
  recipientId: string,
  groupName: string,
  ceremonyUrl: string,
  winner: { display_name: string; user_id: string } | null,
  isTie: boolean,
  allMembers: GameWinnerMember[],
  opts?: { ceremony_mode?: 'solo' | 'duo' | 'group'; host_display_name?: string | null }
): string {
  const mode = opts?.ceremony_mode ?? 'group';
  const hostName = opts?.host_display_name?.trim();

  if (mode === 'solo' && hostName) {
    return `Your season in ${hostName}'s world is complete. See how your worlds overlapped: ${ceremonyUrl}`;
  }
  if (mode === 'solo') {
    return `Your ${groupName} season is complete. See what you discovered: ${ceremonyUrl}`;
  }

  // Duo: no winner language — aligns with ceremony (Result beat has no winner for duo).
  if (mode === 'duo') {
    const other = allMembers.find((m) => m.user_id !== recipientId);
    const otherName = other?.display_name?.trim() || 'your partner';
    return `Your Joshing season with ${otherName} just ended. See how your worlds overlapped: ${ceremonyUrl}`;
  }

  const isTwoPlayer = allMembers.length === 2;

  if (isTie) {
    // Tie variant — same message for everyone
    const names = allMembers
      .filter((m) => m.display_name)
      .map((m) => m.display_name!)
      .join(' and ');
    return `The ${groupName} season ended even. ${names} finished together. See the map: ${ceremonyUrl}`;
  }

  if (isTwoPlayer) {
    // Legacy two-member group where ceremony mode is still "group" (rare): neutral copy, no winner.
    const other = allMembers.find((m) => m.user_id !== recipientId);
    const otherName = other?.display_name?.trim() || 'your partner';
    return `Your Joshing season with ${otherName} just ended. See how your worlds overlapped: ${ceremonyUrl}`;
  }

  if (winner && winner.user_id === recipientId) {
    // Winner variant
    return `You won the ${groupName} season. See the final map: ${ceremonyUrl}`;
  }

  // Standard non-winner variant
  const winnerName = winner?.display_name ?? 'Someone';
  return `The ${groupName} season just ended. ${winnerName} knew you best. See how it all mapped out: ${ceremonyUrl}`;
}

/**
 * Send season-end ceremony SMS to all opted-in active members of a group.
 * PRD §8.5 — fired when game status flips to 'completed'.
 * Fire-and-forget: caller should NOT await this.
 */
export async function sendGameCompleteSms(
  groupId: string,
  gameId: string,
  groupName: string,
  gameNumber: number,
  baseUrl: string,
  winner: { display_name: string; user_id: string } | null = null,
  isTie: boolean = false,
  allMembers: GameWinnerMember[] = [],
  ceremonyOpts?: { ceremony_mode?: 'solo' | 'duo' | 'group'; host_display_name?: string | null }
): Promise<void> {
  // If allMembers not provided (legacy call), fetch them
  let members = allMembers;
  if (members.length === 0) {
    // TODO v11.0: prisma.groupMember.findMany - needs new data source
    members = [];
  }

  const ceremonyUrl = `${baseUrl}/groups/${groupId}/games/${gameId}/ceremony`;

  for (const member of members) {
    if (member.sms_opt_in === 'opted_in' && member.phone_number) {
      const body = buildGameCompleteSmsBody(
        member.user_id,
        groupName,
        ceremonyUrl,
        winner,
        isTie,
        members,
        ceremonyOpts
      );
      const truncated = body.length > 160 ? body.slice(0, 157) + '…' : body;
      sendSms(member.phone_number, truncated, 'game_complete', member.user_id).catch(
        (err) => console.error('[SMS] game_complete send failed:', err)
      );
    }
  }

  // Suppress unused variable warning for gameNumber (kept for API compatibility)
  void gameNumber;
}

/**
 * Send a prompt SMS to a question creator when a player gets their question wrong
 * and the question has no creator_note explaining context.
 * Deduplicates: skips if a creator_note_prompt was already sent for this question within 24 hours.
 * Fire-and-forget: caller should NOT await this.
 */
export async function sendCreatorNotePromptSms(
  creatorId: string,
  questionText: string,
  baseUrl: string
): Promise<void> {
  const creator = await prisma.user.findUnique({
    where: { id: creatorId },
    select: { phone_number: true, sms_opt_in: true },
  });

  if (!creator?.phone_number || creator.sms_opt_in !== 'opted_in') return;

  // Deduplicate: skip if already sent within the last 24 hours
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentLog = await prisma.smsLog.findFirst({
    where: {
      user_id: creatorId,
      message_type: 'creator_note_prompt',
      sent_at: { gte: since },
    },
    select: { id: true },
  });
  if (recentLog) return;

  const preview = questionText.length > 60 ? questionText.slice(0, 57) + '…' : questionText;
  const body = `Someone got your question wrong: "${preview}". Add a note to give context: ${baseUrl}/questions`;

  await sendSms(creator.phone_number, body.length > 160 ? body.slice(0, 157) + '…' : body, 'creator_note_prompt', creatorId);
}

/**
 * Send daily reminder SMS to a user.
 * PRD sms-copy.md §3 — standard and batched formats.
 */
export async function sendDailyReminder(
  userId: string,
  phoneNumber: string,
  groupNames: string[],
  baseUrl: string
): Promise<void> {
  if (groupNames.length === 0) return;

  const message = buildDailyReminderMessage(groupNames, baseUrl);

  await sendSms(phoneNumber, message, groupNames.length > 1 ? 'daily_questions_batched' : 'daily_questions', userId);
}

export function buildDailyReminderMessage(groupNames: string[], baseUrl: string): string {
  let message: string;
  if (groupNames.length === 1) {
    message = `${groupNames[0]} — up to 5 questions waiting. Your queue refills daily: ${baseUrl}/play`;
  } else if (groupNames.length === 2) {
    message = `${groupNames[0]} and ${groupNames[1]} — questions waiting. Your queue refills daily: ${baseUrl}/today`;
  } else {
    message = `${groupNames[0]} and ${groupNames.length - 1} other groups — questions waiting. Your queue refills daily: ${baseUrl}/today`;
  }

  if (message.length > 160) {
    return message.slice(0, 157) + '…';
  }
  return message;
}
