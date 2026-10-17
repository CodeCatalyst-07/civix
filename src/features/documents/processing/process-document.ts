import "server-only";
import { processingReasonSchema } from "../errors/reasons";
import { createHash } from "node:crypto";
import { AppError, toPublicError } from "../../../lib/errors/app-error";
import {
  limitsSchema,
  normalizedDocumentSchema,
  type DocumentInput,
  type ProcessingLimits,
  type ProcessingOutcome,
  type DocumentPage,
} from "../contracts/processing";
import { validateInput } from "../validation/input";
import { parseIsolated } from "./isolation";
import { normalizeText } from "./text";
import { assessQuality } from "./quality";
import { classifyDocument } from "./classify-document";
export async function processDocument(
  candidate: DocumentInput,
  options: Partial<ProcessingLimits> = {},
): Promise<ProcessingOutcome> {
  const started = performance.now();
  try {
    const parsedLimits = limitsSchema.safeParse(options);
    if (!parsedLimits.success)
      throw new AppError("CONFIGURATION_ERROR", "INVALID_LIMITS");
    const limits = parsedLimits.data;
    const { input, mime } = validateInput(candidate, limits);
    // Snapshot caller-owned bytes; stable content identity does not depend on filenames.
    const bytes = Uint8Array.from(input.bytes);
    const id = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
    const result = await parseIsolated(bytes, mime, limits);
    const pages: DocumentPage[] = result.pages.map((p) => {
      const text = normalizeText(p.rawText);
      const warnings = [...(p.warnings ?? [])];
      if (p.failed) warnings.push("PAGE_EXTRACTION_FAILED");
      else if (!text) warnings.push("NO_EXTRACTABLE_TEXT");
      else if (text.length < 40) warnings.push("LOW_TEXT_QUANTITY");
      let cursor = 0;
      const segments: DocumentPage["segments"] = [];
      for (const item of p.textItems ?? []) {
        const source = normalizeText(item.text);
        if (!source) continue;
        const start = text.indexOf(source, cursor);
        if (start < 0) {
          warnings.push("ITEM_POSITION_UNAVAILABLE");
          continue;
        }
        const end = start + source.length;
        segments.push({
          id: `${id}:p${p.pageNumber}:s${segments.length + 1}`,
          pageNumber: p.pageNumber,
          text: source,
          start,
          end,
          geometry: item.geometry,
          extractionMethod: item.method ?? "pdf-text",
          ...(item.confidence !== undefined
            ? { confidence: item.confidence }
            : {}),
        });
        cursor = end;
      }
      const needsVisualProcessing = p.failed || text.length < 40;
      return {
        pageNumber: p.pageNumber,
        rawText: p.rawText,
        text,
        segments,
        extractionStatus: p.failed
          ? "extraction_failed"
          : text
            ? "text_extracted"
            : "visual_processing_required",
        needsVisualProcessing,
        warnings,
        ocrStatus: p.ocrStatus ?? "not_needed",
        ...(p.image ? { image: p.image } : {}),
      };
    });
    const { statistics, warnings } = assessQuality(pages);
    warnings.push(...result.warnings);
    if (statistics.totalCharacters > limits.maxTextChars)
      throw new AppError(
        "DOCUMENT_PROCESSING_ERROR",
        "DOCUMENT_LIMIT_EXCEEDED",
      );
    const classification = classifyDocument(pages);
    const document = normalizedDocumentSchema.parse({
      id,
      ...(input.sourceId ? { sourceId: input.sourceId } : {}),
      detectedMimeType: mime,
      originalFilename: input.originalFilename,
      status: !statistics.complete
        ? "partial"
        : warnings.length
          ? "completed_with_warnings"
          : "completed",
      classification,
      pageCount: pages.length,
      pages,
      warnings,
      metadata: {
        parser: result.parser,
        libraryVersion: result.libraryVersion,
        durationMs: Math.round(performance.now() - started),
        title: result.title,
        statistics,
      },
    });
    const binaries = new Map<number, Uint8Array>();
    if (result.binary) binaries.set(1, result.binary);
    return {
      ok: true,
      value: {
        document,
        binaries,
        dispose() {
          for (const bytes of binaries.values()) bytes.fill(0);
          binaries.clear();
        },
      },
    };
  } catch (error) {
    const safe =
      error instanceof AppError
        ? error
        : new AppError("DOCUMENT_PROCESSING_ERROR", "PROCESSING_FAILED");
    return {
      ok: false,
      error: {
        ...toPublicError(safe),
        reason:
          processingReasonSchema.safeParse(safe.message).data ??
          "PROCESSING_FAILED",
      },
    };
  }
}
