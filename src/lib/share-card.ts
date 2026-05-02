import { randomBytes } from 'crypto';

import { and, eq, isNull } from 'drizzle-orm';

import { biweeklyCeremonies, db } from '@/server/db';
import type { BiweeklyCeremony } from '@/server/db/queries/ceremony';

function createToken(): string {
  return randomBytes(24).toString('base64url');
}

export function buildShareCardUrl(token: string): string {
  const baseUrl = (process.env.NEXT_PUBLIC_APP_URL ?? process.env.APP_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  return `${baseUrl}/share/ceremony/${token}`;
}

export async function generateShareCardToken(ceremonyId: string): Promise<string> {
  const [existing] = await db
    .select({ shareCardToken: biweeklyCeremonies.shareCardToken })
    .from(biweeklyCeremonies)
    .where(eq(biweeklyCeremonies.id, ceremonyId))
    .limit(1);

  if (existing?.shareCardToken) return existing.shareCardToken;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const token = createToken();
    try {
      const [updated] = await db
        .update(biweeklyCeremonies)
        .set({ shareCardToken: token })
        .where(and(eq(biweeklyCeremonies.id, ceremonyId), isNull(biweeklyCeremonies.shareCardToken)))
        .returning({ shareCardToken: biweeklyCeremonies.shareCardToken });

      if (updated?.shareCardToken) return updated.shareCardToken;

      const [raced] = await db
        .select({ shareCardToken: biweeklyCeremonies.shareCardToken })
        .from(biweeklyCeremonies)
        .where(eq(biweeklyCeremonies.id, ceremonyId))
        .limit(1);

      if (raced?.shareCardToken) return raced.shareCardToken;
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? error.code : null;
      if (code !== '23505') throw error;
    }
  }

  throw new Error('Could not generate share card token.');
}

export async function getCeremonyByShareToken(token: string): Promise<BiweeklyCeremony | null> {
  const [ceremony] = await db
    .select()
    .from(biweeklyCeremonies)
    .where(eq(biweeklyCeremonies.shareCardToken, token))
    .limit(1);

  return ceremony ?? null;
}
