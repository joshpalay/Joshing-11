import { writeFileSync } from 'node:fs';
import path from 'node:path';

import type { ReviewResult } from './claude';
import { reportPath, runDir, type PlaytestManifest } from './manifest';
import type { ScenarioLog } from './scenario-context';

export function writeReport(params: {
  manifest: PlaytestManifest;
  logs: ScenarioLog[];
  review: ReviewResult;
}): string {
  const { manifest, logs, review } = params;
  const lines: string[] = [];
  const rd = runDir(manifest.runId);

  lines.push(`# Playtest report — ${manifest.runId}`);
  lines.push('');
  lines.push(`- **Run ID:** \`${manifest.runId}\``);
  lines.push(`- **Base URL:** ${manifest.baseUrl}`);
  lines.push(`- **Created:** ${manifest.createdAt}`);
  lines.push(`- **Scenarios run:** ${logs.length}`);
  lines.push(`- **Rows tracked:** ${manifest.rows.length}`);
  lines.push('');
  lines.push('## Cleanup');
  lines.push('');
  lines.push(
    `Run \`npm run smoke:gameplay -- --clean --run-id=${manifest.runId}\` to remove the test rows for this run.`,
  );
  lines.push('');
  lines.push(`Manifest: \`${path.relative(process.cwd(), path.join(rd, 'manifest.json'))}\``);
  lines.push('');

  lines.push('## Summary');
  lines.push('');
  lines.push('| Scenario | Status | Duration | Assertions (pass/fail) | Events |');
  lines.push('| --- | --- | ---: | --- | ---: |');
  for (const log of logs) {
    const passes = log.assertions.filter((a) => a.kind === 'assert_pass').length;
    const fails = log.assertions.filter((a) => a.kind === 'assert_fail').length;
    const statusIcon =
      log.status === 'pass' ? '✓ pass' : log.status === 'fail' ? '✗ fail' : '— skip';
    lines.push(
      `| \`${log.scenarioId}\` | ${statusIcon} | ${log.durationMs} ms | ${passes}/${fails} | ${log.events.length} |`,
    );
  }
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

  for (const log of logs) {
    lines.push(`## ${log.displayName} (\`${log.scenarioId}\`)`);
    lines.push('');
    lines.push(`Status: **${log.status}** — ${log.durationMs} ms`);
    if (log.errorMessage) {
      lines.push('');
      lines.push(`> Scenario threw: \`${log.errorMessage}\``);
    }
    lines.push('');

    if (log.assertions.length > 0) {
      lines.push('### Assertions');
      lines.push('');
      for (const a of log.assertions) {
        if (a.kind === 'assert_pass') {
          lines.push(`- ✓ ${a.label}`);
        } else {
          lines.push(`- ✗ **${a.label}** — ${a.message}`);
        }
      }
      lines.push('');
    }

    lines.push('### Timeline');
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
          lines.push(
            `- \`${event.at}\` screenshot (${event.note}): \`${path.relative(process.cwd(), event.file)}\``,
          );
          break;
        case 'finished':
          lines.push(`- \`${event.at}\` finished`);
          break;
        case 'error':
          lines.push(`- \`${event.at}\` ERROR: ${event.message}`);
          break;
      }
    }

    const shots = log.events.filter(
      (e): e is Extract<typeof e, { kind: 'screenshot' }> => e.kind === 'screenshot',
    );
    if (shots.length > 0) {
      lines.push('');
      lines.push('### Screenshots');
      lines.push('');
      for (const shot of shots) {
        const rel = path.relative(path.dirname(reportPath(manifest.runId)), shot.file);
        lines.push(`![${log.scenarioId} — ${shot.note}](${rel})`);
      }
    }
    lines.push('');
  }

  const out = reportPath(manifest.runId);
  writeFileSync(out, lines.join('\n'));
  return out;
}
