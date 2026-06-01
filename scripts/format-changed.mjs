#!/usr/bin/env node
/**
 * Formats only the files you've actually changed (or files passed as args),
 * never the whole tree.
 *
 * Why: this repo's source predates the Prettier config and was never normalized
 * to it, so `prettier --write .` rewrites hundreds of unrelated files (and used
 * to fight the committed style). Scoping to changed files keeps `npm run format`
 * useful for the diff you're working on without that churn. Use `npm run
 * format:all` if you ever deliberately want to reformat everything.
 *
 * Prettier still honors .prettierignore, so ignored paths are skipped even if
 * they show up as changed.
 */
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const PRETTIER_EXTENSIONS = new Set([
  'ts',
  'tsx',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'json',
  'css',
  'scss',
  'html',
  'yaml',
  'yml',
]);

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8' })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function changedFiles() {
  // Working-tree changes vs HEAD (staged + unstaged), excluding deletions, plus
  // untracked files that aren't gitignored.
  const tracked = git(['diff', '--name-only', '--diff-filter=ACMR', 'HEAD']);
  const untracked = git(['ls-files', '--others', '--exclude-standard']);
  return [...new Set([...tracked, ...untracked])];
}

function hasPrettierExtension(file) {
  const ext = file.split('.').pop()?.toLowerCase();
  return ext ? PRETTIER_EXTENSIONS.has(ext) : false;
}

const explicit = process.argv.slice(2);
const candidates = (explicit.length > 0 ? explicit : changedFiles())
  .filter(hasPrettierExtension)
  .filter((file) => existsSync(file));

if (candidates.length === 0) {
  console.log('format: no changed files to format.');
  process.exit(0);
}

console.log(`format: writing ${candidates.length} file(s)…`);
execFileSync('prettier', ['--write', ...candidates], { stdio: 'inherit' });
