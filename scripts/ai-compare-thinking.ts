import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { lookup } from "node:dns/promises";
import { AppError } from "../src/lib/errors/app-error";
import { getAIConfig, getAIPolicy } from "../src/lib/config/env";
import {
  redactAISecrets,
  sanitizeAIError,
} from "../src/features/ai/diagnostics";
import {
  comparisonPlan,
  runThinkingComparison,
  COMPARISON_MODEL,
} from "../src/features/ai/thinking-comparison";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
async function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== "--confirm-synthetic"))
    throw new AppError(
      "VALIDATION_ERROR",
      "Only --confirm-synthetic is supported by the fixed three-request comparison.",
    );
  const policy = getAIPolicy();
  const plan = comparisonPlan(policy.timeoutMs);
  console.log(redactAISecrets(plan));
  let reason: string | null = null;
  let settings;
  if (!args.includes("--confirm-synthetic"))
    reason = "Explicit --confirm-synthetic opt-in required.";
  else {
    settings = { ...getAIConfig(), ...policy };
    if (settings.model !== COMPARISON_MODEL)
      throw new AppError(
        "CONFIGURATION_ERROR",
        "AI_MODEL must be gemma-4-26b-a4b-it for this comparison.",
      );
    try {
      await lookup("generativelanguage.googleapis.com");
    } catch {
      reason =
        "Google API hostname could not be resolved; no inference attempts made.";
    }
  }
  const manifest = JSON.parse(
    await readFile(
      new URL("../node_modules/@google/genai/package.json", import.meta.url),
      "utf8",
    ),
  ) as { version?: unknown };
  const report =
    reason || !settings
      ? {
          ...plan,
          totalRemoteAttempts: 0,
          rows: plan.profiles.map((profile) => ({
            id: profile.id,
            status: "not run",
            reason,
            jsonReturned: null,
            zodValid: null,
            sourceLiteralsValid: null,
            remoteAttempts: 0,
            durationMs: null,
            httpStatus: null,
            timeoutMs: policy.timeoutMs,
          })),
        }
      : await runThinkingComparison(settings);
  console.log(
    redactAISecrets({
      totalRemoteAttempts: report.totalRemoteAttempts,
      rows: report.rows,
    }),
  );
  await mkdir(".local-reports", { recursive: true });
  const path = `.local-reports/gemma-thinking-comparison-${new Date().toISOString().replaceAll(":", "-")}.json`;
  await writeFile(
    path,
    redactAISecrets({
      recordedAt: new Date().toISOString(),
      sdkVersion:
        typeof manifest.version === "string" ? manifest.version : null,
      report,
    }) + "\n",
    { mode: 0o600 },
  );
  console.log(`Report: ${path}`);
  process.exitCode = reason
    ? 2
    : report.rows.some((row) => row.status === "failure")
      ? 1
      : 0;
}
main().catch((error) => {
  console.error(
    redactAISecrets({
      status: "not run or failed",
      error: sanitizeAIError(error),
    }),
  );
  process.exitCode = 1;
});
