import "server-only";
import { GoogleGenAI } from "@google/genai";
import { AIError, mapGoogleError } from "./errors";
import { safeHTTPStatus } from "./diagnostics";
import type { GemmaConfig, Generate } from "./google-gemma";

export function retryDelayHeader(
  value: string | null,
  now = Date.now(),
): number | undefined {
  if (!value?.trim()) return undefined;
  const text = value.trim();
  const milliseconds = /^\d+(?:\.\d+)?$/.test(text)
    ? Number(text) * 1000
    : Date.parse(text) - now;
  return Number.isFinite(milliseconds) ? Math.max(0, milliseconds) : undefined;
}

/** Pin Developer API endpoint; retain Retry-After, which ApiError itself omits. */
export function createGoogleClient(settings: GemmaConfig): Generate {
  return async (
    request,
    observation = { httpStatus: null, abortObserved: null },
  ) => {
    let headerDelay: number | undefined;
    const cleanup: (() => void)[] = [];
    const ai = new GoogleGenAI({
      apiKey: settings.apiKey,
      vertexai: false,
      httpOptions: {
        baseUrl: "https://generativelanguage.googleapis.com",
        apiVersion: "v1beta",
        retryOptions: { attempts: 1 },
        fetch: async (url, init) => {
          const signal = init?.signal;
          if (signal) {
            observation.abortObserved = signal.aborted;
            const onAbort = () => {
              observation.abortObserved = true;
            };
            signal.addEventListener("abort", onAbort, { once: true });
            cleanup.push(() => signal.removeEventListener("abort", onAbort));
          }
          const response = await fetch(url, init);
          observation.httpStatus = safeHTTPStatus(response.status);
          if (!response.ok)
            headerDelay = retryDelayHeader(response.headers.get("retry-after"));
          return response;
        },
      },
    });
    try {
      return await ai.models.generateContent(request);
    } catch (error) {
      const mapped = mapGoogleError(error);
      if (mapped instanceof AIError && headerDelay !== undefined) {
        throw new AIError(mapped.code, {
          ...mapped,
          retryAfterMs: Math.max(headerDelay, mapped.retryAfterMs ?? 0),
        });
      }
      throw mapped;
    } finally {
      cleanup.forEach((remove) => remove());
    }
  };
}
