const sensitiveAuditMetadataKey = /(password|hash|token|secret|session|credential)/i;

export function redactAuditMetadata(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAuditMetadata);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
    key,
    sensitiveAuditMetadataKey.test(key) ? "[REDACTED]" : redactAuditMetadata(entry),
  ]));
}

export function serializeSafeAuditMetadata(
  metadata: Record<string, unknown> | string | null | undefined,
) {
  if (!metadata) return null;
  if (typeof metadata !== "string") return JSON.stringify(redactAuditMetadata(metadata));
  try {
    return JSON.stringify(redactAuditMetadata(JSON.parse(metadata)));
  } catch {
    return sensitiveAuditMetadataKey.test(metadata) ? "[REDACTED]" : metadata;
  }
}

export function redactStoredAuditMetadata(metadata: string | null) {
  return serializeSafeAuditMetadata(metadata);
}
