// Exhaustiveness guard. Call in the `default` branch of a switch (or the final
// `else`) over a finite union: TypeScript only allows the call when every member
// has already been handled, so adding a new union member becomes a compile error
// until every consumer handles it. At runtime it throws, so an unexpected value
// fails loudly instead of silently falling through.
export function assertNever(value: never, context = 'value'): never {
  throw new Error(`Unhandled ${context}: ${JSON.stringify(value)}`);
}
