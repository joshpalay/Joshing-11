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
import { getProviderSettings, updateProviderSettings } from '@/server/llm/settings';
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

  const providers = await updateProviderSettings(update);
  return NextResponse.json({ providers });
}
