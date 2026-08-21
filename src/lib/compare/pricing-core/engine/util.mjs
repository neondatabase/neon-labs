// Recursively freeze an object graph so process-global constants (rate tables,
// glossaries) can't be mutated by a consumer — important for a long-lived server
// where a single stray write would corrupt pricing for every later request.
export function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const nested of Object.values(value)) deepFreeze(nested);
    Object.freeze(value);
  }
  return value;
}
