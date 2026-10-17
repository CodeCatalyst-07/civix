import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createGemmaProvider } from "../src/features/ai/google-gemma";
import {
  getAIConfig,
  getAIPolicy,
  DEFAULT_AI_MODEL,
} from "../src/lib/config/env";
import {
  civicExperiments,
  assessExperiment,
  smokeSource,
} from "../src/features/ai/experiments";
import { parseExtraction } from "../src/features/ai/output";
import type { Generation } from "../src/features/ai/contracts";
import {
  redactAISecrets,
  sanitizeAIError,
  summarizeDiagnostics,
  type RequestDiagnostic,
} from "../src/features/ai/diagnostics";
import {
  planExperiments,
  runExperimentPlan,
  experimentMaxRetries,
  type ExperimentId,
} from "../src/features/ai/experiment-control";

// Explicit CLI only. Existing process variables take precedence over .env.local.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const mode = process.argv[2];
const selectedModel = process.env.AI_MODEL?.trim() || DEFAULT_AI_MODEL;
const redact = redactAISecrets;

async function executeSynthetic(
  provider: ReturnType<typeof createGemmaProvider>,
  id: ExperimentId,
): Promise<Record<string, unknown>> {
  if (id === "text")
    return {
      ...(await provider.generateText(
        `Explain action, deadline and consequence in English.\n${smokeSource}`,
      )),
      assessment: "needs-review",
    };
  const fixture = civicExperiments.find((item) => item.id === id);
  if (fixture) {
    const result = await provider.generateStructured(fixture.source);
    return {
      ...result,
      expectation: fixture.expectation,
      ...assessExperiment(fixture.id, result.data),
    };
  }
  if (id === "image-png")
    return {
      ...(await provider.generateImage(
        "Read this fictional notice image. Extract document title, fictional issuing authority, date mentioned and required action in English. If unclear, say unknown.",
        {
          bytes: await readFile(
            new URL("../src/features/ai/fixtures/notice.png", import.meta.url),
          ),
          mimeType: "image/png",
        },
      )),
      assessment: "needs-review",
      expected: {
        title: "Fictional Application Notice",
        authority: "Fictional Meadowglass Service Desk",
        date: "25 October 2026",
        action: "Submit address proof",
      },
    };
  if (id === "sdk-json-mode") {
    const result = await provider.probeJSONMode(smokeSource);
    return {
      ...result,
      data: parseExtraction(result.text),
      assessment: "needs-review",
      note: "Tests MIME-mode acceptance only, not guaranteed enforcement. responseSchema is not probed.",
    };
  }
  throw new Error("Missing synthetic experiment.");
}

async function smoke() {
  let settings;
  try {
    settings = { ...getAIConfig(), ...getAIPolicy(), maxRetries: 0 };
  } catch (error) {
    console.log(
      redact({
        status: "not run",
        model: selectedModel,
        error: sanitizeAIError(error),
      }),
    );
    process.exitCode = 2;
    return;
  }
  const started = performance.now();
  const requests: RequestDiagnostic[] = [];
  let output: Generation | undefined;
  let failure: ReturnType<typeof sanitizeAIError> | undefined;
  try {
    output = await createGemmaProvider({
      config: () => settings,
      onDiagnostic: (event) => requests.push(event),
    }).generateText(
      `Explain the required action, deadline and possible consequence in simple English.\n${smokeSource}`,
    );
  } catch (error) {
    failure = sanitizeAIError(error);
    process.exitCode = 1;
  }
  const diagnostics = summarizeDiagnostics(
    "smoke",
    settings.model,
    settings.timeoutMs,
    performance.now() - started,
    requests,
    failure?.code,
  );
  console.log(
    redact({
      status: failure ? "failure" : "success",
      model: settings.model,
      modelVersion: output?.modelVersion ?? null,
      usage: output?.usage ?? null,
      assessment: "needs-review",
      error: failure,
      diagnostics,
    }),
  );
  await save({
    kind: "smoke",
    sourceId: "smoke-fictional-address-proof",
    status: failure ? "failure" : "success",
    ...output,
    error: failure,
    diagnostics,
    assessment: "needs-review",
  });
}

async function main() {
  if (mode === "smoke") return smoke();
  if (mode !== "experiments") throw new Error("Use smoke or experiments.");
  const plan = planExperiments(process.argv.slice(3));
  const sdkManifest = JSON.parse(
    await readFile(
      new URL("../node_modules/@google/genai/package.json", import.meta.url),
      "utf8",
    ),
  ) as { version?: unknown };
  const sdkVersion =
    typeof sdkManifest.version === "string"
      ? sdkManifest.version
      : "unavailable";
  let settings;
  try {
    settings = { ...getAIConfig(), ...getAIPolicy() };
    settings.maxRetries = experimentMaxRetries(plan, settings.maxRetries);
  } catch (error) {
    console.log(
      redact({
        status: "not run",
        model: selectedModel,
        error: sanitizeAIError(error),
      }),
    );
  }
  console.log(
    redact({
      model: selectedModel,
      selectedExperiments: plan.ids,
      plannedRequests: plan.ids.length,
      maxRemoteAttempts: settings
        ? plan.ids.length * (settings.maxRetries + 1)
        : null,
      sequential: true,
      syntheticOnly: true,
      jsonRepair: false,
      diagnostic: plan.diagnostic,
      continueIndependent: plan.explicitlySelected || plan.diagnostic,
    }),
  );
  const details = new Map<
    ExperimentId,
    {
      diagnostics: ReturnType<typeof summarizeDiagnostics>;
      observedOutput: Generation[];
    }
  >();
  const configured = settings;
  const rows = !configured
    ? plan.ids.map((id) => ({
        id,
        status: "not run",
        reason: "Configuration unavailable.",
      }))
    : await runExperimentPlan(plan, async (id) => {
        const started = performance.now();
        const requests: RequestDiagnostic[] = [];
        const observedOutput: Generation[] = [];
        let errorCategory: ReturnType<typeof sanitizeAIError>["code"] | null =
          null;
        try {
          const provider = createGemmaProvider({
            config: () => configured,
            onResponse: (result) => observedOutput.push(result),
            onDiagnostic: (event) => requests.push(event),
          });
          const output = await executeSynthetic(provider, id);
          if (output.assessment === "fail") process.exitCode = 1;
          return output;
        } catch (error) {
          errorCategory = sanitizeAIError(error).code;
          throw error;
        } finally {
          const diagnostics = summarizeDiagnostics(
            id,
            configured.model,
            configured.timeoutMs,
            performance.now() - started,
            requests,
            errorCategory,
          );
          details.set(id, { diagnostics, observedOutput });
          // Metadata only. Synthetic output is stored in the ignored report, not console.
          console.log(redact({ diagnostics }));
        }
      });
  if (!configured || !plan.confirmed) process.exitCode = 2;
  else if (rows.some((row) => row.status === "failure")) process.exitCode = 1;
  const reportRows: Record<string, unknown>[] = rows.map((row) => ({
    ...row,
    ...(details.has(row.id)
      ? {
          diagnostics: details.get(row.id)!.diagnostics,
          ...(row.status === "failure"
            ? { observedOutput: details.get(row.id)!.observedOutput }
            : {}),
        }
      : {}),
  }));
  if (!plan.explicitlySelected && !plan.probeJSON)
    reportRows.push({
      id: "sdk-json-mode",
      status: "not run",
      reason: "Requires --probe-json-mode.",
    });
  await save({
    kind: "capabilities",
    model: selectedModel,
    sdkVersion,
    plannedRequests: plan.ids.length,
    selectedExperiments: plan.ids,
    diagnostic: plan.diagnostic,
    rows: reportRows,
    limitations:
      "Factual outputs require human review. Schema validity does not establish source truth. Abort metadata describes client behavior, not server cancellation. JPEG has offline transport coverage only.",
  });
}
async function save(report: unknown) {
  await mkdir(".local-reports", { recursive: true });
  const path = `.local-reports/gemma-${mode}-${new Date().toISOString().replaceAll(":", "-")}.json`;
  await writeFile(
    path,
    redact({ recordedAt: new Date().toISOString(), report }) + "\n",
    { mode: 0o600 },
  );
  console.log(`Report: ${path}`);
}
main().catch((error) => {
  console.error(redact({ status: "failure", error: sanitizeAIError(error) }));
  process.exitCode = 1;
});
