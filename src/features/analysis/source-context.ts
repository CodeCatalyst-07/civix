import type { NormalizedDocument } from "@/features/documents/contracts/processing";
import { checkEligibility } from "./eligibility";

export type SourceContext = {
  text: string;
  includedPages: number[];
  segmentIds: string[];
};
export type ContextResult =
  | { ok: true; context: SourceContext }
  | {
      ok: false;
      reason: "unsupported" | "too_large";
      message: string;
      contextLimit?: {
        sourceTextChars: number;
        serializedContextChars: number;
        maximumContextChars: number;
      };
    };

// Leaves room for the fixed system instructions within the provider's 20k prompt cap.
export const MAX_SOURCE_CONTEXT_CHARS = 18_000;

export function buildSourceContext(
  doc: NormalizedDocument,
  maxChars = MAX_SOURCE_CONTEXT_CHARS,
): ContextResult {
  const eligibility = checkEligibility(doc);
  if (!eligibility.supported)
    return { ok: false, reason: "unsupported", message: eligibility.message };
  const segments = doc.pages
    .filter((page) => eligibility.pages.includes(page.pageNumber))
    .flatMap((page) =>
      page.segments.map((segment) => ({
        pageNumber: page.pageNumber,
        segmentId: segment.id,
        text: segment.text,
        extractionMethod: segment.extractionMethod,
        ...(segment.confidence !== undefined
          ? { confidence: segment.confidence }
          : {}),
      })),
    );
  const payload = JSON.stringify(segments);
  const maximumContextChars = Math.min(maxChars, MAX_SOURCE_CONTEXT_CHARS);
  if (payload.length > maximumContextChars)
    return {
      ok: false,
      reason: "too_large",
      message:
        "The selectable source text exceeds the safe single-request analysis context.",
      contextLimit: {
        sourceTextChars: doc.pages
          .filter((page) => eligibility.pages.includes(page.pageNumber))
          .reduce((total, page) => total + page.text.length, 0),
        serializedContextChars: payload.length,
        maximumContextChars,
      },
    };
  return {
    ok: true,
    context: {
      text: payload,
      includedPages: eligibility.pages,
      segmentIds: segments.map((segment) => segment.segmentId),
    },
  };
}
