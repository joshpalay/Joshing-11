'use client';

import { useState } from 'react';

/**
 * Owner-only LLM provider test panel (B-LLM-PROVIDER-AB-SWITCH B2).
 *
 * Four dropdowns — one per LLM surface — each Anthropic | OpenAI, reflecting the
 * single global DB row. A change PATCHes /api/admin/llm-providers and is global
 * (affects everyone), not per-user. Quiet, system-voice copy: this is a test
 * panel, not a feature. Only ever rendered for the owner (the server page gates
 * it on ADMIN_USER_IDS), so no client-side auth is attempted here.
 */

type Provider = 'anthropic' | 'openai';
type Surface = 'gen' | 'categorize' | 'suggest' | 'grade';
type Providers = Record<Surface, Provider>;

const SURFACES: ReadonlyArray<{ key: Surface; label: string }> = [
  { key: 'gen', label: 'Generation' },
  { key: 'categorize', label: 'Categorization' },
  { key: 'suggest', label: 'Answer suggestion' },
  { key: 'grade', label: 'Grading' },
];

export function LlmProviderPanel({ initial }: { initial: Providers }) {
  const [providers, setProviders] = useState<Providers>(initial);
  const [savingKey, setSavingKey] = useState<Surface | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onChange(key: Surface, next: Provider) {
    const previous = providers[key];
    if (next === previous) return;

    // Optimistic: reflect the choice immediately, revert if the write fails.
    setProviders((current) => ({ ...current, [key]: next }));
    setSavingKey(key);
    setError(null);

    try {
      const response = await fetch('/api/admin/llm-providers', {
        method: 'PATCH',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ [key]: next }),
      });
      const json = (await response.json().catch(() => null)) as {
        providers?: Providers;
        error?: string;
      } | null;
      if (!response.ok) {
        throw new Error(json?.error ?? 'Could not save.');
      }
      if (json?.providers) setProviders(json.providers);
    } catch (caught) {
      setProviders((current) => ({ ...current, [key]: previous }));
      setError(caught instanceof Error ? caught.message : 'Could not save.');
    } finally {
      setSavingKey(null);
    }
  }

  return (
    <section className="mb-8">
      <h2 className="text-muted-foreground mb-1 text-sm font-semibold tracking-wide uppercase">
        LLM Provider (testing)
      </h2>
      <p className="text-muted-foreground mb-3 text-xs">
        Switches which model provider each surface uses. Global — affects everyone, not just you.
        Every surface defaults to Anthropic.
      </p>
      <div className="bg-card text-card-foreground rounded-xl border p-4">
        <div className="flex flex-col gap-4">
          {SURFACES.map(({ key, label }) => (
            <div key={key} className="flex flex-col gap-1">
              <div className="flex items-center justify-between gap-3">
                <label htmlFor={`llm-provider-${key}`} className="text-sm font-medium">
                  {label}
                </label>
                <select
                  id={`llm-provider-${key}`}
                  value={providers[key]}
                  onChange={(event) => void onChange(key, event.target.value as Provider)}
                  disabled={savingKey === key}
                  className="h-9 rounded-md border border-[var(--accent-gold)] bg-[var(--brand-field)] px-2 text-sm outline-none disabled:opacity-60"
                >
                  <option value="anthropic">Anthropic</option>
                  <option value="openai">OpenAI</option>
                </select>
              </div>
              {key === 'grade' ? (
                <p className="text-muted-foreground text-xs italic">
                  Caution: flipping grading affects answer-correctness and can produce false
                  wrong-answers. Recommended: don&apos;t flip grading and generation together during
                  a comparison.
                </p>
              ) : null}
            </div>
          ))}
        </div>
        {error ? <p className="text-destructive mt-3 text-sm">{error}</p> : null}
      </div>
    </section>
  );
}
