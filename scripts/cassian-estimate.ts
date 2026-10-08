/**
 * Read-only Cassian pilot estimate. No database or model calls.
 * Run: npx tsx scripts/cassian-estimate.ts --topics 6 --reuse-sources
 * The observed token averages are frozen in Cassian/BASELINE.md. Refresh them
 * deliberately before paid dispatch; they are estimates, not a billing limit.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { estimateCostUsd, type UsageTokens } from '../src/server/llm/pricing';
import { FACTUAL_GATE_MODEL, QUALITY_GATE_MODEL, SOURCE_MODEL } from './cassian-models';

type Topic = { domain: string; breadth: 'broad' | 'niche' | 'very narrow'; difficulty: string };
type Manifest = {
  schemaVersion: number;
  id: string;
  requestedPerTopicPerArm: number;
  arms: { id: string; model: string }[];
  topics: Topic[];
};

const manifest = JSON.parse(readFileSync(resolve(process.env.CASSIAN_MANIFEST_FILE || 'Cassian/manifest.json'), 'utf8')) as Manifest;
const argIndex = process.argv.indexOf('--topics');
const selectedTopics = argIndex < 0 ? 12 : Number(process.argv[argIndex + 1]);
const reuseSources = process.argv.includes('--reuse-sources');
if (![3, 6, 9, 12].includes(selectedTopics)) throw new Error('--topics must be 3, 6, 9, or 12 (balanced blocks).');
const counts = new Map<string, number>();
for (const topic of manifest.topics) counts.set(topic.breadth, (counts.get(topic.breadth) ?? 0) + 1);
if (
  manifest.schemaVersion !== 1 ||
  manifest.topics.length !== 12 ||
  manifest.requestedPerTopicPerArm !== 1 ||
  manifest.arms.length !== 2 ||
  new Set(manifest.topics.map((topic) => topic.domain.toLowerCase())).size !== 12 ||
  ['broad', 'niche', 'very narrow'].some((breadth) => counts.get(breadth) !== 4)
) {
  throw new Error('Cassian manifest must have two arms and 4 distinct topics per breadth.');
}

const baseline = manifest.arms.find((arm) => arm.id === 'baseline')?.model;
const candidate = manifest.arms.find((arm) => arm.id === 'candidate')?.model;
if (!baseline || !candidate || baseline === candidate) throw new Error('Invalid model arms.');

function priced(model: string, usage: UsageTokens): number {
  const estimate = estimateCostUsd(model, usage);
  if (estimate.usd === null) throw new Error(`Unpriced model ${model}; refusing a false $0 estimate.`);
  return estimate.usd;
}

// Read-only 14-day LlmUsageEvent aggregates on 2026-10-03. See BASELINE.md.
const sourceUsage = {
  inputTokens: 46_521, outputTokens: 898, cacheReadTokens: 0,
  cacheCreateTokens: 0, webSearchRequests: 3,
};
const baselineGeneration = {
  inputTokens: 6_106, outputTokens: 748, cacheReadTokens: 8_994,
  cacheCreateTokens: 4_726,
};
// Same prompt length, with no assumed Haiku cache benefit. This is an estimate
// until its actual usage is observed; output is provisionally held equal.
const candidateTokenizerFactor = candidate === 'claude-haiku-5-5' ? 1.3 : 1;
const candidateGeneration = {
  inputTokens: Math.ceil((baselineGeneration.inputTokens + baselineGeneration.cacheReadTokens + baselineGeneration.cacheCreateTokens) * candidateTokenizerFactor),
  outputTokens: Math.ceil(baselineGeneration.outputTokens * candidateTokenizerFactor),
  cacheReadTokens: 0, cacheCreateTokens: 0,
};
const qualityUsage = {
  inputTokens: 4_911, outputTokens: 174, cacheReadTokens: 0, cacheCreateTokens: 0,
};
const factualUsage = {
  inputTokens: 2_150, outputTokens: 281, cacheReadTokens: 0, cacheCreateTokens: 0,
};

const totalTopics = selectedTopics;
const questionsPerArm = totalTopics * manifest.requestedPerTopicPerArm;
const source = reuseSources ? 0 : priced(SOURCE_MODEL, sourceUsage) * totalTopics;
const writerA = priced(baseline, baselineGeneration) * questionsPerArm;
const writerB = priced(candidate, candidateGeneration) * questionsPerArm;
const gates = (
  priced(QUALITY_GATE_MODEL, qualityUsage) + priced(FACTUAL_GATE_MODEL, factualUsage)
) * questionsPerArm * 2;
const observedShape = source + writerA + writerB + gates;
const firstSubcap = 4;
const totalCap = 10;

console.log(JSON.stringify({
  manifestId: manifest.id,
  gateModels: { quality: QUALITY_GATE_MODEL, factual: FACTUAL_GATE_MODEL },
  topics: totalTopics,
  sourceMode: reuseSources ? 'saved reference packets; zero new retrieval calls' : 'new retrieval',
  requestedQuestions: questionsPerArm * 2,
  priceSource: 'repository pricing catalog; independently confirm provider bill before paid dispatch',
  usageSource: '14-day LlmUsageEvent averages frozen 2026-10-03',
  estimatedUsd: {
    sourceRetrieval: +source.toFixed(3), writerBaseline: +writerA.toFixed(3),
    writerCandidate: +writerB.toFixed(3), gates: +gates.toFixed(3),
    observedShapeTotal: +observedShape.toFixed(3),
    with20PercentMargin: +(observedShape * 1.2).toFixed(3),
  },
  capsUsd: { recommendedFirstRun: firstSubcap, authorizedLifetime: totalCap },
  finding: observedShape * 1.2 > firstSubcap
    ? 'Full 12-topic pilot has inadequate headroom under $4. Start with balanced paired blocks and account actual spend before expanding.'
    : 'Estimate fits the first-run subcap, pending a durable dispatch guard and current prices.',
  excludedCosts: ['answer grading', 'retries', 'timeouts with unknown charges', 'history embedding/dedup', 'off-domain second opinion', 'admin deployment'],
  paidDispatchEnabled: false,
}, null, 2));
