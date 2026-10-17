import type { NormalizedDocument } from "@/features/documents/contracts/processing";
import {
  sourceReferenceSchema,
  validateEvidenceReference,
} from "@/features/documents/evidence/references";
import type { ClaimEvidence } from "../contracts/analysis";

export function groundEvidence(
  doc: NormalizedDocument,
  evidence: ClaimEvidence[],
) {
  const references = [];
  for (const item of evidence) {
    const page = doc.pages.find(
      (candidate) => candidate.pageNumber === item.pageNumber,
    );
    const segment = page?.segments.find(
      (candidate) => candidate.id === item.segmentId,
    );
    if (!page || !segment || !segment.text.includes(item.excerpt)) return null;
    const localStart = segment.text.indexOf(item.excerpt);
    const start = segment.start + localStart;
    const reference = sourceReferenceSchema.safeParse({
      documentId: doc.id,
      pageNumber: page.pageNumber,
      segmentId: segment.id,
      start,
      end: start + item.excerpt.length,
      excerpt: item.excerpt,
      extractionMethod: segment.extractionMethod,
      provenanceStatus: "source_matched",
      ...(segment.geometry ? { geometry: segment.geometry } : {}),
    });
    if (!reference.success || !validateEvidenceReference(doc, reference.data))
      return null;
    references.push(reference.data);
  }
  return references;
}
