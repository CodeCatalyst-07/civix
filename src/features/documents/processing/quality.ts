import type { DocumentPage } from "../contracts/processing";
export function assessQuality(pages: DocumentPage[]) {
  const statistics = {
    textPages: pages.filter((p) => p.text.length > 0).length,
    visualPages: pages.filter((p) => p.needsVisualProcessing).length,
    failedPages: pages.filter((p) => p.extractionStatus === "extraction_failed")
      .length,
    noTextPages: pages.filter((p) => !p.text.length).length,
    totalCharacters: pages.reduce((n, p) => n + p.text.length, 0),
    complete: !pages.some(
      (p) =>
        p.extractionStatus === "extraction_failed" ||
        p.warnings.includes("PAGE_PARSER_WARNING"),
    ),
  };
  const warnings = [...new Set(pages.flatMap((p) => p.warnings))];
  if (statistics.visualPages) warnings.push("VISUAL_PROCESSING_REQUIRED");
  if (!statistics.textPages) warnings.push("NO_EXTRACTABLE_TEXT");
  if (!statistics.complete) warnings.push("PARTIAL_EXTRACTION");
  return { statistics, warnings: [...new Set(warnings)] };
}
