import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const near = (actual, expected) => Math.abs(actual - expected) < 1e-9;

export function normalizeExact(value) {
  return value.normalize('NFC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase('en-US');
}

export function historyKey(question, answer) {
  return `${normalizeExact(question)}\u0000${normalizeExact(answer)}`;
}

export function precheck(card, boundId, historyKeys) {
  if (!card || typeof card !== 'object' || Array.isArray(card)) return 'required-card';
  if (card.schemaVersion !== 3 || card.id !== boundId) return 'required-schema-or-id';
  if (
    ['question', 'answer', 'explanation'].some(
      (field) => typeof card[field] !== 'string' || !card[field].trim(),
    )
  )
    return 'required-text';
  if (
    !Array.isArray(card.variants) ||
    card.variants.some((variant) => typeof variant !== 'string' || !variant.trim())
  )
    return 'required-variants';
  if (historyKeys.has(historyKey(card.question, card.answer))) return 'exact-history-repeat';
  return null;
}

export function replay(privateRoot) {
  const prep = path.join(privateRoot, 'cassian-fresh-2026-10-12', 'private');
  const run = path.join(privateRoot, 'cassian-fresh-v3-2026-10-12-final');
  const checkpoint = read(path.join(run, 'checkpoint.json'));
  const selection = read(path.join(prep, 'SELECTION.json'));
  const history = read(path.join(prep, 'NOVELTY-CANDIDATES-v2.json'));
  const accounting = read(
    path.join(
      privateRoot,
      'cassian-fresh-v3-2026-10-12',
      'private',
      'COMPLETE-CREATION-ACCOUNTING.json',
    ),
  );
  const historyKeys = new Set();
  for (const row of history) {
    for (const field of ['bank', 'seen']) {
      for (const item of row[field] ?? []) {
        if (typeof item.question === 'string' && typeof item.answer === 'string') {
          historyKeys.add(historyKey(item.question, item.answer));
        }
      }
    }
  }

  const breadth = {
    broad: { requests: 0, outputs: 0, stopped: 0, grossAvoidableUsd: 0 },
    niche: { requests: 0, outputs: 0, stopped: 0, grossAvoidableUsd: 0 },
    'very narrow': { requests: 0, outputs: 0, stopped: 0, grossAvoidableUsd: 0 },
  };
  for (const request of selection.selected) breadth[request.breadth].requests++;
  const seenSlots = new Set();
  let sourceReviewUsd = 0;
  let grossAvoidableUsd = 0;
  let sourceReviewCalls = 0;
  let avoidedCalls = 0;
  const reasons = {};
  for (let slot = 1; slot <= selection.selected.length; slot++) {
    const group = breadth[selection.selected[slot - 1].breadth];
    for (let attempt = 0; attempt <= 1; attempt++) {
      const writerKey = `writer-request-${String(slot).padStart(2, '0')}-soft-${attempt}`;
      const writer = checkpoint.progress.calls[writerKey];
      if (!writer) continue;
      const parsed = JSON.parse(writer.raw);
      if (parsed.status !== 'candidate')
        throw new Error(`Unexpected writer status in ${writerKey}`);
      const boundId = read(path.join(run, 'requests', `${writerKey}.json`)).bindings[0];
      const receipt = read(path.join(run, 'receipts', `factual-${parsed.card.id}-${attempt}.json`));
      const reason = precheck(parsed.card, boundId, historyKeys);
      seenSlots.add(slot);
      sourceReviewCalls++;
      sourceReviewUsd += receipt.usd;
      group.outputs++;
      if (reason) {
        avoidedCalls++;
        grossAvoidableUsd += receipt.usd;
        group.stopped++;
        group.grossAvoidableUsd += receipt.usd;
        reasons[reason] = (reasons[reason] ?? 0) + 1;
      }
    }
  }
  const receiptsDir = path.join(run, 'receipts');
  const receiptFiles = fs.readdirSync(receiptsDir).filter((name) => name.endsWith('.json'));
  const experimentReceiptUsd = receiptFiles.reduce(
    (sum, name) => sum + read(path.join(receiptsDir, name)).usd,
    0,
  );
  const stage = (arm, name) =>
    accounting.events
      .filter((event) => event.arm === arm && event.stage === name)
      .reduce((sum, event) => sum + (event.providerUsd ?? 0), 0);
  const softStages = {
    writing: stage('soft', 'writing'),
    repair: stage('soft', 'repair'),
    sourceReview: stage('soft', 'source-review'),
    quality: stage('soft', 'quality'),
  };
  const softTotalUsd = Object.values(softStages).reduce((sum, value) => sum + value, 0);
  const strictTotalUsd = stage('strict', 'writing') + stage('strict', 'repair');
  const controlsUsd = stage('control', 'source-review') + stage('control', 'quality');
  if (selection.selected.length !== 23 || seenSlots.size !== 22 || sourceReviewCalls !== 24)
    throw new Error('Saved cohort shape changed');
  if (!near(sourceReviewUsd, 0.488242) || !near(sourceReviewUsd, softStages.sourceReview))
    throw new Error('Source receipt sum changed');
  if (
    !near(softTotalUsd, 0.5410001) ||
    !near(strictTotalUsd, 0.0334814) ||
    !near(controlsUsd, 0.389508)
  )
    throw new Error('Operational allocation changed');
  if (
    receiptFiles.length !== 101 ||
    !near(experimentReceiptUsd, 0.9639895) ||
    !near(softTotalUsd + strictTotalUsd + controlsUsd, experimentReceiptUsd)
  )
    throw new Error('Experiment receipts changed');
  return {
    originalRequests: selection.selected.length,
    preparationShortages: selection.selected.length - seenSlots.size,
    initialCards: seenSlots.size,
    replacementOutputs: sourceReviewCalls - seenSlots.size,
    sourceReviewCalls,
    sourceReviewUsd: Number(sourceReviewUsd.toFixed(7)),
    avoidedCalls,
    grossAvoidableUsd: Number(grossAvoidableUsd.toFixed(7)),
    stoppedReasons: reasons,
    breadth,
    baseline: {
      softTotalUsd: Number(softTotalUsd.toFixed(7)),
      softStages,
      strictTotalUsd: Number(strictTotalUsd.toFixed(7)),
      controlsUsd: Number(controlsUsd.toFixed(7)),
      experimentReceiptCalls: receiptFiles.length,
      experimentReceiptUsd: Number(experimentReceiptUsd.toFixed(7)),
    },
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2])
    throw new Error(
      'Usage: node scripts/cassian-precheck-replay.mjs <ignored-private-Cassian-root>',
    );
  console.log(JSON.stringify(replay(path.resolve(process.argv[2])), null, 2));
}
