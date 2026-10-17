import { NextResponse } from "next/server";
import { processDocument } from "@/features/documents/processing/process-document";
import { analyzeDocument } from "@/features/analysis/orchestration/analyze-document";
import {
  civicAnalysisSchema,
  outputLanguageSchema,
} from "@/features/analysis/contracts/analysis";
import { createSyntheticProvider } from "@/features/analysis/mock-provider";
import { isSyntheticModeEnabled } from "@/features/analysis/mock-mode";
import type { AnalysisDiagnostic } from "@/features/analysis/errors/errors";
import type { RequestDiagnostic } from "@/features/ai/diagnostics";

export const runtime = "nodejs";
export const maxDuration = 60;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
let requestActive = false;

function fail(
  status: number,
  code: string,
  message: string,
  contextLimit?: {
    sourceTextChars: number;
    serializedContextChars: number;
    maximumContextChars: number;
  },
  diagnostic?: {
    stage: string;
    category: string;
    providerCategory?: string;
    mockEnabled: boolean;
    providerAttempts?: Array<{
      attempt: number;
      durationMs: number;
      httpStatus: number | null;
      errorCategory: string | null;
      timeoutSource: string | null;
      dispatched: boolean;
    }>;
  },
  document?: {
    classification: unknown;
    warnings: string[];
    pages: Array<{ pageNumber: number; warnings: string[]; readable: boolean }>;
  },
) {
  return NextResponse.json(
    {
      status: "failed",
      error: {
        code,
        message,
        ...(contextLimit ? { contextLimit } : {}),
        ...(document ? { document } : {}),
        ...(diagnostic && process.env.NODE_ENV === "development"
          ? { diagnostic }
          : {}),
      },
    },
    { status },
  );
}

function developmentFailureDiagnostic(
  isDevelopment: boolean,
  detail: AnalysisDiagnostic,
  mockEnabled: boolean,
  attempts: RequestDiagnostic[],
) {
  if (!isDevelopment) return undefined;
  return {
    ...detail,
    mockEnabled,
    ...(attempts.length
      ? {
          providerAttempts: attempts.map((item) => ({
            attempt: item.attempt,
            durationMs: item.durationMs,
            httpStatus: item.httpStatus,
            errorCategory: item.errorCategory,
            timeoutSource: item.timeoutSource,
            dispatched: item.dispatched,
          })),
        }
      : {}),
  };
}

export async function POST(request: Request) {
  if (requestActive)
    return fail(
      429,
      "REQUEST_BUSY",
      "Another document is being processed. Try again shortly.",
    );
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_UPLOAD_BYTES + 64 * 1024)
    return fail(413, "UPLOAD_TOO_LARGE", "The file exceeds the 10 MiB limit.");
  requestActive = true;
  let bytes: Uint8Array<ArrayBuffer> | undefined;
  try {
    const form = await request.formData();
    const candidate = form.get("file");
    const requestedLanguage = outputLanguageSchema.safeParse(
      form.get("language") ?? "en",
    );
    if (!(candidate instanceof File))
      return fail(400, "FILE_REQUIRED", "Choose a PDF, PNG, or JPEG document.");
    if (!requestedLanguage.success)
      return fail(
        400,
        "INVALID_LANGUAGE",
        "Choose English, Hindi, or Marathi.",
      );
    if (candidate.size > MAX_UPLOAD_BYTES)
      return fail(
        413,
        "UPLOAD_TOO_LARGE",
        "The file exceeds the 10 MiB limit.",
      );
    const uploaded = new Uint8Array(await candidate.arrayBuffer());
    bytes = new Uint8Array(new ArrayBuffer(uploaded.byteLength));
    bytes.set(uploaded);
    const processed = await processDocument({
      bytes,
      originalFilename: candidate.name,
      declaredMimeType: candidate.type || undefined,
    });
    if (!processed.ok)
      return fail(
        422,
        processed.error.reason,
        processed.error.message,
        undefined,
        process.env.NODE_ENV === "development"
          ? {
              stage: "document_processing",
              category: processed.error.reason,
              mockEnabled: isSyntheticModeEnabled(),
            }
          : undefined,
      );
    try {
      const mockEnabled = isSyntheticModeEnabled();
      const providerAttempts: RequestDiagnostic[] = [];
      const outcome = await analyzeDocument(
        {
          document: processed.value.document,
          requestedOutputLanguage: requestedLanguage.data,
        },
        {
          ...(mockEnabled
            ? {
                provider: createSyntheticProvider(
                  processed.value.document,
                  requestedLanguage.data,
                ),
              }
            : {}),
          ...(process.env.NODE_ENV === "development" && !mockEnabled
            ? {
                onProviderDiagnostic: (item: RequestDiagnostic) =>
                  providerAttempts.push(item),
              }
            : {}),
        },
      );
      if (!("analysis" in outcome))
        return fail(
          outcome.status === "unsupported" ? 422 : 502,
          outcome.code,
          outcome.message,
          outcome.contextLimit,
          developmentFailureDiagnostic(
            process.env.NODE_ENV === "development",
            outcome.diagnostic ?? {
              stage: "analysis_validation",
              category: outcome.code,
            },
            mockEnabled,
            providerAttempts,
          ),
          {
            classification: processed.value.document.classification,
            warnings: processed.value.document.warnings,
            pages: processed.value.document.pages.map((page) => ({
              pageNumber: page.pageNumber,
              warnings: page.warnings,
              readable: page.text.length > 0,
            })),
          },
        );
      const validated = civicAnalysisSchema.safeParse(outcome.analysis);
      if (!validated.success)
        return fail(
          502,
          "INVALID_RESULT",
          "The analysis result could not be validated.",
          undefined,
          developmentFailureDiagnostic(
            process.env.NODE_ENV === "development",
            {
              stage: "analysis_validation",
              category: "api_result_schema_invalid",
            },
            mockEnabled,
            providerAttempts,
          ),
        );
      return NextResponse.json(
        {
          status: outcome.status,
          analysis: validated.data,
          synthetic: mockEnabled,
          document: {
            classification: processed.value.document.classification,
            warnings: processed.value.document.warnings,
            pages: processed.value.document.pages.map((page) => ({
              pageNumber: page.pageNumber,
              ocrStatus: page.ocrStatus,
              warnings: page.warnings,
              readable: page.text.length > 0,
            })),
            partial:
              validated.data.analysisStatus === "partial" ||
              processed.value.document.status === "partial",
          },
        },
        { status: 200 },
      );
    } finally {
      processed.value.dispose();
    }
  } catch {
    return fail(
      400,
      "INVALID_REQUEST",
      "The upload could not be processed. Check the file and try again.",
      undefined,
      process.env.NODE_ENV === "development"
        ? {
            stage: "request_processing",
            category: "request_exception",
            mockEnabled: isSyntheticModeEnabled(),
          }
        : undefined,
    );
  } finally {
    bytes?.fill(0);
    requestActive = false;
  }
}
