import { z } from "zod";
import { identifierSchema } from "../schemas/document";
import {
  geometrySchema,
  type NormalizedDocument,
} from "../contracts/processing";
export const sourceReferenceSchema = z.strictObject({
  documentId: identifierSchema,
  pageNumber: z.int().positive(),
  segmentId: identifierSchema.optional(),
  start: z.int().nonnegative(),
  end: z.int().positive(),
  excerpt: z.string().min(1),
  extractionMethod: z.enum(["pdf-text", "ocr"]),
  provenanceStatus: z.literal("source_matched"),
  geometry: geometrySchema.optional(),
});
export type SourceReference = z.infer<typeof sourceReferenceSchema>;
/** Physical page identity only: no OCR, excerpt or pixel availability assertion. */
export const pageSourceReferenceSchema = z.strictObject({
  documentId: identifierSchema,
  pageNumber: z.int().positive(),
  extractionMethod: z.literal("page-metadata"),
  provenanceStatus: z.literal("page_located"),
});
export const evidenceReferenceSchema = z.union([
  sourceReferenceSchema,
  pageSourceReferenceSchema,
]);
export type EvidenceReference = z.infer<typeof evidenceReferenceSchema>;
export function createPageEvidenceReference(
  doc: NormalizedDocument,
  pageNumber: number,
): z.infer<typeof pageSourceReferenceSchema> {
  if (!validatePageReference(doc, pageNumber))
    throw new Error("MISSING_SOURCE_PAGE");
  return {
    documentId: doc.id,
    pageNumber,
    extractionMethod: "page-metadata",
    provenanceStatus: "page_located",
  };
}

export function validatePageReference(doc: NormalizedDocument, number: number) {
  return (
    Number.isSafeInteger(number) &&
    number >= 1 &&
    number <= doc.pages.length &&
    doc.pages[number - 1]?.pageNumber === number
  );
}
export function retrieveExcerpt(
  doc: NormalizedDocument,
  page: number,
  start: number,
  end: number,
): string | null {
  if (!validatePageReference(doc, page)) return null;
  const text = doc.pages[page - 1]!.text;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= end ||
    end > text.length
  )
    return null;
  // Reject offsets splitting a surrogate pair.
  const splits = (n: number) =>
    n > 0 &&
    n < text.length &&
    /[\uD800-\uDBFF]/.test(text[n - 1]!) &&
    /[\uDC00-\uDFFF]/.test(text[n]!);
  return splits(start) || splits(end) ? null : text.slice(start, end);
}
export function validateEvidenceReference(
  doc: NormalizedDocument,
  candidate: unknown,
): boolean {
  const parsed = evidenceReferenceSchema.safeParse(candidate);
  if (!parsed.success) return false;
  const ref = parsed.data;
  if (ref.extractionMethod === "page-metadata")
    return (
      ref.documentId === doc.id && validatePageReference(doc, ref.pageNumber)
    );
  if (
    ref.documentId !== doc.id ||
    retrieveExcerpt(doc, ref.pageNumber, ref.start, ref.end) !== ref.excerpt
  )
    return false;
  const page = doc.pages[ref.pageNumber - 1]!;
  return page.segments.some(
    (s) =>
      (!ref.segmentId || s.id === ref.segmentId) &&
      s.start <= ref.start &&
      s.end >= ref.end &&
      s.extractionMethod === ref.extractionMethod &&
      (!ref.geometry ||
        JSON.stringify(ref.geometry) === JSON.stringify(s.geometry)),
  );
}
export function createEvidenceReference(
  doc: NormalizedDocument,
  pageNumber: number,
  segmentId: string,
): SourceReference {
  const segment = doc.pages
    .find((p) => p.pageNumber === pageNumber)
    ?.segments.find((s) => s.id === segmentId);
  if (!segment) throw new Error("MISSING_SOURCE_SEGMENT");
  const ref = sourceReferenceSchema.parse({
    documentId: doc.id,
    pageNumber,
    segmentId,
    start: segment.start,
    end: segment.end,
    excerpt: segment.text,
    extractionMethod: segment.extractionMethod,
    provenanceStatus: "source_matched",
    ...(segment.geometry ? { geometry: segment.geometry } : {}),
  });
  if (!validateEvidenceReference(doc, ref))
    throw new Error("INVALID_SOURCE_SEGMENT");
  return ref;
}
