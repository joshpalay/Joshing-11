import { writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ReviewResult } from './claude';
import type { PlaytestManifest } from './manifest';
import type { PlayerLog } from './player';
import { reportPath, runDir } from './manifest';

export function writeReport(params: {
  manifest: PlaytestManifest;
  logs: PlayerLog[];
  review: ReviewResult;
}): string {
  const { manifest, logs, review } = params;
  const lines: string[] = [];
  const rd = runDir(manifest.runId);

  lines.push(`# Playtest report — ${manifest.runId}`);
  lines.push('');
  lines.push(`- **Game ID:** \`${manifest.gameId}\``);
  lines.push(`- **Inviter:** ${manifest.inviter.displayName} (\`${manifest.inviter.id}\`)`);
  lines.push(`- **Players:** ${manifest.players.length}`);
  lines.push(`- **Questions:** ${manifest.questionIds.length}`);
  lines.push(`- **Base URL:** ${manifest.baseUrl}`);
  lines.push(`- **Created:** ${manifest.createdAt}`);
  lines.push('');
  lines.push('## Cleanup');
  lines.push('');
  lines.push(`Run \`npm run smoke:gameplay -- --clean --run-id=${manifest.runId}\` to remove the test rows for this run.`);
  lines.push('');
  lines.push(`Manifest: \`${path.relative(process.cwd(), path.join(rd, 'manifest.json'))}\``);
  lines.push('');

  lines.push('## LLM review');
  lines.push('');
  lines.push(`**Summary:** ${review.summary || '_(no summary)_'}`);
  lines.push('');
  if (review.bugs.length > 0) {
    lines.push('### Bugs');
    lines.push('');
    for (const item of review.bugs) lines.push(`- ${item}`);
    lines.push('');
  }
  if (review.uxNotes.length > 0) {
    lines.push('### UX notes');
    lines.push('');
    for (const item of review.uxNotes) lines.push(`- ${item}`);
    lines.push('');
  }
  if (review.observations.length > 0) {
    lines.push('### Observations');
    lines.push('');
    for (const item of review.observations) lines.push(`- ${item}`);
    lines.push('');
  }

  lines.push('## Per-player timelines');
  for (const log of logs) {
    lines.push('');
    lines.push(`### ${log.displayName} (\`${log.playerId}\`)`);
    lines.push('');
    for (const event of log.events) {
      switch (event.kind) {
        case 'navigated':
          lines.push(`- \`${event.at}\` navigated → ${event.url}`);
          break;
        case 'question_seen':
          lines.push(`- \`${event.at}\` Q${event.index}: ${event.text}`);
          break;
        case 'answer_submitted':
          lines.push(`- \`${event.at}\` submitted (${event.intent}): "${event.text}"`);
          break;
        case 'result_observed':
          lines.push(`- \`${event.at}\` result: ${event.correct ? '✓ correct' : '✗ wrong'}`);
          break;
        case 'console':
          lines.push(`- \`${event.at}\` console.${event.level}: ${event.text}`);
          break;
        case 'network_error':
          lines.push(`- \`${event.at}\` NETWORK ${event.status ?? 'failed'} ${event.url}`);
          break;
        case 'screenshot':
          lines.push(`- \`${event.at}\` screenshot (${event.note}): \`${path.relative(process.cwd(), event.file)}\``);
          break;
        case 'finished':
          lines.push(`- \`${event.at}\` finished`);
          break;
        case 'error':
          lines.push(`- \`${event.at}\` ERROR: ${event.message}`);
          break;
      }
    }
  }

  lines.push('');
  lines.push('## Screenshots');
  lines.push('');
  const allShots = logs.flatMap((log) =>
    log.events
      .filter((e): e is Extract<PlayerLog['events'][number], { kind: 'screenshot' }> => e.kind === 'screenshot')
      .map((e) => ({ player: log.displayName, file: e.file, note: e.note })),
  );
  for (const shot of allShots) {
    const rel = path.relative(path.dirname(reportPath(manifest.runId)), shot.file);
    lines.push(`![${shot.player} — ${shot.note}](${rel})`);
  }

  const out = reportPath(manifest.runId);
  writeFileSync(out, lines.join('\n'));
  return out;
}
