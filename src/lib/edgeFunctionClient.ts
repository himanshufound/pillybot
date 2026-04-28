type StructuredFunctionError = {
  error?: {
    code?: string;
    message?: string;
  };
};

export function getFunctionErrorMessage(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== "object") {
    return fallback;
  }

  const candidate = payload as StructuredFunctionError;
  const message = candidate.error?.message;
  return typeof message === "string" && message.trim().length > 0 ? message : fallback;
}

export function isLowConfidenceParseResult(result: { confidence?: number | null }, threshold = 0.6) {
  return typeof result.confidence === "number" && result.confidence < threshold;
}

export function isLowConfidenceVerificationResult(
  result: { confidence?: number | null },
  threshold = 0.75,
) {
  return typeof result.confidence === "number" && result.confidence < threshold;
}
