import { ApiError } from "@google/genai";
import {
  AppError,
  toPublicError,
  type ErrorCode,
} from "@/lib/errors/app-error";

type Details = {
  retryable?: boolean;
  retryAfterMs?: number;
  status?: number;
  outputFailure?: "json" | "schema";
  attempts?: number;
};
export class AIError extends AppError {
  readonly retryable: boolean;
  readonly retryAfterMs?: number;
  readonly status?: number;
  readonly outputFailure?: "json" | "schema";
  readonly attempts: number;
  constructor(code: ErrorCode, details: Details = {}) {
    super(code, toPublicError(new AppError(code, "")).message);
    this.name = "AIError";
    this.retryable = details.retryable ?? false;
    this.retryAfterMs = details.retryAfterMs;
    this.status = details.status;
    this.outputFailure = details.outputFailure;
    this.attempts = details.attempts ?? 1;
  }
}

/** SDK ApiError exposes status and a JSON-encoded error message, not headers. */
export function mapGoogleError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof ApiError) {
    let reason: unknown;
    let retryAfterMs: number | undefined;
    try {
      const body = JSON.parse(error.message);
      const details: unknown = body?.error?.details;
      if (Array.isArray(details))
        for (const detail of details) {
          if (detail?.["@type"] === "type.googleapis.com/google.rpc.ErrorInfo")
            reason = detail.reason;
          if (
            detail?.["@type"] === "type.googleapis.com/google.rpc.RetryInfo" &&
            typeof detail.retryDelay === "string"
          ) {
            const match = /^(\d+(?:\.\d+)?)s$/.exec(detail.retryDelay);
            if (match) {
              const ms = Number(match[1]) * 1000;
              if (Number.isFinite(ms)) retryAfterMs = ms;
            }
          }
        }
    } catch {
      /* Never expose arbitrary SDK messages. */
    }
    const status = error.status;
    const common = { status, retryAfterMs };
    if (
      status === 401 ||
      reason === "API_KEY_INVALID" ||
      reason === "API_KEY_EXPIRED"
    )
      return new AIError("AI_AUTHENTICATION_ERROR", common);
    if (status === 403) return new AIError("AI_ACCESS_DENIED", common);
    if (status === 404) return new AIError("AI_MODEL_UNAVAILABLE", common);
    if (status === 429)
      return new AIError("AI_RATE_LIMIT", { ...common, retryable: true });
    if ([500, 502, 503, 504].includes(status))
      return new AIError("AI_SERVICE_UNAVAILABLE", {
        ...common,
        retryable: true,
      });
    if (status === 400 || status === 422)
      return new AIError("VALIDATION_ERROR", common);
    return new AIError("AI_PROVIDER_ERROR", common);
  }
  // Fetch network failures use TypeError; do not retry uncertain transport failures.
  if (error instanceof TypeError) return new AIError("AI_NETWORK_ERROR");
  if (
    error instanceof Error &&
    ["TimeoutError", "AbortError"].includes(error.name)
  )
    return new AIError("AI_TIMEOUT");
  return new AIError("AI_PROVIDER_ERROR");
}
