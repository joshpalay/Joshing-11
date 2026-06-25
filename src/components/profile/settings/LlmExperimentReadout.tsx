/**
 * Owner-only readout for the LLM provider A/B experiment
 * (B-LLM-PROVIDER-AB-METRICS — the read side of Parts 1–3).
 *
 * Split into an async loader (loadLlmExperimentData) and a SYNC presentational
 * component (LlmExperimentReadout). The page — already an async server component
 * the caller awaits — runs the loader and passes plain data in; keeping the
 * rendered component synchronous means renderToStaticMarkup (and the page test)
 * can render it without RSC async support.
 *
 * Renders three quiet, system-voice tables — grading/generation quality,
 * estimated cost, and the recent flip log. Shown only for the owner (the page
 * gates it on ADMIN_USER_IDS, exactly like LlmProviderPanel), so it attempts no
 * auth of its own. The loader wraps reads in Promise.allSettled so a missing
 * table or a transient DB error degrades to a soft note instead of crashing the
 * settings page.
 */
import {
  readGradingQualityByProvider,
  readGenerationByProvider,
  readUsageCostByProvider,
  readRecentProviderChanges,
  type GradingQualityByProvider,
  type GenerationByProvider,
  type ProviderModelCost,
  type ProviderChangeRow,
} from '@/server/db/queries/llm-provider-experiment';
import type { LlmProvider } from '@/server/llm/provider';

const WINDOW_DAYS = 14;

function providerLabel(p: LlmProvider): string {
  return p === 'openai' ? 'OpenAI' : 'Anthropic';
}

function pct(x: number | null): string {
  return x == null ? '—' : `${(x * 100).toFixed(1)}%`;
}

function usd(x: number | null): string {
  if (x == null) return '—';
  return `$${x.toFixed(x < 1 ? 4 : 2)}`;
}

function num(x: number): string {
  return x.toLocaleString('en-US');
}

const SURFACE_LABELS: Record<string, string> = {
  gen: 'Generation',
  categorize: 'Categorization',
  suggest: 'Answer suggestion',
  grade: 'Grading',
};

export type LlmExperimentData = {
  grading: GradingQualityByProvider[] | null;
  generation: GenerationByProvider[] | null;
  cost: ProviderModelCost[] | null;
  flips: ProviderChangeRow[] | null;
};

/**
 * Run all four metric queries concurrently, tolerating individual failures (a
 * missing table, a transient DB error) — each failed read becomes null, which
 * the component renders as a soft note. Call from the (async) page; pass the
 * result to the sync component below.
 */
export async function loadLlmExperimentData(): Promise<LlmExperimentData> {
  const [gradingR, generationR, costR, flipsR] = await Promise.allSettled([
    readGradingQualityByProvider(WINDOW_DAYS),
    readGenerationByProvider(),
    readUsageCostByProvider(WINDOW_DAYS),
    readRecentProviderChanges(10),
  ]);
  return {
    grading: gradingR.status === 'fulfilled' ? gradingR.value : null,
    generation: generationR.status === 'fulfilled' ? generationR.value : null,
    cost: costR.status === 'fulfilled' ? costR.value : null,
    flips: flipsR.status === 'fulfilled' ? flipsR.value : null,
  };
}

export function LlmExperimentReadout({ data }: { data: LlmExperimentData }) {
  const { grading, generation, cost, flips } = data;

  const totalCost = cost?.reduce((acc, r) => (r.cost.usd != null ? acc + r.cost.usd : acc), 0) ?? 0;
  const anyUnpriced = cost?.some((r) => r.cost.unpriced) ?? false;

  return (
    <section className="mb-8">
      <h2 className="text-muted-foreground mb-1 text-sm font-semibold tracking-wide uppercase">
        LLM Experiment — Readout
      </h2>
      <p className="text-muted-foreground mb-3 text-xs">
        Quality, cost, and flip history for the provider A/B switch. Quality and cost cover the last{' '}
        {WINDOW_DAYS} days. Only output produced after this shipped is stamped, so early windows look
        sparse.
      </p>

      <div className="bg-card text-card-foreground flex flex-col gap-6 rounded-xl border p-4">
        {/* ── Grading quality (north-star) ── */}
        <div>
          <h3 className="mb-2 text-sm font-semibold">Grading — wrong-answer rate by grader</h3>
          {grading == null ? (
            <p className="text-destructive text-xs">Couldn&apos;t read grading metrics.</p>
          ) : grading.length === 0 ? (
            <p className="text-muted-foreground text-xs">No LLM-graded answers in the window.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-left text-xs">
                  <th className="py-1 font-medium">Grader</th>
                  <th className="py-1 text-right font-medium">Graded</th>
                  <th className="py-1 text-right font-medium">Wrong</th>
                  <th className="py-1 text-right font-medium">Wrong rate</th>
                </tr>
              </thead>
              <tbody>
                {grading.map((r) => (
                  <tr key={r.provider} className="border-t">
                    <td className="py-1">{providerLabel(r.provider)}</td>
                    <td className="py-1 text-right tabular-nums">{num(r.graded)}</td>
                    <td className="py-1 text-right tabular-nums">{num(r.wrong)}</td>
                    <td className="py-1 text-right tabular-nums">{pct(r.wrongRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Generation quality ── */}
        <div>
          <h3 className="mb-2 text-sm font-semibold">Generation — questions by author provider</h3>
          {generation == null ? (
            <p className="text-destructive text-xs">Couldn&apos;t read generation metrics.</p>
          ) : generation.length === 0 ? (
            <p className="text-muted-foreground text-xs">No provider-stamped generated questions yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-muted-foreground text-left text-xs">
                  <th className="py-1 font-medium">Provider</th>
                  <th className="py-1 text-right font-medium">Questions</th>
                  <th className="py-1 text-right font-medium">Avg correct rate</th>
                </tr>
              </thead>
              <tbody>
                {generation.map((r) => (
                  <tr key={r.provider} className="border-t">
                    <td className="py-1">{providerLabel(r.provider)}</td>
                    <td className="py-1 text-right tabular-nums">{num(r.questions)}</td>
                    <td className="py-1 text-right tabular-nums">{pct(r.avgEmpiricalCorrectRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* ── Cost ── */}
        <div>
          <h3 className="mb-2 text-sm font-semibold">
            Estimated cost — {usd(totalCost)} total
          </h3>
          {cost == null ? (
            <p className="text-destructive text-xs">Couldn&apos;t read usage metrics.</p>
          ) : cost.length === 0 ? (
            <p className="text-muted-foreground text-xs">No recorded LLM calls in the window.</p>
          ) : (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-muted-foreground text-left text-xs">
                    <th className="py-1 font-medium">Provider / model</th>
                    <th className="py-1 text-right font-medium">Calls</th>
                    <th className="py-1 text-right font-medium">In tok</th>
                    <th className="py-1 text-right font-medium">Out tok</th>
                    <th className="py-1 text-right font-medium">Est. USD</th>
                  </tr>
                </thead>
                <tbody>
                  {cost.map((r) => (
                    <tr key={`${r.provider}:${r.model}`} className="border-t">
                      <td className="py-1">
                        {providerLabel(r.provider)} · <span className="text-muted-foreground">{r.model}</span>
                      </td>
                      <td className="py-1 text-right tabular-nums">{num(r.calls)}</td>
                      <td className="py-1 text-right tabular-nums">{num(r.inputTokens)}</td>
                      <td className="py-1 text-right tabular-nums">{num(r.outputTokens)}</td>
                      <td className="py-1 text-right tabular-nums">
                        {r.cost.unpriced ? '— *' : usd(r.cost.usd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {anyUnpriced ? (
                <p className="text-muted-foreground mt-2 text-xs italic">
                  * model has no entry in the price map — tokens known, dollar cost unknown.
                </p>
              ) : null}
            </>
          )}
        </div>

        {/* ── Flip log ── */}
        <div>
          <h3 className="mb-2 text-sm font-semibold">Recent provider flips</h3>
          {flips == null ? (
            <p className="text-destructive text-xs">Couldn&apos;t read the flip log.</p>
          ) : flips.length === 0 ? (
            <p className="text-muted-foreground text-xs">No provider flips recorded yet.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm">
              {flips.map((r, i) => (
                <li key={`${r.createdAt.toISOString()}-${r.surface}-${i}`} className="flex items-baseline justify-between gap-3">
                  <span>
                    {SURFACE_LABELS[r.surface] ?? r.surface}:{' '}
                    <span className="text-muted-foreground">{providerLabel(r.fromProvider)}</span> →{' '}
                    {providerLabel(r.toProvider)}
                  </span>
                  <span className="text-muted-foreground shrink-0 text-xs tabular-nums">
                    {r.createdAt.toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}
