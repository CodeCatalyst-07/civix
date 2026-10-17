import type { ProcessedDocument } from "../contracts/processing";
import {
  createEvidenceReference,
  createPageEvidenceReference,
} from "../evidence/references";
/** Borrowed image bytes expire at dispose(); document text is untrusted source data. */
export function toAnalysisInput(value: ProcessedDocument) {
  return {
    documentId: value.document.id,
    warnings: value.document.warnings,
    pages: value.document.pages.map((page) => ({
      pageNumber: page.pageNumber,
      pageReference: createPageEvidenceReference(
        value.document,
        page.pageNumber,
      ),
      text: page.text,
      warnings: page.warnings,
      references: page.segments.map((s) =>
        createEvidenceReference(value.document, page.pageNumber, s.id),
      ),
      image: value.binaries.has(page.pageNumber)
        ? {
            bytes: value.binaries.get(page.pageNumber)!,
            mimeType: "image/png" as const,
          }
        : null,
    })),
  };
}
