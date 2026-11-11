/** Fails to compile when a switch over a union misses a case. */
export function unreachable(value: never): never {
  throw new Error(`Unhandled case: ${JSON.stringify(value)}`);
}
