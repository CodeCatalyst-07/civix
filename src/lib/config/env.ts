import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors/app-error";

export const DEFAULT_AI_MODEL = "gemma-4-26b-a4b-it";
type Environment = Readonly<Record<string, string | undefined>>;
const runtimeSchema = z.object({
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});
const aiSchema = z.object({
  GEMINI_API_KEY: z.string().trim().min(1),
  AI_MODEL: z.string().trim().min(1).default(DEFAULT_AI_MODEL),
});
const policySchema = z.object({
  AI_REQUEST_TIMEOUT_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(120000)
    .default(30000),
  AI_MAX_RETRIES: z.coerce.number().int().min(0).max(3).default(1),
  AI_MAX_CONCURRENT_REQUESTS: z.coerce.number().int().min(1).max(4).default(1),
});

/** Policy can be inspected without credentials. Values are never logged. */
export function getAIPolicy(env: Environment = process.env) {
  const parsed = policySchema.safeParse({
    AI_REQUEST_TIMEOUT_MS: env.AI_REQUEST_TIMEOUT_MS,
    AI_MAX_RETRIES: env.AI_MAX_RETRIES,
    AI_MAX_CONCURRENT_REQUESTS: env.AI_MAX_CONCURRENT_REQUESTS,
  });
  if (!parsed.success)
    throw new AppError(
      "CONFIGURATION_ERROR",
      "Invalid AI timeout, retry, or concurrency configuration.",
    );
  return {
    timeoutMs: parsed.data.AI_REQUEST_TIMEOUT_MS,
    maxRetries: parsed.data.AI_MAX_RETRIES,
    maxConcurrent: parsed.data.AI_MAX_CONCURRENT_REQUESTS,
  };
}

export function getRuntimeConfig(env: Environment = process.env) {
  const result = runtimeSchema.safeParse({ NODE_ENV: env.NODE_ENV });
  if (!result.success)
    throw new AppError(
      "CONFIGURATION_ERROR",
      "NODE_ENV must be development, test, or production.",
    );
  return { nodeEnv: result.data.NODE_ENV };
}

/** Call only at the future provider boundary; never at module initialization. */
export function getAIConfig(env: Environment = process.env) {
  if (!env.GEMINI_API_KEY?.trim())
    throw new AppError(
      "AI_MISSING_API_KEY",
      "Set GEMINI_API_KEY in the server environment before real inference.",
    );
  const result = aiSchema.safeParse({
    GEMINI_API_KEY: env.GEMINI_API_KEY,
    AI_MODEL: env.AI_MODEL,
  });
  if (!result.success) {
    const fields = [
      ...new Set(result.error.issues.map((issue) => String(issue.path[0]))),
    ];
    throw new AppError(
      "CONFIGURATION_ERROR",
      `Missing or invalid configuration: ${fields.join(", ")}. Set server environment variables before using AI analysis.`,
    );
  }
  return { apiKey: result.data.GEMINI_API_KEY, model: result.data.AI_MODEL };
}
