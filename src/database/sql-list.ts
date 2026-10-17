// Renders a constant list of values for a CHECK (... IN (...)) rule, so the
// TypeScript union type and the database rule come from one array. Only for
// constants written in code, never for input.
export function sqlList(values: readonly string[]): string {
  return values.map((value) => `'${value}'`).join(', ');
}
