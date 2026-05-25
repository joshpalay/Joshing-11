import { z } from 'zod';

import { getUserById } from '@/server/db/queries/users';

/**
 * Preview-as request: lets the profile owner re-render their own page as
 * if a different viewer were looking at it. Three shapes:
 *
 *   - `'stranger'`  — simulate a logged-out / non-friend viewer.
 *   - `'friend'`    — simulate an unspecified active friend.
 *   - `{ userId }`  — simulate a specific user; resolves to `friend` if
 *                     that user is an active friend of the owner, else
 *                     `stranger`.
 *
 * Only the profile owner may use this; non-owner requests are silently
 * ignored (return `null`) so a shared URL with `?previewAs=...` does
 * nothing for the recipient.
 */
export type PreviewAs = 'stranger' | 'friend' | { userId: string };

/**
 * Zod schema for the raw `?previewAs=` query-string value before
 * resolution. The wire format is a single string: literal `'stranger'`,
 * literal `'friend'`, or any other non-empty string (interpreted as a
 * user id). `resolvePreviewAs` does the ownership + existence checks.
 */
export const previewAsSchema = z
  .string()
  .trim()
  .min(1)
  .max(128);

/**
 * Parse and authorize a raw `?previewAs=` query-string value. Returns
 * `null` (meaning "no preview, render normally") whenever any of the
 * following hold:
 *   - `raw` is missing, not a string, or fails Zod validation.
 *   - The requester is not the profile owner.
 *   - The value is a userId that does not exist.
 *
 * This is the single chokepoint for the preview-mode authorization, so
 * `getFriendPortraitData` and the page can trust the resolved value
 * without re-validating.
 */
export async function resolvePreviewAs(
  raw: unknown,
  ownerUserId: string,
  requesterUserId: string,
): Promise<PreviewAs | null> {
  if (ownerUserId.trim() !== requesterUserId.trim()) return null;
  if (raw === undefined || raw === null) return null;

  const parsed = previewAsSchema.safeParse(raw);
  if (!parsed.success) return null;
  const value = parsed.data;

  if (value === 'stranger') return 'stranger';
  if (value === 'friend') return 'friend';

  // Treat anything else as a user id. Confirm it exists so we don't
  // render a confusing banner for a deleted account.
  const target = await getUserById(value);
  if (!target) return null;
  return { userId: target.id };
}
