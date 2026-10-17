import {
  normalizedDocumentSchema,
  type NormalizedDocument,
} from "@/features/documents/contracts/processing";

export type Eligibility =
  | {
      supported: true;
      pages: number[];
      partial: boolean;
      omittedPages: number[];
    }
  | {
      supported: false;
      reason: "invalid_document" | "no_text";
      message: string;
    };

export function checkEligibility(value: unknown): Eligibility {
  const parsed = normalizedDocumentSchema.safeParse(value);
  if (!parsed.success)
    return {
      supported: false,
      reason: "invalid_document",
      message: "The normalized document failed validation.",
    };
  const doc: NormalizedDocument = parsed.data;
  const hasSegmentCoverage = (page: NormalizedDocument["pages"][number]) => {
    if (!page.text.length || !page.segments.length) return false;
    let cursor = 0;
    for (const segment of page.segments) {
      if (page.text.slice(cursor, segment.start).trim()) return false;
      cursor = segment.end;
    }
    return !page.text.slice(cursor).trim();
  };
  const pages = doc.pages
    .filter(hasSegmentCoverage)
    .map((page) => page.pageNumber);
  const omittedPages = doc.pages
    .filter((page) => !pages.includes(page.pageNumber))
    .map((page) => page.pageNumber);
  if (!pages.length)
    return {
      supported: false,
      reason: "no_text",
      message:
        "No selectable text is available. Visual-only pages cannot be analyzed by this text-only service.",
    };
  return {
    supported: true,
    pages,
    partial:
      omittedPages.length > 0 ||
      doc.status === "partial" ||
      !doc.metadata.statistics.complete,
    omittedPages,
  };
}
