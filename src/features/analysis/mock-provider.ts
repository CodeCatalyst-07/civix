import "server-only";
import type { NormalizedDocument } from "@/features/documents/contracts/processing";
import type { OutputLanguage } from "./contracts/analysis";

/** Deterministic UI-only provider. The output is still grounded by Phase 4. */
export function createSyntheticProvider(
  document: NormalizedDocument,
  language: OutputLanguage,
) {
  const segments = document.pages.flatMap((page) => page.segments);
  const citation = (text: string) => {
    const segment =
      segments.find((item) => item.text.includes(text)) ?? segments[0];
    if (!segment) return [];
    const excerpt = segment.text.includes(text) ? text : segment.text;
    return [{ pageNumber: segment.pageNumber, segmentId: segment.id, excerpt }];
  };
  const actionText =
    segments
      .map((segment) => /submit[^.\n]*/i.exec(segment.text)?.[0])
      .find(Boolean) ?? "Review the instructions in this document.";
  // A deadline expression must fit inside one citeable segment. Do not synthesize
  // a cross-segment excerpt that Phase 4 correctly rejects during grounding.
  const dateText = segments
    .map(
      (segment) =>
        /(?:before|by)\s+(?:\d{1,2}\s+[A-Za-z]+\s+\d{4}|\d{4}-\d{2}-\d{2})\b|within\s+\d+\s+(?:days?|weeks?|months?|years?)\b/i.exec(
          segment.text,
        )?.[0],
    )
    .find(Boolean);
  const evidence = citation(actionText);
  const summary =
    language === "hi"
      ? "यह विकास के लिए नकली परिणाम है। स्रोत की जाँच करें और लागू कार्रवाई की पुष्टि करें।"
      : language === "mr"
        ? "हा विकासासाठी तयार केलेला नमुना निकाल आहे. स्रोत तपासा आणि लागू कृतीची खात्री करा."
        : "This is a simulated development analysis. Review the source and confirm what action applies.";
  const result = {
    detectedLanguage: "en",
    documentType: "Document for review",
    summary: { text: summary, evidence: citation(actionText) },
    issuer: null,
    actions: [{ description: actionText, mandatory: null, evidence }],
    deadlines: dateText
      ? [{ expression: dateText, evidence: citation(dateText) }]
      : [],
    requiredDocuments: [],
    fees: [],
    consequences: [],
    missingInformation: [
      "A real provider analysis was not requested in mock mode.",
    ],
    uncertainties: [
      "Synthetic development output; do not use to make a real-world decision.",
    ],
  };
  return {
    async generateText() {
      return {
        text: JSON.stringify(result),
        model: "synthetic-development",
        modelVersion: null,
        usage: null,
      };
    },
  };
}
