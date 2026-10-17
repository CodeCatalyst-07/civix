import { z } from "zod";
import { identifierSchema, mimeTypeSchema } from "../schemas/document";
import type { ErrorCode } from "../../../lib/errors/app-error";
import type { ProcessingReason } from "../errors/reasons";

export const ingestionMimeSchema = mimeTypeSchema.extract([
  "application/pdf",
  "image/png",
  "image/jpeg",
]);
export const limitsSchema = z.strictObject({
  maxFileBytes: z
    .int()
    .min(1)
    .max(10 * 1024 * 1024)
    .default(10 * 1024 * 1024),
  maxPages: z.int().min(1).max(20).default(20),
  maxDimension: z.int().min(1).max(8000).default(8000),
  maxPixels: z.int().min(1).max(20_000_000).default(20_000_000),
  maxTextChars: z.int().min(1).max(200_000).default(200_000),
  maxDurationMs: z.int().min(1).max(30_000).default(15_000),
  maxOutputBytes: z
    .int()
    .min(1)
    .max(10 * 1024 * 1024)
    .default(10 * 1024 * 1024),
  outputDimension: z.int().min(1).max(4000).default(3000),
});
export type ProcessingLimits = z.infer<typeof limitsSchema>;
export const inputSchema = z.strictObject({
  bytes: z.instanceof(Uint8Array),
  originalFilename: z.string().min(1).max(255),
  declaredMimeType: z.string().max(100).optional(),
  sourceId: identifierSchema.optional(),
});
export type DocumentInput = z.infer<typeof inputSchema>;
const count = z.int().nonnegative();
const positive = z.int().positive();
export const geometrySchema = z.strictObject({
  coordinateSpace: z.enum(["pdf-user-space", "image-pixels"]),
  transform: z.tuple([
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
    z.number().finite(),
  ]),
  width: z.number().finite().nonnegative(),
  height: z.number().finite().nonnegative(),
});
export const segmentSchema = z.strictObject({
  id: identifierSchema,
  pageNumber: positive,
  text: z.string().min(1),
  start: count,
  end: positive,
  geometry: geometrySchema.optional(),
  extractionMethod: z.enum(["pdf-text", "ocr"]),
  confidence: z.number().min(0).max(100).optional(),
});
export const imageSchema = z.strictObject({
  originalFormat: z.enum(["png", "jpeg"]),
  originalWidth: positive,
  originalHeight: positive,
  width: positive,
  height: positive,
  mimeType: z.literal("image/png"),
  byteLength: positive,
});
export const pageSchema = z.strictObject({
  pageNumber: positive,
  extractionStatus: z.enum([
    "text_extracted",
    "no_extractable_text",
    "visual_processing_required",
    "extraction_failed",
  ]),
  rawText: z.string().max(200_000),
  text: z.string().max(200_000),
  segments: z.array(segmentSchema).max(50_000),
  image: imageSchema.optional(),
  needsVisualProcessing: z.boolean(),
  warnings: z.array(z.string()),
  ocrStatus: z
    .enum(["not_needed", "completed", "unavailable", "failed"])
    .default("not_needed"),
});
export type DocumentPage = z.infer<typeof pageSchema>;
export const classificationSchema = z.strictObject({
  category: z.enum([
    "government_notice",
    "official_departmental_letter",
    "application_or_verification_request",
    "government_scheme",
    "certificate_or_record",
    "public_circular_or_notification",
    "unknown_or_unsupported",
  ]),
  title: z.string().nullable(),
  documentType: z.string().nullable(),
  issuingAuthority: z.string().nullable(),
  referenceNumber: z.string().nullable(),
  issueDate: z.string().nullable(),
  recipient: z.string().nullable(),
  purpose: z.string().nullable(),
  authenticity: z.literal("not_verified"),
});
export const normalizedDocumentSchema = z
  .strictObject({
    id: identifierSchema,
    sourceId: identifierSchema.optional(),
    detectedMimeType: ingestionMimeSchema,
    originalFilename: z.string().min(1).max(255),
    status: z.enum(["completed", "completed_with_warnings", "partial"]),
    classification: classificationSchema,
    pageCount: positive,
    pages: z.array(pageSchema).min(1).max(20),
    warnings: z.array(z.string()),
    metadata: z.strictObject({
      parser: z.string(),
      libraryVersion: z.string(),
      durationMs: count,
      title: z.string().max(1000).nullable(),
      statistics: z.strictObject({
        textPages: count,
        visualPages: count,
        failedPages: count,
        noTextPages: count,
        totalCharacters: count,
        complete: z.boolean(),
      }),
    }),
  })
  .superRefine((doc, ctx) => {
    if (doc.pageCount !== doc.pages.length)
      ctx.addIssue({ code: "custom", message: "Page count mismatch" });
    const ids = new Set<string>();
    for (const [index, page] of doc.pages.entries()) {
      if (page.pageNumber !== index + 1)
        ctx.addIssue({ code: "custom", message: "Invalid page ordering" });
      if ((page.extractionStatus === "text_extracted") !== page.text.length > 0)
        ctx.addIssue({ code: "custom", message: "Text status mismatch" });
      let previousEnd = 0;
      for (const segment of page.segments) {
        if (
          ids.has(segment.id) ||
          segment.start < previousEnd ||
          segment.pageNumber !== page.pageNumber ||
          segment.end > page.text.length ||
          segment.start >= segment.end ||
          page.text.slice(segment.start, segment.end) !== segment.text
        )
          ctx.addIssue({
            code: "custom",
            message: "Invalid segment provenance",
          });
        ids.add(segment.id);
        previousEnd = segment.end;
      }
    }
    const statistics = doc.metadata.statistics;
    if (
      statistics.textPages !==
        doc.pages.filter((p) => p.text.length > 0).length ||
      statistics.visualPages !==
        doc.pages.filter((p) => p.needsVisualProcessing).length ||
      statistics.failedPages !==
        doc.pages.filter((p) => p.extractionStatus === "extraction_failed")
          .length ||
      statistics.noTextPages !==
        doc.pages.filter((p) => !p.text.length).length ||
      statistics.totalCharacters !==
        doc.pages.reduce((n, p) => n + p.text.length, 0) ||
      statistics.totalCharacters > 200_000 ||
      doc.pages.reduce((n, p) => n + p.rawText.length, 0) > 200_000 ||
      statistics.complete !==
        !doc.pages.some(
          (p) =>
            p.extractionStatus === "extraction_failed" ||
            p.warnings.includes("PAGE_PARSER_WARNING"),
        )
    )
      ctx.addIssue({
        code: "custom",
        message: "Extraction statistics mismatch",
      });
    const expectedStatus = !statistics.complete
      ? "partial"
      : doc.warnings.length
        ? "completed_with_warnings"
        : "completed";
    if (doc.status !== expectedStatus)
      ctx.addIssue({ code: "custom", message: "Processing status mismatch" });
  });
export type NormalizedDocument = z.infer<typeof normalizedDocumentSchema>;
export type ProcessedDocument = {
  document: NormalizedDocument;
  binaries: Map<number, Uint8Array>;
  dispose(): void;
};
export type ProcessingOutcome =
  | { ok: true; value: ProcessedDocument }
  | {
      ok: false;
      error: { code: ErrorCode; message: string; reason: ProcessingReason };
    };
