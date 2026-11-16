export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function numberValue(value: unknown): number | undefined {
  if (typeof value !== "number" && (typeof value !== "string" || value.trim() === "")) {
    return undefined;
  }
  const candidate = typeof value === "number" ? value : Number(value);
  return Number.isFinite(candidate) ? candidate : undefined;
}

export function positiveInteger(value: unknown): number | undefined {
  const candidate = numberValue(value);
  return candidate !== undefined && Number.isInteger(candidate) && candidate > 0
    ? candidate
    : undefined;
}

export function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
