import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { processDocument } from "../src/features/documents/processing/process-document";
import { analyzeDocument } from "../src/features/analysis/orchestration/analyze-document";
import { createGemmaProvider } from "../src/features/ai/google-gemma";
import { getAIConfig, getAIPolicy } from "../src/lib/config/env";
import {
  sanitizeAIError,
  redactAISecrets,
} from "../src/features/ai/diagnostics";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const args = process.argv.slice(2);
const allowed = new Map([
  ["basic", "municipal.pdf"],
  ["hindi", "hindi.pdf"],
  ["marathi", "marathi.pdf"],
]);
const onlyAt = args.indexOf("--only");
const selected = onlyAt >= 0 ? args[onlyAt + 1] : undefined;
if (
  !args.includes("--confirm-synthetic") ||
  args.length !== 3 ||
  args.filter((arg) => arg === "--only").length !== 1 ||
  !selected ||
  !allowed.has(selected)
) {
  console.log(
    JSON.stringify({
      status: "not_run",
      required:
        "npm run ai:analyze-synthetic -- --confirm-synthetic --only basic|hindi|marathi",
      maxRemoteRequests: 1,
    }),
  );
  process.exitCode = 2;
} else {
  const filename = allowed.get(selected)!;
  const input = {
    bytes: new Uint8Array(
      await (
        await import("node:fs/promises")
      ).readFile(
        new URL(
          `../src/features/documents/fixtures/files/${filename}`,
          import.meta.url,
        ),
      ),
    ),
    originalFilename: filename,
  };
  const processed = await processDocument(input);
  if (!processed.ok) {
    console.log(
      JSON.stringify({
        status: "failure",
        category: "synthetic_document_processing",
      }),
    );
    process.exitCode = 1;
  } else {
    const started = Date.now();
    try {
      const outcome = await analyzeDocument(
        {
          document: processed.value.document,
          requestedOutputLanguage:
            selected === "hindi" ? "hi" : selected === "marathi" ? "mr" : "en",
        },
        {
          provider: createGemmaProvider({
            config: () => ({
              ...getAIConfig(),
              ...getAIPolicy(),
              maxRetries: 0,
            }),
          }),
        },
      );
      const report = {
        caseId: selected,
        sourceId: "bundled-synthetic-document",
        modelConfigured: process.env.AI_MODEL?.trim() || "gemma-4-26b-a4b-it",
        status: outcome.status,
        category:
          outcome.status === "failed" || outcome.status === "unsupported"
            ? outcome.code
            : null,
        durationMs: Date.now() - started,
        claimCount:
          "analysis" in outcome
            ? outcome.analysis.requiredActions.length +
              outcome.analysis.deadlines.length +
              outcome.analysis.fees.length +
              outcome.analysis.requiredDocuments.length
            : 0,
        modelVersion:
          "analysis" in outcome
            ? outcome.analysis.processingMetadata.modelVersion
            : null,
        usage:
          "analysis" in outcome
            ? {
                inputTokens: outcome.analysis.processingMetadata.inputTokens,
                outputTokens: outcome.analysis.processingMetadata.outputTokens,
                totalTokens: outcome.analysis.processingMetadata.totalTokens,
              }
            : null,
        sourceTextPersisted: false,
      };
      await mkdir(".local-reports", { recursive: true, mode: 0o700 });
      const reportPath = `.local-reports/ai-analysis-${new Date().toISOString().replaceAll(":", "-")}.json`;
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, {
        mode: 0o600,
        flag: "wx",
      });
      console.log(redactAISecrets(report));
      if (outcome.status === "failed" || outcome.status === "unsupported")
        process.exitCode = 1;
    } catch (error) {
      console.log(
        JSON.stringify({
          status: "failure",
          error: sanitizeAIError(error),
          sourceTextPersisted: false,
        }),
      );
      process.exitCode = 1;
    } finally {
      processed.value.dispose();
    }
  }
}
