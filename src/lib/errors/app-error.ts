export const errorCodes = [
  "VALIDATION_ERROR",
  "UNSUPPORTED_DOCUMENT",
  "DOCUMENT_PROCESSING_ERROR",
  "AI_PROVIDER_ERROR",
  "AI_MISSING_API_KEY",
  "AI_AUTHENTICATION_ERROR",
  "AI_ACCESS_DENIED",
  "AI_MODEL_UNAVAILABLE",
  "AI_RATE_LIMIT",
  "AI_NETWORK_ERROR",
  "AI_TIMEOUT",
  "AI_EMPTY_RESPONSE",
  "AI_INVALID_OUTPUT",
  "AI_SERVICE_UNAVAILABLE",
  "CONFIGURATION_ERROR",
  "INTERNAL_ERROR",
] as const;
export type ErrorCode = (typeof errorCodes)[number];

const publicMessages: Record<ErrorCode, string> = {
  VALIDATION_ERROR: "The supplied data is invalid.",
  UNSUPPORTED_DOCUMENT: "This document format is unsupported.",
  DOCUMENT_PROCESSING_ERROR: "The document could not be processed.",
  AI_PROVIDER_ERROR: "The analysis service is unavailable.",
  AI_MISSING_API_KEY: "The AI service credential is not configured.",
  AI_AUTHENTICATION_ERROR: "The AI service credential was rejected.",
  AI_ACCESS_DENIED: "Access to the AI service was denied.",
  AI_MODEL_UNAVAILABLE: "The selected AI model is unavailable.",
  AI_RATE_LIMIT: "The AI service is busy. Try again later.",
  AI_NETWORK_ERROR: "The AI service could not be reached.",
  AI_TIMEOUT: "The AI request timed out.",
  AI_EMPTY_RESPONSE: "The AI service returned no text.",
  AI_INVALID_OUTPUT: "The AI response could not be validated.",
  AI_SERVICE_UNAVAILABLE: "The AI service is temporarily unavailable.",
  CONFIGURATION_ERROR: "The service is not configured for this operation.",
  INTERNAL_ERROR: "An unexpected error occurred.",
};

export class AppError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export function toPublicError(error: unknown): {
  code: ErrorCode;
  message: string;
} {
  const code = error instanceof AppError ? error.code : "INTERNAL_ERROR";
  return { code, message: publicMessages[code] };
}
