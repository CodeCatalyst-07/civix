import "server-only";
import {
  ThinkingLevel,
  type GenerateContentParameters,
  type GenerateContentResponse,
  type Part,
} from "@google/genai";
import { createGoogleClient } from "./google-client";
import { getAIConfig, getAIPolicy } from "@/lib/config/env";
import { AppError } from "@/lib/errors/app-error";
import {
  MAX_IMAGE_BYTES,
  MAX_RESPONSE_CHARS,
  promptSchema,
  type AIProvider,
  type Generation,
  type ImageInput,
} from "./contracts";
import { AIError, mapGoogleError } from "./errors";
import {
  safeHTTPStatus,
  type RequestDiagnostic,
  type TransportObservation,
} from "./diagnostics";
import { CIVIC_SYSTEM, extractionPrompt } from "./prompts";
import { parseExtraction, checkExtractionLiterals } from "./output";
import {
  ConcurrencyGate,
  processGate,
  withRetries,
  defaultRetryDependencies,
  type RetryDependencies,
} from "./resilience";

export type GemmaConfig = ReturnType<typeof getAIConfig> &
  ReturnType<typeof getAIPolicy>;
export type Generate = (
  request: GenerateContentParameters,
  observation?: TransportObservation,
) => Promise<GenerateContentResponse>;
type Dependencies = Partial<RetryDependencies> & {
  config?: () => GemmaConfig;
  client?: (config: GemmaConfig) => Generate;
  gate?: ConcurrencyGate;
  /** Explicit synthetic-runner diagnostics only; default provider does not persist output. */
  onResponse?: (result: Generation) => void;
  /** Disabled unless explicitly supplied by developer tooling. */
  onDiagnostic?: (diagnostic: RequestDiagnostic) => void;
  /** Explicit developer comparison override; production calls leave thinking unset. */
  thinkingLevel?: ThinkingLevel.MINIMAL | ThinkingLevel.HIGH;
};

function checkedPrompt(prompt: string): string {
  const parsed = promptSchema.safeParse(prompt);
  if (!parsed.success)
    throw new AppError(
      "VALIDATION_ERROR",
      "AI prompt must contain 1–20000 characters.",
    );
  return parsed.data;
}
function imagePart(image: ImageInput): Part {
  const bytes = image.bytes;
  if (!(bytes instanceof Uint8Array))
    throw new AppError("VALIDATION_ERROR", "Invalid image bytes.");
  const png =
    bytes.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n);
  const jpeg = bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255;
  if (
    bytes.length > MAX_IMAGE_BYTES ||
    !(
      (image.mimeType === "image/png" && png) ||
      (image.mimeType === "image/jpeg" && jpeg)
    )
  ) {
    throw new AppError(
      "VALIDATION_ERROR",
      "Use a PNG or JPEG image no larger than 2 MiB.",
    );
  }
  return {
    inlineData: {
      mimeType: image.mimeType,
      data: Buffer.from(bytes).toString("base64"),
    },
  };
}
function token(value: number | undefined): number | null {
  return value !== undefined && Number.isSafeInteger(value) && value >= 0
    ? value
    : null;
}

/** Lazy credentials and SDK construction; importing never makes a request. */
export function createGemmaProvider(
  deps: Dependencies = {},
): AIProvider & { probeJSONMode(source: string): Promise<Generation> } {
  const config =
    deps.config ?? (() => ({ ...getAIConfig(), ...getAIPolicy() }));
  const gate = deps.gate ?? processGate;
  const retryDeps = { ...defaultRetryDependencies, ...deps };
  const client = deps.client ?? createGoogleClient;

  async function generate(
    prompt: string,
    extra: Part[] = [],
    operation: RequestDiagnostic["operation"] = "text",
  ): Promise<Generation> {
    const text = checkedPrompt(prompt);
    const settings = config();
    // Validate controlled configuration too, even when supplied by a caller.
    if (!settings.apiKey.trim()) throw new AIError("AI_MISSING_API_KEY");
    getAIPolicy({
      AI_REQUEST_TIMEOUT_MS: String(settings.timeoutMs),
      AI_MAX_RETRIES: String(settings.maxRetries),
      AI_MAX_CONCURRENT_REQUESTS: String(settings.maxConcurrent),
    });
    if (!settings.model.trim())
      throw new AppError("CONFIGURATION_ERROR", "AI_MODEL is required.");
    const send = client(settings);
    let attempt = 0;
    return withRetries(
      async () => {
        attempt++;
        const started = performance.now();
        const controller = new AbortController();
        const transport: TransportObservation = {
          httpStatus: null,
          abortObserved: null,
        };
        let dispatched = false;
        let errorCategory: RequestDiagnostic["errorCategory"] = null;
        let timeoutSource: RequestDiagnostic["timeoutSource"] = null;
        let usage: Generation["usage"] = null;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const pending = gate.run(settings.maxConcurrent, () => {
            dispatched = true;
            return send(
              {
                model: settings.model,
                contents: [{ role: "user", parts: [{ text }, ...extra] }],
                config: {
                  systemInstruction: CIVIC_SYSTEM,
                  temperature: 0,
                  maxOutputTokens: 2048,
                  ...(deps.thinkingLevel
                    ? { thinkingConfig: { thinkingLevel: deps.thinkingLevel } }
                    : {}),
                  ...(operation === "json-mode-probe"
                    ? { responseMimeType: "application/json" }
                    : {}),
                  abortSignal: controller.signal,
                  httpOptions: {
                    timeout: settings.timeoutMs,
                    retryOptions: { attempts: 1 },
                  },
                },
              },
              transport,
            );
          });
          const deadline = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              timeoutSource = "application-deadline";
              reject(new AIError("AI_TIMEOUT"));
              controller.abort();
            }, settings.timeoutMs);
          });
          const response = await Promise.race([pending, deadline]);
          const metadata = response.usageMetadata;
          usage = metadata
            ? {
                inputTokens: token(metadata.promptTokenCount),
                outputTokens: token(metadata.candidatesTokenCount),
                totalTokens: token(metadata.totalTokenCount),
              }
            : null;
          if (
            response.promptFeedback?.blockReason ||
            response.candidates?.some(
              (c) =>
                c.finishReason &&
                !["STOP", "MAX_TOKENS"].includes(c.finishReason),
            )
          ) {
            throw new AIError("AI_INVALID_OUTPUT");
          }
          const generated = response.text;
          if (!generated?.trim()) throw new AIError("AI_EMPTY_RESPONSE");
          if (generated.length > MAX_RESPONSE_CHARS)
            throw new AIError("AI_INVALID_OUTPUT");
          const result: Generation = {
            text: generated,
            model: settings.model,
            modelVersion: response.modelVersion ?? null,
            usage,
          };
          deps.onResponse?.(result);
          return result;
        } catch (error) {
          const mapped = mapGoogleError(error);
          errorCategory = mapped.code;
          if (mapped instanceof AIError)
            transport.httpStatus ??= safeHTTPStatus(mapped.status);
          if (mapped.code === "AI_TIMEOUT") {
            timeoutSource ??= "sdk-or-transport";
            controller.abort();
          }
          throw mapped;
        } finally {
          if (timer) clearTimeout(timer);
          if (deps.onDiagnostic) {
            const diagnostic: RequestDiagnostic = {
              operation,
              model: settings.model,
              attempt,
              dispatched,
              durationMs: Math.max(0, Math.round(performance.now() - started)),
              timeoutMs: settings.timeoutMs,
              sdkMaxAttempts: 1,
              promptChars: text.length,
              systemChars: CIVIC_SYSTEM.length,
              maxOutputTokens: 2048,
              responseMode:
                operation === "structured"
                  ? "prompt-json"
                  : operation === "json-mode-probe"
                    ? "json-mime-probe"
                    : "text",
              httpStatus: safeHTTPStatus(transport.httpStatus),
              errorCategory,
              applicationAbortRequested: controller.signal.aborted,
              timeoutSource,
              transportAbortObserved: transport.abortObserved,
              usage,
            };
            // Observability must not cause retries or change an inference result.
            try {
              deps.onDiagnostic(diagnostic);
            } catch {
              /* No logging of callback errors. */
            }
          }
        }
      },
      settings.maxRetries,
      retryDeps,
    );
  }
  return {
    // Explicit developer probe only. Ordinary calls never depend on JSON mode.
    probeJSONMode: (source) =>
      generate(extractionPrompt(source), [], "json-mode-probe"),
    generateText: (prompt) => generate(prompt),
    generateImage: (prompt, image) =>
      generate(prompt, [imagePart(image)], "image"),
    async generateStructured(source, options = {}) {
      checkedPrompt(source);
      const attempt = async (repair: boolean) => {
        const result = await generate(
          extractionPrompt(source, repair),
          [],
          "structured",
        );
        const data = parseExtraction(result.text);
        // Limited semantic grounding check, separate from shape validation.
        // Does not establish truth of summaries/actions or completeness.
        checkExtractionLiterals(data, source);
        return { ...result, data };
      };
      try {
        return await attempt(false);
      } catch (error) {
        if (
          options.repairOnce === true &&
          error instanceof AIError &&
          error.outputFailure
        )
          return attempt(true);
        throw error;
      }
    },
  };
}
