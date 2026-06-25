/**
 * Owner-only read/write for the LLM provider A/B switch
 * (B-LLM-PROVIDER-AB-SWITCH B2).
 *
 * Gated to the ADMIN_USER_IDS allowlist (isAdminUser). Non-owners get 404, never
 * 403 — the route's existence is not revealed (mirrors the admin convention in
 * src/server/auth/admin.ts). The /account panel reads via GET and persists each
 * dropdown change via PATCH. Zod-validated, like every other API input.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isAdminUser } from '@/server/auth/admin';
import { getSession } from '@/server/auth/session';
import { getProviderSettings, updateProviderSettings, type ProviderSurface } from '@/server/llm/settings';
import { writeProviderChanges, type ProviderChange } from '@/server/db/queries/llm-provider-experiment';
import type { AppSettingsUpdate } from '@/server/db/queries/app-settings';

const providerEnum = z.enum(['anthropic', 'openai']);

// A PATCH may touch any subset of the four surfaces; at least one must be present.
const patchBodySchema = z
  .object({
    gen: providerEnum.optional(),
    categorize: providerEnum.optional(),
    suggest: providerEnum.optional(),
    grade: providerEnum.optional(),
  })
  .refine((body) => Object.values(body).some((v) => v !== undefined), {
    message: 'No provider fields supplied.',
  });

export async function GET() {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }
  return NextResponse.json({ providers: await getProviderSettings() });
}

export async function PATCH(request: Request) {
  const session = await getSession();
  if (!session || !isAdminUser(session.userId)) {
    return NextResponse.json({ error: 'not found' }, { status: 404 });
  }

  const parsed = patchBodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid provider selection.' }, { status: 400 });
  }

  // Map the surface keys to the AppSettings column names.
  const update: AppSettingsUpdate = {};
  if (parsed.data.gen) update.genProvider = parsed.data.gen;
  if (parsed.data.categorize) update.categorizeProvider = parsed.data.categorize;
  if (parsed.data.suggest) update.suggestProvider = parsed.data.suggest;
  if (parsed.data.grade) update.gradeProvider = parsed.data.grade;

  // B-LLM-PROVIDER-AB-METRICS Part 3: read the pre-write state so we can log
  // exactly which surfaces flipped (the experiment's comparison windows depend on
  // knowing when each surface changed). getProviderSettings() reflects the value
  // the panel showed; reading it before the write captures the "from" side.
  const before = await getProviderSettings();
  const providers = await updateProviderSettings(update);

  const surfaces: ProviderSurface[] = ['gen', 'categorize', 'suggest', 'grade'];
  const changes: ProviderChange[] = surfaces
    .filter((surface) => providers[surface] !== before[surface])
    .map((surface) => ({ surface, from: before[surface], to: providers[surface] }));
  // Awaited (not fire-and-forget): the audit row matters more than the few ms on
  // this owner-only, low-frequency action, and writeProviderChanges swallows its
  // own errors so it can never fail the request.
  await writeProviderChanges(changes, session.userId);

  return NextResponse.json({ providers });
}
