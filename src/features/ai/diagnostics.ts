import type { ErrorCode } from "@/lib/errors/app-error";
import { toPublicError } from "@/lib/errors/app-error";
import type { Usage } from "./contracts";
import { AIError, mapGoogleError } from "./errors";

/** Mutable transport facts, never headers, URLs, credentials, or content. */
export type TransportObservation = {
  httpStatus: number | null;
  abortObserved: boolean | null;
};
export type RequestDiagnostic = {
  operation: "text" | "image" | "structured" | "json-mode-probe";
  model: string;
  attempt: number;
  dispatched: boolean;
  durationMs: number;
  timeoutMs: number;
  sdkMaxAttempts: 1;
  promptChars: number;
  systemChars: number;
  maxOutputTokens: number;
  responseMode: "text" | "prompt-json" | "json-mime-probe";
  httpStatus: number | null;
  errorCategory: ErrorCode | null;
  applicationAbortRequested: boolean;
  timeoutSource: "application-deadline" | "sdk-or-transport" | null;
  transportAbortObserved: boolean | null;
  usage: Usage | null;
};
export function safeHTTPStatus(status: unknown): number | null {
  return typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
    ? status
    : null;
}
export function sanitizeAIError(error: unknown) {
  const mapped = mapGoogleError(error);
  return {
    ...toPublicError(mapped),
    ...(mapped instanceof AIError
      ? {
          status: safeHTTPStatus(mapped.status),
          attempts: mapped.attempts,
          retryAfterMs: mapped.retryAfterMs,
        }
      : {}),
  };
}
export function summarizeDiagnostics(
  experimentId: string,
  model: string,
  timeoutMs: number,
  durationMs: number,
  requests: RequestDiagnostic[],
  errorCategory: ErrorCode | null = null,
) {
  return {
    experimentId,
    model,
    durationMs: Math.max(0, Math.round(durationMs)),
    timeoutMs,
    attempts: requests.filter((request) => request.dispatched).length,
    httpStatus: requests.at(-1)?.httpStatus ?? null,
    errorCategory,
    timeoutSource: requests.at(-1)?.timeoutSource ?? null,
    requestDurationMs: requests.at(-1)?.durationMs ?? null,
    applicationAbortRequested: requests.some(
      (request) => request.applicationAbortRequested,
    ),
    // null means no transport observation was available, not that abort was absent.
    transportAbortObserved: requests.some(
      (request) => request.transportAbortObserved === true,
    )
      ? true
      : requests.some((request) => request.transportAbortObserved === false)
        ? false
        : null,
    usage: requests.at(-1)?.usage ?? null,
    requests,
  };
}

/** Defense in depth for the explicit synthetic CLI, including the stored backup. */
export function redactAISecrets(
  value: unknown,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  let serialized = JSON.stringify(value, null, 2);
  for (const name of ["GEMINI_API_KEY", "GEMINI_API_KEY_BACKUP"]) {
    const secret = env[name]?.trim();
    if (!secret) continue;
    for (const representation of [secret, JSON.stringify(secret).slice(1, -1)])
      serialized = serialized.split(representation).join("[REDACTED]");
  }
  return serialized;
}
