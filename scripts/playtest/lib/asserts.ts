import type { AssertionResult } from './scenario-context';

function now(): string {
  return new Date().toISOString();
}

export class AssertionRecorder {
  readonly results: AssertionResult[] = [];

  pass(label: string): void {
    this.results.push({ kind: 'assert_pass', label, at: now() });
  }

  fail(label: string, message: string): void {
    this.results.push({ kind: 'assert_fail', label, message, at: now() });
  }

  check(label: string, condition: boolean, message: string): void {
    if (condition) this.pass(label);
    else this.fail(label, message);
  }

  expectEqual<T>(label: string, actual: T, expected: T): void {
    if (Object.is(actual, expected)) {
      this.pass(label);
    } else {
      this.fail(label, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  }

  expectTruthy(label: string, value: unknown): void {
    if (value) this.pass(label);
    else this.fail(label, `expected truthy, got ${JSON.stringify(value)}`);
  }

  hasFailures(): boolean {
    return this.results.some((r) => r.kind === 'assert_fail');
  }
}
